import type { RequestHandler } from './$types';
import { Resvg } from '@cf-wasm/resvg';
import { SITE_TITLE, SITE_DESCRIPTION, SITE_OG_DEFAULT_SUBTITLE } from '$lib/seo/constants';
import { getSkillBySlug, type DbEnv } from '$lib/server/db/utils';
import { getCategoryBySlug } from '$lib/constants/categories';

const WIDTH = 1200;
const HEIGHT = 630;
const DEFAULT_TITLE = 'SkillsCat';
const DEFAULT_SUBTITLE = SITE_OG_DEFAULT_SUBTITLE;
const DEFAULT_TAG = 'skills.cat';

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
  installSlug: string;
}

const STATIC_PAGES: Record<string, OgData> = {
  home: { title: SITE_TITLE, subtitle: SITE_DESCRIPTION, tag: 'Home', author: '', avatarUrl: '', stars: 0, installSlug: '' },
  trending: { title: 'Trending Skills', subtitle: SITE_DESCRIPTION, tag: 'Trending', author: '', avatarUrl: '', stars: 0, installSlug: '' },
  top: { title: 'Top Rated Skills', subtitle: SITE_DESCRIPTION, tag: 'Top Rated', author: '', avatarUrl: '', stars: 0, installSlug: '' },
  recent: { title: 'Recently Added Skills', subtitle: SITE_DESCRIPTION, tag: 'Recent', author: '', avatarUrl: '', stars: 0, installSlug: '' },
  categories: { title: 'Categories', subtitle: SITE_DESCRIPTION, tag: 'Categories', author: '', avatarUrl: '', stars: 0, installSlug: '' },
  privacy: { title: 'Privacy Policy', subtitle: SITE_DESCRIPTION, tag: 'Policy', author: '', avatarUrl: '', stars: 0, installSlug: '' },
  terms: { title: 'Terms of Service', subtitle: SITE_DESCRIPTION, tag: 'Policy', author: '', avatarUrl: '', stars: 0, installSlug: '' },
  '404': { title: 'Page Not Found', subtitle: 'The requested page does not exist.', tag: '404', author: '', avatarUrl: '', stars: 0, installSlug: '' },
};

const DEFAULT_OG: OgData = {
  title: DEFAULT_TITLE,
  subtitle: DEFAULT_SUBTITLE,
  tag: DEFAULT_TAG,
  author: '',
  avatarUrl: '',
  stars: 0,
  installSlug: '',
};

// --- Data resolvers ---

async function resolveSkill(slug: string, env: DbEnv): Promise<OgData | null> {
  if (!env.DB) return null;
  const skill = await getSkillBySlug(env, slug, null);
  if (!skill || skill.visibility !== 'public') return null;
  const author = skill.authorDisplayName || skill.repoOwner || '';
  const categories = skill.categories || [];
  const firstCat = categories.length > 0 ? getCategoryBySlug(categories[0]) : null;
  const avatarUrl = skill.authorAvatar || `https://github.com/${skill.repoOwner}.png?size=128`;
  return {
    title: skill.name,
    subtitle: skill.description || `AI agent skill: ${skill.name}`,
    tag: firstCat ? firstCat.name : '',
    author,
    avatarUrl,
    stars: skill.stars || 0,
    installSlug: slug,
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
    installSlug: '',
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
    installSlug: '',
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
    installSlug: '',
  };
}

async function resolveOgData(
  type: string, slug: string, env: DbEnv,
): Promise<OgData | null> {
  switch (type) {
    case 'skill': return resolveSkill(slug, env);
    case 'user': return env.DB ? resolveUser(slug, env.DB) : null;
    case 'org': return env.DB ? resolveOrg(slug, env.DB) : null;
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
  if (token === 'add') return COLOR.primary;
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
  const tokens = command.split(/\s+/).filter(Boolean);
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

function buildInstallCapsule(installSlug: string, cardX: number, cardY: number, cardW: number, cardH: number): { svg: string; reservedBottom: number } {
  const installText = `npx skillscat add ${installSlug}`;
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

async function loadFont(): Promise<{ buffer: Uint8Array; dataUri: string }> {
  if (fontBuffer && fontDataUri) return { buffer: fontBuffer, dataUri: fontDataUri };
  // Fetch TTF for resvg (it doesn't support woff2).
  // Use CSS v1 API + Android 4.x UA — Google Fonts serves TTF to these clients.
  const css = await fetch(
    'https://fonts.googleapis.com/css?family=Poppins:700',
    { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30' } },
  ).then((r) => r.text());
  const urlMatch = css.match(/src:\s*[^;]*url\(([^)]+)\)/);
  if (!urlMatch) throw new Error('Failed to extract font URL');
  const buf = await fetch(urlMatch[1]).then((r) => r.arrayBuffer());
  fontBuffer = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < fontBuffer.length; i++) binary += String.fromCharCode(fontBuffer[i]);
  fontDataUri = `data:font/truetype;base64,${btoa(binary)}`;
  return { buffer: fontBuffer, dataUri: fontDataUri };
}

async function getLogoDataUri(origin: string): Promise<string> {
  if (logoDataUri) return logoDataUri;
  const buf = await fetch(`${origin}/favicon-128x128.png`).then((r) => r.arrayBuffer());
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  logoDataUri = `data:image/png;base64,${btoa(binary)}`;
  return logoDataUri;
}

async function fetchImageDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const ct = res.headers.get('content-type') || 'image/png';
    return `data:${ct};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function buildSvg(
  title: string,
  subtitle: string,
  tag: string,
  author: string,
  stars: number,
  installSlug: string,
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
  const hasInstall = !!installSlug;
  const installLayout = hasInstall ? buildInstallCapsule(installSlug, cardX, cardY, cardW, cardH) : null;
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

export const GET: RequestHandler = async ({ url, platform }) => {
  const type = url.searchParams.get('type') || '';
  const slug = url.searchParams.get('slug') || '';

  const env: DbEnv = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    KV: platform?.env?.KV,
    CACHE_VERSION: platform?.env?.CACHE_VERSION,
  };

  let data: OgData;
  try {
    data = (type && slug ? await resolveOgData(type, slug, env) : null) ?? DEFAULT_OG;
  } catch {
    data = DEFAULT_OG;
  }

  const title = truncate(data.title, 120) || DEFAULT_TITLE;
  const subtitle = truncate(data.subtitle, 180) || DEFAULT_SUBTITLE;
  const showSubtitle = Boolean(subtitle);
  const tag = truncate(data.tag, 32);
  const author = truncate(data.author, 60);

  const [fontData, logo, avatar] = await Promise.all([
    loadFont(),
    getLogoDataUri(url.origin),
    data.avatarUrl ? fetchImageDataUri(data.avatarUrl) : Promise.resolve(null),
  ]);

  const svg = buildSvg(title, subtitle, tag, author, data.stars, data.installSlug, showSubtitle, fontData.dataUri, logo, avatar);

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontBuffers: [fontData.buffer] },
  });
  const pngData = resvg.render().asPng();

  return new Response(pngData.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
