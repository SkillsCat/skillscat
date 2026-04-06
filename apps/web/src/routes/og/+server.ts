import type { RequestHandler } from './$types';
import { Resvg } from '@cf-wasm/resvg';
import { normalizePublicAvatarUrl } from '$lib/avatar';
import { SITE_NAME, SITE_DESCRIPTION, SITE_OG_DEFAULT_SUBTITLE, SITE_URL } from '$lib/seo/constants';
import { OG_IMAGE_VERSION } from '$lib/seo/og';
import { getCachedBinary } from '$lib/server/cache';
import {
  fetchPublicBinaryAsset,
  fetchPublicDataUri,
  fetchPublicTextAsset,
} from '$lib/server/cache/public-assets';
import { getCategoryBySlug } from '$lib/constants/categories';
import { buildSkillscatInstallCommand, splitShellCommand } from '$lib/skill-install';

const WIDTH = 1200;
const HEIGHT = 630;
const DEFAULT_TITLE = SITE_NAME;
const DEFAULT_SUBTITLE = SITE_OG_DEFAULT_SUBTITLE;
const DEFAULT_TAG = 'skills.cat';
const VERSIONED_CACHE_CONTROL = 'public, max-age=31536000, s-maxage=31536000, immutable';
const DEFAULT_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const VERSIONED_CACHE_TTL_SECONDS = 31536000;
const DEFAULT_CACHE_TTL_SECONDS = 86400;
const PUBLIC_FONT_ASSET_TTL_SECONDS = 30 * 24 * 60 * 60;
const PUBLIC_IMAGE_ASSET_TTL_SECONDS = 7 * 24 * 60 * 60;
const GOOGLE_TTF_USER_AGENT = 'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30';

type WaitUntilFn = (promise: Promise<unknown>) => void;

const COLOR = {
  primary: '#d4842a',
  primarySubtle: '#fdf0e2',
  accent: '#d98cb3',
  bg: '#f8f5f0',
  card: '#fdfcfa',
  fg: '#3d3830',
  muted: '#6e6660',
  border: '#c9a87a',
} as const;

interface OgData {
  title: string;
  subtitle: string;
  tag: string;
  author: string;
  avatarUrl: string;
  stars: number;
  installCommand: string;
}

const STATIC_PAGES: Record<string, OgData> = {
  home: { title: SITE_NAME, subtitle: SITE_DESCRIPTION, tag: 'Home', author: '', avatarUrl: '', stars: 0, installCommand: '' },
  trending: { title: 'Trending Skills', subtitle: SITE_DESCRIPTION, tag: 'Trending', author: '', avatarUrl: '', stars: 0, installCommand: '' },
  top: { title: 'Top Rated Skills', subtitle: SITE_DESCRIPTION, tag: 'Top Rated', author: '', avatarUrl: '', stars: 0, installCommand: '' },
  recent: { title: 'Recently Added Skills', subtitle: SITE_DESCRIPTION, tag: 'Recent', author: '', avatarUrl: '', stars: 0, installCommand: '' },
  categories: { title: 'Categories', subtitle: SITE_DESCRIPTION, tag: 'Categories', author: '', avatarUrl: '', stars: 0, installCommand: '' },
  privacy: { title: 'Privacy Policy', subtitle: SITE_DESCRIPTION, tag: 'Policy', author: '', avatarUrl: '', stars: 0, installCommand: '' },
  terms: { title: 'Terms of Service', subtitle: SITE_DESCRIPTION, tag: 'Policy', author: '', avatarUrl: '', stars: 0, installCommand: '' },
  '404': { title: 'Page Not Found', subtitle: 'The requested page does not exist.', tag: '404', author: '', avatarUrl: '', stars: 0, installCommand: '' },
};

const DEFAULT_OG: OgData = {
  title: DEFAULT_TITLE,
  subtitle: DEFAULT_SUBTITLE,
  tag: DEFAULT_TAG,
  author: '',
  avatarUrl: '',
  stars: 0,
  installCommand: '',
};

// --- Data resolvers ---

interface OgSkillRow {
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  skill_path: string | null;
  stars: number | null;
  source_type: 'github' | 'upload' | null;
  visibility: string | null;
  author_display_name: string | null;
  author_avatar: string | null;
  category_slug: string | null;
}

