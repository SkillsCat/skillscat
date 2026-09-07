export const SUMMARY_GENERATION_VERSION = 'v2';
export type SummaryLocale = 'en' | 'zh-CN';

/** Only finished, plain-text descriptions belong in public pages. */
export function sanitizeSummary(raw: unknown, locale: SummaryLocale = 'en'): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim();
  if (text.length < 24 || text.length > 600) return null;
  if (/[{}<>]|```/.test(text)) return null;
  if (/(?:the user (?:wants|asks|requested)|let me (?:analy[sz]e|think|explain)|(?:my|the) (?:reasoning|analysis)|chain.of.thought|respond (?:only|with)|system prompt|as an ai|here is (?:the|a) summary|用户(?:要求|想要)|让我(?:分析|思考)|以下是.*摘要|思考过程)/i.test(text)) return null;
  const han = (text.match(/[\p{Script=Han}]/gu) || []).length;
  if (locale === 'en' ? han > text.length * 0.1 : han < 12 || han < text.length * 0.2) return null;
  // Reject incomplete model output instead of turning it into published prose.
  if (!/[.!?。！？]["')）]?$/.test(text)) return null;
  return text;
}

export function parseLocalizedSummaries(value: unknown): Partial<Record<SummaryLocale, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const en = sanitizeSummary(record.en, 'en');
  const zh = sanitizeSummary(record['zh-CN'], 'zh-CN');
  return { ...(en ? { en } : {}), ...(zh ? { 'zh-CN': zh } : {}) };
}
