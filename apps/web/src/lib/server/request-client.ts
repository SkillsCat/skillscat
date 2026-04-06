const KNOWN_CRAWLER_UA = [
  /\bgooglebot\b/i,
  /\bgoogleother(?:-[a-z]+)?\b/i,
  /\bgoogle-inspectiontool\b/i,
  /\badsbot-google(?:-mobile)?\b/i,
  /\bmediapartners-google\b/i,
  /\bstorebot-google\b/i,
  /\bfeedfetcher-google\b/i,
  /\bapis-google\b/i,
  /\bgoogle-read-aloud\b/i,
  /\bbingbot\b/i,
  /\bduckduckbot\b/i,
  /\bapplebot\b/i,
  /\bccbot\b/i,
  /\bbaiduspider\b/i,
  /\byandexbot\b/i,
  /\bslurp\b/i,
  /\bgptbot\b/i,
  /\bchatgpt-user\b/i,
  /\boai-searchbot\b/i,
  /\bperplexitybot\b/i,
  /\bclaudebot\b/i,
  /\banthropic-ai\b/i,
  /\bbytespider\b/i,
  /\bmeta-externalagent\b/i,
  /\bfacebookexternalhit\b/i,
];

const AUTOMATION_UA_PATTERN = /\b(bot|crawler|spider|slurp|preview|headless|lighthouse|puppeteer|playwright|selenium|phantomjs|cypress|webdriver)\b/i;
const PREFETCH_PURPOSE_PATTERN = /\b(prefetch|preview|prerender)\b/i;
const HEADLESS_CLIENT_HINT_PATTERN = /\bHeadlessChrome\b/i;

interface CloudflareBotManagementSignals {
  score?: number | null;
  verifiedBot?: boolean | null;
  detectionIds?: unknown;
  jsDetection?: {
    passed?: boolean | null;
  } | null;
}

interface RequestWithCloudflareSignals extends Request {
  cf?: {
    botManagement?: CloudflareBotManagementSignals | null;
  };
}

export interface CloudflareBotSignals {
  score: number | null;
  verifiedBot: boolean;
  jsDetectionPassed: boolean | null;
  detectionIds: string[];
}

export function normalizeRequestUserAgent(raw: string | null): string {
  return (raw || '').trim();
}

export function isKnownCrawlerUserAgent(ua: string): boolean {
  return KNOWN_CRAWLER_UA.some((pattern) => pattern.test(ua));
}

export function isAutomationLikeUserAgent(ua: string): boolean {
  return AUTOMATION_UA_PATTERN.test(ua);
}

function hasHeadlessClientHints(request: Request): boolean {
  const secChUa = request.headers.get('sec-ch-ua') || '';
  const secChUaFullVersionList = request.headers.get('sec-ch-ua-full-version-list') || '';
  return HEADLESS_CLIENT_HINT_PATTERN.test(secChUa)
    || HEADLESS_CLIENT_HINT_PATTERN.test(secChUaFullVersionList);
}

export function getCloudflareBotSignals(request: Request): CloudflareBotSignals | null {
  const botManagement = (request as RequestWithCloudflareSignals).cf?.botManagement;
  if (!botManagement) {
    return null;
  }

  const score = typeof botManagement.score === 'number' ? botManagement.score : null;
  const verifiedBot = botManagement.verifiedBot === true;
  const jsDetectionPassed = typeof botManagement.jsDetection?.passed === 'boolean'
    ? botManagement.jsDetection.passed
    : null;
  const detectionIds = Array.isArray(botManagement.detectionIds)
    ? botManagement.detectionIds.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    score,
    verifiedBot,
    jsDetectionPassed,
    detectionIds,
  };
}

export function isCrawlerLikeRequest(request: Request): boolean {
  const cloudflareSignals = getCloudflareBotSignals(request);
  if (cloudflareSignals?.verifiedBot) {
    return true;
  }

  // Score 1 is Cloudflare's "Automated" bucket and is a high-confidence signal.
  if (cloudflareSignals?.score === 1) {
    return true;
  }

  if (cloudflareSignals?.jsDetectionPassed === false) {
    return true;
  }

  const purpose = `${request.headers.get('purpose') || ''} ${request.headers.get('sec-purpose') || ''}`;
  if (PREFETCH_PURPOSE_PATTERN.test(purpose)) {
    return true;
  }

  if (hasHeadlessClientHints(request)) {
    return true;
  }

  const ua = normalizeRequestUserAgent(request.headers.get('user-agent'));
  if (!ua) {
    return false;
  }

  return isKnownCrawlerUserAgent(ua) || isAutomationLikeUserAgent(ua);
}