async function resolveSkill(slug: string, db: D1Database): Promise<OgData | null> {
  const skill = await db.prepare(`
    SELECT
      s.name,
      s.slug,
      s.description,
      s.repo_owner,
      s.repo_name,
      s.skill_path,
      s.stars,
      s.source_type,
      s.visibility,
      a.display_name AS author_display_name,
      a.avatar_url AS author_avatar,
      (
        SELECT sc.category_slug
        FROM skill_categories sc
        WHERE sc.skill_id = s.id
        LIMIT 1
      ) AS category_slug
    FROM skills s
    LEFT JOIN authors a ON a.username = s.repo_owner
    WHERE s.slug = ?
    LIMIT 1
  `)
    .bind(slug)
    .first<OgSkillRow>();

  if (!skill || skill.visibility === 'private') return null;
  const author = skill.author_display_name || skill.repo_owner || '';
  const firstCat = skill.category_slug ? getCategoryBySlug(skill.category_slug) : null;
  const avatarUrl = skill.author_avatar || `https://github.com/${skill.repo_owner}.png?size=128`;
  return {
    title: skill.name,
    subtitle: skill.description || `AI agent skill: ${skill.name}`,
    tag: firstCat ? firstCat.name : '',
    author,
    avatarUrl,
    stars: skill.stars || 0,
    installCommand: buildSkillscatInstallCommand({
      slug: skill.slug,
      skillName: skill.name,
      skillPath: skill.skill_path || '',
      sourceType: skill.source_type || 'github',
      repoOwner: skill.repo_owner,
      repoName: skill.repo_name,
    }),
  };
}

async function resolveUser(slug: string, db: D1Database): Promise<OgData | null> {
  const row = await db.prepare(`
    SELECT display_name, username, avatar_url, total_stars FROM authors WHERE username = ? LIMIT 1
  `).bind(slug).first<{ display_name: string | null; username: string; avatar_url: string | null; total_stars: number | null }>();
  if (!row) return null;
  const displayName = row.display_name || slug;
  return {
    title: displayName,
    subtitle: `View ${displayName}'s public AI agent skills on SkillsCat.`,
    tag: 'Profile',
    author: displayName,
    avatarUrl: row.avatar_url || `https://github.com/${slug}.png?size=128`,
    stars: row.total_stars || 0,
    installCommand: '',
  };
}

async function resolveOrg(slug: string, db: D1Database): Promise<OgData | null> {
  const row = await db.prepare(`
    SELECT display_name, description, avatar_url FROM organizations WHERE slug = ? LIMIT 1
  `).bind(slug).first<{ display_name: string | null; description: string | null; avatar_url: string | null }>();
  if (!row) return null;
  const name = row.display_name || slug;
  return {
    title: name,
    subtitle: row.description || `Explore ${name}'s public AI agent skills on SkillsCat.`,
    tag: 'Organization',
    author: name,
    avatarUrl: row.avatar_url || '',
    stars: 0,
    installCommand: '',
  };
}

function resolveCategory(slug: string): OgData | null {
  const cat = getCategoryBySlug(slug);
  if (!cat) return null;
  return {
    title: `${cat.name} Skills`,
    subtitle: cat.description || SITE_DESCRIPTION,
    tag: 'Category',
    author: '',
    avatarUrl: '',
    stars: 0,
    installCommand: '',
  };
}

async function resolveOgData(
  type: string,
  slug: string,
  db: D1Database | undefined,
): Promise<OgData | null> {
  switch (type) {
    case 'skill': return db ? resolveSkill(slug, db) : null;
    case 'user': return db ? resolveUser(slug, db) : null;
    case 'org': return db ? resolveOrg(slug, db) : null;
    case 'category': return resolveCategory(slug);
    case 'page': return STATIC_PAGES[slug] ?? null;
    default: return null;
  }
}

// --- SVG helpers ---

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatStars(num: number): string {
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

function truncate(value: string, maxLength: number): string {
  if (!value) return '';
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function normalizeEtagPart(value: string, fallback: string): string {
  const normalized = value.trim();
  if (!normalized) return fallback;
  return normalized.replace(/\s+/g, ' ').slice(0, 256);
}

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildOgEtag(type: string, slug: string, version: string): string {
  const safeType = normalizeEtagPart(type, 'default');
  const safeSlug = normalizeEtagPart(slug, 'default');
  const safeVersion = normalizeEtagPart(version, 'none');
  const digest = fnv1aHex(`${safeType}\u001f${safeSlug}\u001f${safeVersion}`);
  return `"og:${OG_IMAGE_VERSION}:${digest}"`;
}

function encodeOgCacheKeyPart(value: string, fallback: string): string {
  const normalized = value.trim();
  return encodeURIComponent(normalized || fallback);
}

function buildOgCacheKey(type: string, slug: string, version: string): string {
  return [
    'og:image',
    OG_IMAGE_VERSION,
    encodeOgCacheKeyPart(type, 'default'),
    encodeOgCacheKeyPart(slug, 'default'),
    encodeOgCacheKeyPart(version, 'default'),
  ].join(':');
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine) : word;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length >= maxCharsPerLine ? `${last.slice(0, maxCharsPerLine - 1)}…` : `${last}…`;
  }
  return lines;
}

