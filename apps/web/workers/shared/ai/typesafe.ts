/** TypeSafe System One HTTP API: https://docs.typesafe.ai/api */
export const DEFAULT_TYPESAFE_MODEL = 'jev-1.13.0';
const API_URL = 'https://api.typesafe.ai/v1/systemone';
const TIMEOUT_MS = 15_000;
const DEFAULT_BACKOFF_MS = 60_000;

export class TypeSafeRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('TypeSafe is temporarily rate limited or overloaded');
    this.name = 'TypeSafeRateLimitError';
  }
}

export interface TypeSafeEnv {
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  KV: KVNamespace;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

type Question = NoulQuestion | ScoreQuestion;
export interface NoulAnswer { type: 'noul'; noul: number }
export interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}
type Answer<Q extends Question> = Q extends NoulQuestion ? NoulAnswer : ScoreAnswer;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseAnswer(value: unknown, question: Question): NoulAnswer | ScoreAnswer {
  if (!isRecord(value) || value.type !== question.type) {
    throw new Error('TypeSafe returned a missing or mismatched answer');
  }
  if (question.type === 'noul') {
    if (!isProbability(value.noul)) throw new Error('TypeSafe returned an invalid Noul probability');
    return { type: 'noul', noul: value.noul };
  }
  if (typeof value.score !== 'number' || !Number.isFinite(value.score)
    || value.score < 0 || value.score > question.criteria.length - 1
    || !isProbability(value.confidence) || !isRecord(value.probabilities) || !isRecord(value.legend)) {
    throw new Error('TypeSafe returned an invalid Score answer');
  }
  const probabilities: Record<string, number> = {};
  const legend: Record<string, string> = {};
  for (const [index, description] of question.criteria.entries()) {
    const probability = value.probabilities[index];
    if (!isProbability(probability) || value.legend[index] !== description) {
      throw new Error('TypeSafe returned an invalid Score distribution');
    }
    probabilities[index] = probability;
    legend[index] = description;
  }
  const sum = Object.values(probabilities).reduce((total, probability) => total + probability, 0);
  const mean = Object.entries(probabilities).reduce((total, [index, probability]) => total + Number(index) * probability, 0);
  // The live API rounds probabilities and the score independently to two
  // decimals. Account for accumulated rounding, including floating-point error,
  // without accepting missing levels or an unrelated score/distribution.
  const levelCount = question.criteria.length;
  const sumTolerance = levelCount * 0.005 + 1e-9;
  const meanTolerance = (1 + levelCount * (levelCount - 1) / 2) * 0.005 + 1e-9;
  if (Object.keys(value.probabilities).length !== question.criteria.length
    || Math.abs(sum - 1) > sumTolerance || Math.abs(mean - value.score) > meanTolerance) {
    throw new Error('TypeSafe returned an inconsistent Score distribution');
  }
  return { type: 'score', score: value.score, confidence: value.confidence, probabilities, legend };
}

function parseTokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('TypeSafe returned invalid token usage');
  }
  return value;
}

function retryAfterMs(headers: Headers): number {
  const raw = headers.get('retry-after');
  if (!raw) return DEFAULT_BACKOFF_MS;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? Math.max(DEFAULT_BACKOFF_MS, delay) : DEFAULT_BACKOFF_MS;
}

/**
 * One batched request, with a separate provider cooldown on 429/529.
 * Callers can fall back or defer a queue task on rate limits without retry storms.
 */
export async function evaluateWithJev<Q extends Record<string, Question>>(
  state: Record<string, unknown>,
  questions: Q,
  env: TypeSafeEnv,
): Promise<{
  model: string;
  answers: { [K in keyof Q]: Answer<Q[K]> };
  usage: { input_tokens: number; output_tokens: number };
} | null> {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.TYPESAFE_MODEL?.trim() || DEFAULT_TYPESAFE_MODEL;
  const pauseKey = `typesafe:v1:paused_until:${model}`;
  const pausedUntil = Number(await env.KV.get(pauseKey));
  if (Number.isFinite(pausedUntil) && pausedUntil > Date.now()) {
    throw new TypeSafeRateLimitError(pausedUntil - Date.now());
  }

  const entries = Object.entries(questions);
  if (!entries.length || entries.some(([, question]) => question.type === 'score'
    && (question.criteria.length < 2 || question.criteria.length > 10))) {
    throw new Error('Invalid TypeSafe questions');
  }
  const body = JSON.stringify({ model, state, questions });
  const encoder = new TextEncoder();
  const stateBytes = encoder.encode(JSON.stringify(state)).byteLength;
  const longestQuestionBytes = Math.max(...entries.map(([, question]) => encoder.encode(JSON.stringify(question)).byteLength));
  // UTF-8 bytes are a conservative token upper bound. Leave room for protocol
  // overhead under Jev's 32k per-question / 64k total context limits. Never
  // silently truncate evidence: larger inputs use the existing fallback.
  if (stateBytes + longestQuestionBytes > 30_000 || encoder.encode(body).byteLength > 60_000) return null;

  const response = await fetch(API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
  });
  if (!response.ok) {
    // Error bodies may echo private skill content or credentials. Never log them.
    if (response.status === 429 || response.status === 529) {
      const delay = retryAfterMs(response.headers);
      const until = Math.max(Date.now() + delay, Number(await env.KV.get(pauseKey)) || 0);
      await env.KV.put(pauseKey, String(until), { expirationTtl: Math.max(60, Math.ceil((until - Date.now()) / 1000)) });
      await response.body?.cancel();
      throw new TypeSafeRateLimitError(until - Date.now());
    }
    await response.body?.cancel();
    throw new Error(`TypeSafe request failed (HTTP ${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.model !== 'string' || !payload.model.trim()
    || !isRecord(payload.answers) || !isRecord(payload.usage)) {
    throw new Error('TypeSafe returned an invalid response');
  }
  const rawAnswers = payload.answers;
  const answers = Object.fromEntries(entries.map(([id, question]) => [id, parseAnswer(rawAnswers[id], question)])) as { [K in keyof Q]: Answer<Q[K]> };
  return {
    model: payload.model,
    answers,
    usage: { input_tokens: parseTokens(payload.usage.input_tokens), output_tokens: parseTokens(payload.usage.output_tokens) },
  };
}
