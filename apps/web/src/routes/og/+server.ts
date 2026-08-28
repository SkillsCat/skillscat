import type { RequestHandler } from './$types';
import { Resvg } from '@cf-wasm/resvg';
import { normalizePublicAvatarUrl } from '$lib/avatar';
import { SITE_NAME, SITE_DESCRIPTION, SITE_OG_DEFAULT_SUBTITLE, SITE_URL } from '$lib/seo/constants';
import { OG_IMAGE_VERSION, OG_IMAGE_WIDTH } from '$lib/seo/og';
import { buildOgSvg } from '$lib/seo/og-svg';
import { getCachedBinary } from '$lib/server/cache';
import {
  fetchPublicBinaryAsset,
  fetchPublicDataUri,
  fetchPublicTextAsset,
} from '$lib/server/cache/public-assets';
import { getCategoryBySlug } from '$lib/constants/categories';
import { buildSkillscatInstallCommand } from '$lib/skill-install';
import { getCurrentSkillVisibility } from '$lib/server/skill/visibility';

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
const FALLBACK_LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#d4842a"/><path d="M28 52 34 26l23 16a31 31 0 0 1 14 0l23-16 6 26v24a36 36 0 0 1-72 0z" fill="#f9a64d"/><circle cx="51" cy="67" r="5" fill="#3d3830"/><circle cx="77" cy="67" r="5" fill="#3d3830"/><path d="m64 73 5 4-5 4-5-4zM64 81c-5 7-12 7-16 3m16-3c5 7 12 7 16 3" fill="none" stroke="#3d3830" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)}`;

type WaitUntilFn = (promise: Promise<unknown>) => void;

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

// --- Resource caching ---
let fontBuffers: Uint8Array[] | null = null;
let logoDataUri: string | null = null;
const LOGO_CANDIDATE_PATHS = ['/favicon-128x128.png', '/favicon-256x256.png'] as const;

// Fetch TTFs for resvg (it doesn't support woff2).
// Use CSS v1 API + Android 4.x UA — Google Fonts serves TTF to these clients.
const FONT_CSS_SOURCES = [
  'https://fonts.googleapis.com/css?family=Poppins:700,800',
  'https://fonts.googleapis.com/css?family=JetBrains+Mono:700',
] as const;

async function loadFonts(waitUntil?: WaitUntilFn): Promise<Uint8Array[]> {
  if (fontBuffers) return fontBuffers;
  const buffers: Uint8Array[] = [];
  for (const cssUrl of FONT_CSS_SOURCES) {
    const { data: css } = await fetchPublicTextAsset({
      url: cssUrl,
      cacheKeyPrefix: `asset:og:font-css:${fnv1aHex(cssUrl)}`,
      ttlSeconds: PUBLIC_FONT_ASSET_TTL_SECONDS,
      waitUntil,
      headers: {
        'User-Agent': GOOGLE_TTF_USER_AGENT,
      },
    });
    const fontUrls = Array.from(css.matchAll(/url\(([^)]+)\)/g), (match) => match[1]);
    if (fontUrls.length === 0) throw new Error('Failed to extract font URL');
    for (const fontUrl of fontUrls) {
      const { data } = await fetchPublicBinaryAsset({
        url: fontUrl,
        cacheKeyPrefix: 'asset:og:font-file',
        ttlSeconds: PUBLIC_FONT_ASSET_TTL_SECONDS,
        waitUntil,
      });
      buffers.push(data);
    }
  }
  fontBuffers = buffers;
  return fontBuffers;
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

  // A broken logo asset must not turn every social preview into a 500.
  // The inline fallback also avoids a self-fetch loop when the static asset
  // binding is unavailable during a cold Worker invocation.
  return FALLBACK_LOGO_DATA_URI;
}

export const GET: RequestHandler = async ({ url, platform, request }) => {
  const requestedType = url.searchParams.get('type') || '';
  const requestedSlug = url.searchParams.get('slug') || '';
  const requestedVersion = url.searchParams.get('v')?.trim() || '';
  let currentVisibility: string | null = null;
  let visibilityCheckFailed = false;
  if (requestedType === 'skill' && requestedSlug && platform?.env?.DB) {
    try {
      currentVisibility = await getCurrentSkillVisibility(platform.env.DB, requestedSlug);
    } catch {
      // Never fail a social preview because D1 is temporarily unavailable.
      // A generic image is safer than accidentally exposing a private skill.
      visibilityCheckFailed = true;
    }
  }
  const useGenericSkillImage = requestedType === 'skill'
    && (visibilityCheckFailed
      || (currentVisibility !== 'public' && currentVisibility !== 'unlisted'));
  const type = useGenericSkillImage ? 'page' : requestedType;
  const slug = useGenericSkillImage ? '404' : requestedSlug;
  const version = useGenericSkillImage ? OG_IMAGE_VERSION : requestedVersion;
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
        'Content-Type': 'image/png',
        'Access-Control-Allow-Origin': '*',
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
      const rawAuthor = truncate(data.author, 60);
      // Profile/org cards already use the name as the title — don't repeat it.
      const author = rawAuthor === title ? '' : rawAuthor;

      const [fonts, logo, avatar] = await Promise.all([
        loadFonts(waitUntil).catch(() => [] as Uint8Array[]),
        getLogoDataUri(url.origin, waitUntil),
        data.avatarUrl ? fetchImageDataUri(data.avatarUrl, waitUntil) : Promise.resolve(null),
      ]);

      const svg = buildOgSvg({
        title,
        subtitle,
        tag,
        author,
        stars: data.stars,
        installCommand: data.installCommand,
        showSubtitle,
        logo,
        avatar,
      });

      const resvg = await Resvg.async(svg, {
        fitTo: { mode: 'width', value: OG_IMAGE_WIDTH },
        ...(fonts.length > 0 ? { font: { fontBuffers: fonts, defaultFontFamily: 'Poppins' } } : {}),
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
        'Content-Length': String(responseBody.byteLength),
        'Content-Disposition': 'inline; filename="skills-cat-og.png"',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        ETag: etag,
        'Cache-Control': cacheControl,
        'X-Cache': hit ? 'HIT' : 'MISS',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
};