function ellipsizeLine(value: string, maxChars: number): string {
  const safeMaxChars = Math.max(2, maxChars);
  if (value.length <= safeMaxChars) return value;
  return `${value.slice(0, safeMaxChars - 1)}…`;
}

interface CommandSegment {
  text: string;
  color: string;
}

function getCommandSegmentColor(token: string): string {
  if (token === 'npx') return COLOR.accent;
  if (token === 'skillscat' || token === 'skills') return COLOR.fg;
  if (token === 'add' || token === '--skill') return COLOR.primary;
  if (token.includes('/')) return COLOR.muted;
  return COLOR.fg;
}

function lineCharCount(segments: CommandSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.text.length, 0);
}

function trimCommandLineEdges(line: CommandSegment[]): CommandSegment[] {
  const trimmed = line
    .map((segment) => ({ ...segment }))
    .filter((segment) => segment.text.length > 0);

  if (trimmed.length === 0) return [];

  trimmed[0].text = trimmed[0].text.replace(/^\s+/, '');
  trimmed[trimmed.length - 1].text = trimmed[trimmed.length - 1].text.replace(/\s+$/, '');

  return trimmed.filter((segment) => segment.text.length > 0);
}

function appendEllipsis(line: CommandSegment[], maxChars: number): CommandSegment[] {
  const trimmed = trimCommandLineEdges(line);

  while (trimmed.length > 0 && trimmed[trimmed.length - 1].text.trim() === '') {
    trimmed.pop();
  }

  while (lineCharCount(trimmed) >= maxChars && trimmed.length > 0) {
    const idx = trimmed.length - 1;
    const segment = trimmed[idx];
    if (segment.text.length <= 1) {
      trimmed.pop();
      continue;
    }
    segment.text = segment.text.slice(0, -1);
  }

  trimmed.push({ text: '…', color: COLOR.muted });
  return trimmed;
}

function wrapCommandSegments(command: string, maxCharsPerLine: number, maxLines: number): CommandSegment[][] {
  const safeMaxChars = Math.max(8, maxCharsPerLine);
  const tokens = splitShellCommand(command);
  const lines: CommandSegment[][] = [];
  let currentLine: CommandSegment[] = [];
  let currentLength = 0;

  const pushLine = (): void => {
    if (currentLine.length === 0) return;
    lines.push(currentLine);
    currentLine = [];
    currentLength = 0;
  };

  for (const token of tokens) {
    const color = getCommandSegmentColor(token);
    let remaining = token;
    let isFirstChunk = true;

    while (remaining.length > 0) {
      const needsLeadingSpace = currentLength > 0 && isFirstChunk;
      let available = safeMaxChars - currentLength - (needsLeadingSpace ? 1 : 0);

      if (available <= 0) {
        pushLine();
        continue;
      }

      if (needsLeadingSpace) {
        currentLine.push({ text: ' ', color: COLOR.fg });
        currentLength += 1;
        available -= 1;
        if (available <= 0) {
          pushLine();
          continue;
        }
      }

      if (remaining.length <= available) {
        currentLine.push({ text: remaining, color });
        currentLength += remaining.length;
        remaining = '';
      } else {
        currentLine.push({ text: remaining.slice(0, available), color });
        currentLength += available;
        remaining = remaining.slice(available);
        pushLine();
        isFirstChunk = false;
      }
    }
  }
  pushLine();
  const normalized = lines.map(trimCommandLineEdges).filter((line) => line.length > 0);

  if (normalized.length <= maxLines) return normalized;
  const truncated = normalized.slice(0, maxLines);
  truncated[maxLines - 1] = appendEllipsis(truncated[maxLines - 1], safeMaxChars);
  return truncated;
}

function buildInstallCapsule(installCommand: string, cardX: number, cardY: number, cardW: number, cardH: number): { svg: string; reservedBottom: number } {
  const installText = installCommand;
  const maxLines = 4;
  const installX = cardX + 30;
  const bottomPadding = 30;
  const horizontalPaddingLeft = 12;
  const horizontalPaddingRight = 8;
  const verticalPadding = 8;
  const lineHeight = 18;
  const fontSize = 14;
  const charWidth = 8.2;
  const minWidth = 0;
  const maxWidth = cardW - 60;
  const maxCharsPerLine = Math.max(16, Math.floor((maxWidth - horizontalPaddingLeft - horizontalPaddingRight) / charWidth));
  const lines = wrapCommandSegments(installText, maxCharsPerLine, maxLines);
  const lineWidths = lines.map((line) => lineCharCount(line) * charWidth);
  const textWidth = Math.max(...lineWidths, 0);
  const installW = Math.min(maxWidth, Math.max(minWidth, textWidth + horizontalPaddingLeft + horizontalPaddingRight));
  const installH = Math.max(34, verticalPadding * 2 + lines.length * lineHeight);
  const installY = cardY + cardH - bottomPadding - installH;
  const textX = installX + horizontalPaddingLeft;
  const firstBaselineY = installY + verticalPadding + 13;
  const installRadius = Math.min(17, installH / 2);

  const textSvg = lines
    .map((line, lineIndex) => {
      const baselineY = firstBaselineY + lineIndex * lineHeight;
      const segments = line
        .filter((segment) => segment.text.length > 0)
        .map((segment) => `<tspan fill="${segment.color}">${escapeXml(segment.text)}</tspan>`)
        .join('');
      return `<text x="${textX}" y="${baselineY}" font-family="'Courier New', monospace" font-size="${fontSize}" font-weight="700">${segments}</text>`;
    })
    .join('');

  const svg = `<rect x="${installX}" y="${installY}" width="${installW}" height="${installH}" rx="${installRadius}" fill="${COLOR.primarySubtle}" />${textSvg}`;
  const reservedBottom = bottomPadding + installH + 16;

  return { svg, reservedBottom };
}

// --- Resource caching ---
let fontBuffer: Uint8Array | null = null;
let fontDataUri: string | null = null;
let logoDataUri: string | null = null;
const LOGO_CANDIDATE_PATHS = ['/favicon-128x128.png', '/favicon-256x256.png'] as const;

async function loadFont(waitUntil?: WaitUntilFn): Promise<{ buffer: Uint8Array; dataUri: string }> {
  if (fontBuffer && fontDataUri) return { buffer: fontBuffer, dataUri: fontDataUri };
  // Fetch TTF for resvg (it doesn't support woff2).
  // Use CSS v1 API + Android 4.x UA — Google Fonts serves TTF to these clients.
  const { data: css } = await fetchPublicTextAsset({
    url: 'https://fonts.googleapis.com/css?family=Poppins:700',
    cacheKeyPrefix: 'asset:og:font-css:poppins-700',
    ttlSeconds: PUBLIC_FONT_ASSET_TTL_SECONDS,
    waitUntil,
    headers: {
      'User-Agent': GOOGLE_TTF_USER_AGENT,
    },
  });
  const urlMatch = css.match(/src:\s*[^;]*url\(([^)]+)\)/);
  if (!urlMatch) throw new Error('Failed to extract font URL');
  const { data } = await fetchPublicBinaryAsset({
    url: urlMatch[1],
    cacheKeyPrefix: 'asset:og:font-file:poppins-700',
    ttlSeconds: PUBLIC_FONT_ASSET_TTL_SECONDS,
    waitUntil,
  });
  fontBuffer = data;
  let binary = '';
  for (let i = 0; i < fontBuffer.length; i++) binary += String.fromCharCode(fontBuffer[i]);
  fontDataUri = `data:font/truetype;base64,${btoa(binary)}`;
  return { buffer: fontBuffer, dataUri: fontDataUri };
}

async function fetchImageDataUri(url: string, waitUntil?: WaitUntilFn): Promise<string | null> {
  const normalizedUrl = normalizePublicAvatarUrl(url, 128) || url;
  try {
    const { dataUri } = await fetchPublicDataUri({
      url: normalizedUrl,
      cacheKeyPrefix: 'asset:og:image-data-uri',
      ttlSeconds: PUBLIC_IMAGE_ASSET_TTL_SECONDS,
      waitUntil,
    });
    return dataUri;
  } catch {
    return null;
  }
}

async function getLogoDataUri(origin: string, waitUntil?: WaitUntilFn): Promise<string> {
  if (logoDataUri) return logoDataUri;

  const baseUrls = Array.from(new Set([origin, SITE_URL]));
  for (const baseUrl of baseUrls) {
    for (const logoPath of LOGO_CANDIDATE_PATHS) {
      const dataUri = await fetchImageDataUri(`${baseUrl}${logoPath}`, waitUntil);
      if (dataUri) {
        logoDataUri = dataUri;
        return logoDataUri;
      }
    }
  }

  throw new Error('Failed to load OG logo asset');
}

function buildSvg(
  title: string,
  subtitle: string,
  tag: string,
  author: string,
  stars: number,
  installCommand: string,
  showSubtitle: boolean,
  font: string,
  logo: string,
  avatar: string | null,
): string {
  let subtitleLines = showSubtitle ? wrapLines(subtitle, 46, 2) : [];

  const cardX = 48;
  const cardY = 40;
  const cardW = 1104;
  const cardH = 550;
  const shadowOffset = 4;
  const contentX = cardX + 48;
  const fontFamily = "'Poppins', system-ui, sans-serif";

  // Avatar layout
  const avatarSize = 72;
  const avatarR = avatarSize / 2;
  const hasAvatar = !!avatar;
  const textStartX = hasAvatar ? contentX + avatarSize + 20 : contentX;

  // Reserve bottom space for install capsule.
  const hasInstall = !!installCommand;
  const installLayout = hasInstall ? buildInstallCapsule(installCommand, cardX, cardY, cardW, cardH) : null;
  const reservedBottom = installLayout?.reservedBottom ?? 30;

  // Title section anchors.
  const titleY = cardY + 96;
  const authorY = titleY + 30;
  const subtitleStartY = author ? authorY + 52 : titleY + 58;

  // Tag pill + Stars badge — top-right corner, same 30px edge padding as install capsule
  let tagSvg = '';
  const tagPadding = 30;
  const tagY = cardY + tagPadding;
  const tagHeight = 34;
  const tagGap = 10;
  let pillRight = cardX + cardW - tagPadding; // build from right to left

  if (stars > 0) {
    const starsText = `★ ${formatStars(stars)}`;
    const starsWidth = starsText.length * 9 + 28;
    const sx = pillRight - starsWidth;
    tagSvg += `<rect x="${sx}" y="${tagY}" width="${starsWidth}" height="${tagHeight}" rx="17" fill="${COLOR.bg}" />`
      + `<text x="${sx + starsWidth / 2}" y="${tagY + 23}" text-anchor="middle" font-family="${fontFamily}" font-size="15" font-weight="700" fill="${COLOR.muted}">${escapeXml(starsText)}</text>`;
    pillRight = sx - tagGap;
  }
  if (tag) {
    const maxTagChars = 18;
    const displayTag = tag.length > maxTagChars ? tag.slice(0, maxTagChars - 1) + '…' : tag;
    const tagWidth = displayTag.length * 10 + 32;
    const tx = pillRight - tagWidth;
    tagSvg += `<rect x="${tx}" y="${tagY}" width="${tagWidth}" height="${tagHeight}" rx="17" fill="${COLOR.primarySubtle}" />`
      + `<text x="${tx + tagWidth / 2}" y="${tagY + 23}" text-anchor="middle" font-family="${fontFamily}" font-size="15" font-weight="700" fill="${COLOR.primary}">${escapeXml(displayTag)}</text>`;
    pillRight = tx - tagGap;
  }

  // Limit title width so it doesn't overlap with top-right tags
  const titleMaxRight = pillRight - 20;
  const titleMaxWidth = titleMaxRight - textStartX;
  const titleMaxChars = Math.max(10, Math.floor(titleMaxWidth / 29));
  const titleText = ellipsizeLine(title, titleMaxChars);

  // Avatar + title section
  let avatarClipDef = '';
  let avatarImageSvg = '';
  if (hasAvatar) {
    const avatarCx = contentX + avatarR;
    const avatarCy = author ? titleY - 4 : titleY;
    avatarClipDef = `<clipPath id="avatarClip"><circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" /></clipPath>`;
    avatarImageSvg = `<image clip-path="url(#avatarClip)" href="${avatar}" x="${contentX}" y="${avatarCy - avatarR}" width="${avatarSize}" height="${avatarSize}" />`
      + `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="none" stroke="${COLOR.border}" stroke-width="2.5" />`;
  }

  const titleSvg = `<text x="${textStartX}" y="${titleY}" font-family="${fontFamily}" font-size="52" font-weight="700" fill="${COLOR.fg}">${escapeXml(titleText)}</text>`;

  // Author
  const authorSvg = author
    ? `<text x="${textStartX}" y="${authorY}" font-family="${fontFamily}" font-size="22" font-weight="700" fill="${COLOR.muted}">by ${escapeXml(author)}</text>`
    : '';

  // Description/subtitle with overflow protection.
  const subtitleLineHeight = 30;
  const cardBottom = cardY + cardH - reservedBottom;
  while (subtitleLines.length > 0 && subtitleStartY + (subtitleLines.length - 1) * subtitleLineHeight > cardBottom) {
    subtitleLines.pop();
  }
  const subtitleSvg = subtitleLines
    .map((line, i) => `<text x="${textStartX}" y="${subtitleStartY + i * subtitleLineHeight}" font-family="${fontFamily}" font-size="20" font-weight="700" fill="${COLOR.muted}" opacity="0.7">${escapeXml(line)}</text>`)
    .join('');

  // Install command capsule
  const installSvg = installLayout?.svg ?? '';

  // Logo: large watermark in bottom-right corner
  const logoSize = 360;
  const logoX = cardX + cardW - logoSize + 20;
  const logoY = cardY + cardH - logoSize + 50;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <style>
      @font-face { font-family: 'Poppins'; font-weight: 700; src: url('${font}') format('truetype'); }
    </style>
    <clipPath id="cardClip">
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" />
    </clipPath>
    ${avatarClipDef}
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${COLOR.bg}" />
  <rect x="${cardX + shadowOffset}" y="${cardY + shadowOffset}" width="${cardW}" height="${cardH}" rx="24" fill="${COLOR.border}" />
  <g clip-path="url(#cardClip)">
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" fill="${COLOR.card}" stroke="${COLOR.border}" stroke-width="3" />
    <image href="${logo}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" opacity="0.08" />
    ${tagSvg}
    ${titleSvg}
    ${authorSvg}
    ${subtitleSvg}
    ${installSvg}
    ${avatarImageSvg}
  </g>
</svg>`;
}

export const GET: RequestHandler = async ({ url, platform, request }) => {
  const type = url.searchParams.get('type') || '';
  const slug = url.searchParams.get('slug') || '';
  const version = url.searchParams.get('v')?.trim() || '';
  const hasVersion = version.length > 0;
  const cacheControl = hasVersion ? VERSIONED_CACHE_CONTROL : DEFAULT_CACHE_CONTROL;
  const cacheTtl = hasVersion ? VERSIONED_CACHE_TTL_SECONDS : DEFAULT_CACHE_TTL_SECONDS;
  const etag = buildOgEtag(type, slug, version);
  const cacheKey = buildOgCacheKey(type, slug, version);
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  const ifNoneMatch = request.headers.get('if-none-match');
  const matchesEtag = Boolean(
    ifNoneMatch
      && ifNoneMatch
        .split(',')
        .map((value) => value.trim())
        .includes(etag)
  );

  if (matchesEtag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': cacheControl,
        'X-Cache': 'REVALIDATED',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const { data: pngData, hit } = await getCachedBinary(
    cacheKey,
    async () => {
      let data: OgData;
      try {
        data = (type && slug ? await resolveOgData(type, slug, platform?.env?.DB) : null) ?? DEFAULT_OG;
      } catch {
        data = DEFAULT_OG;
      }

      const title = truncate(data.title, 120) || DEFAULT_TITLE;
      const subtitle = truncate(data.subtitle, 180) || DEFAULT_SUBTITLE;
      const showSubtitle = Boolean(subtitle);
      const tag = truncate(data.tag, 32);
      const author = truncate(data.author, 60);

      const [fontData, logo, avatar] = await Promise.all([
        loadFont(waitUntil),
        getLogoDataUri(url.origin, waitUntil),
        data.avatarUrl ? fetchImageDataUri(data.avatarUrl, waitUntil) : Promise.resolve(null),
      ]);

      const svg = buildSvg(title, subtitle, tag, author, data.stars, data.installCommand, showSubtitle, fontData.dataUri, logo, avatar);

      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: { fontBuffers: [fontData.buffer] },
      });

      return resvg.render().asPng();
    },
    cacheTtl,
    {
      contentType: 'image/png',
      waitUntil,
    }
  );

  const responseBody = Uint8Array.from(pngData);

  return new Response(
    new Blob([responseBody], { type: 'image/png' }),
    {
      headers: {
        'Content-Type': 'image/png',
        ETag: etag,
        'Cache-Control': cacheControl,
        'X-Cache': hit ? 'HIT' : 'MISS',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
};
