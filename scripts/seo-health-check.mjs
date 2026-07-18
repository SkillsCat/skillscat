#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_SITE_URL = 'https://skills.cat';
const DEFAULT_FRESHNESS_HOURS = 72;
const DEFAULT_SAMPLE_SIZE = 5;
const MAX_SAMPLE_SIZE = 25;
const MAX_SITEMAP_INDEX_ENTRIES = 50_000;
const MAX_SITEMAP_URL_ENTRIES = 10_000;
const MAX_RECENT_SITEMAP_URL_ENTRIES = 1_000;
const SITEMAP_CHECK_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'SkillsCat-SEO-Health/1.0';

export function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function extractSitemapEntries(xml) {
  return [...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)].map((match) => {
    const block = match[1];
    const loc = /<loc>(.*?)<\/loc>/i.exec(block)?.[1]?.trim() || '';
    const lastmod = /<lastmod>(.*?)<\/lastmod>/i.exec(block)?.[1]?.trim() || '';
    return { loc: decodeXml(loc), lastmod };
  });
}

export function extractUrlEntries(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => {
    const block = match[1];
    const loc = /<loc>(.*?)<\/loc>/i.exec(block)?.[1]?.trim() || '';
    const lastmod = /<lastmod>(.*?)<\/lastmod>/i.exec(block)?.[1]?.trim() || '';
    return { loc: decodeXml(loc), lastmod };
  });
}

export function isFreshSitemapDate(lastmod, freshnessHours, now = Date.now()) {
  const parsed = Date.parse(lastmod);
  if (!Number.isFinite(parsed)) return false;
  return parsed >= now - freshnessHours * 60 * 60 * 1000;
}

export function selectEvenlySpaced(items, count) {
  const sampleSize = Math.min(items.length, Math.max(0, Math.trunc(count)));
  if (sampleSize === 0) return [];
  if (sampleSize === 1) return [items[0]];
  if (sampleSize === items.length) return [...items];

  return Array.from({ length: sampleSize }, (_, index) => {
    const sourceIndex = Math.round(index * (items.length - 1) / (sampleSize - 1));
    return items[sourceIndex];
  });
}

export function validateSitemapLocations(entries, options) {
  const { origin, label, maxEntries, pathPrefix = '' } = options;
  assert(entries.length <= maxEntries, `${label} has ${entries.length} entries; max is ${maxEntries}`);

  const seen = new Set();
  for (const entry of entries) {
    assert(entry.loc, `${label} contains an entry without loc`);

    let parsed;
    try {
      parsed = new URL(entry.loc);
    } catch {
      throw new Error(`${label} contains invalid URL: ${entry.loc}`);
    }

    assert(parsed.origin === origin, `${label} contains cross-origin URL: ${entry.loc}`);
    assert(!parsed.hash, `${label} contains a fragment URL: ${entry.loc}`);
    assert(!pathPrefix || parsed.pathname.startsWith(pathPrefix), `${label} contains unexpected path: ${entry.loc}`);
    assert(!seen.has(parsed.href), `${label} contains duplicate URL: ${entry.loc}`);
    seen.add(parsed.href);

    if (entry.lastmod) {
      const parsedLastmod = Date.parse(entry.lastmod);
      assert(Number.isFinite(parsedLastmod), `${label} contains invalid lastmod: ${entry.lastmod}`);
      assert(parsedLastmod <= Date.now() + 24 * 60 * 60 * 1000, `${label} contains future lastmod: ${entry.lastmod}`);
    }
  }
}

export function validateIndexablePageHtml(body, expectedUrl) {
  const canonicalMatches = [...body.matchAll(/<link rel="canonical" href="([^"]+)"/gi)];
  assert(canonicalMatches.length === 1, 'expected exactly one canonical');
  assert(decodeXml(canonicalMatches[0][1]) === expectedUrl, 'canonical is not self-referencing');

  const robots = /<meta name="robots" content="([^"]+)"/i.exec(body)?.[1] || '';
  assert(hasRobotsDirective(robots, 'index'), `missing index robots directive: ${robots || 'none'}`);
  assert(hasRobotsDirective(robots, 'follow'), `missing follow robots directive: ${robots || 'none'}`);
  assert(!hasRobotsDirective(robots, 'noindex'), `unexpected noindex robots directive: ${robots}`);
  assert(/<title>[^<]+<\/title>/i.test(body), 'title is missing or empty');
  assert(/<meta name="description" content="[^"]+"/i.test(body), 'meta description is missing or empty');
}

export function validateIndexableSkillHtml(body, expectedUrl) {
  validateIndexablePageHtml(body, expectedUrl);
  assert(body.includes('"@type":"SoftwareSourceCode"'), 'SoftwareSourceCode structured data missing');
}

function parseArgs(argv) {
  const options = {
    siteUrl: process.env.PUBLIC_APP_URL || process.env.SITE_URL || DEFAULT_SITE_URL,
    freshnessHours: DEFAULT_FRESHNESS_HOURS,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    skipWww: false,
    skillUrl: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--skip-www') {
      options.skipWww = true;
      continue;
    }
    if (arg === '--site') {
      options.siteUrl = argv[index + 1] || options.siteUrl;
      index += 1;
      continue;
    }
    if (arg === '--skill') {
      options.skillUrl = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--freshness-hours') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--freshness-hours must be a positive number.');
      }
      options.freshnessHours = value;
      index += 1;
      continue;
    }
    if (arg === '--sample-size') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > MAX_SAMPLE_SIZE) {
        throw new Error(`--sample-size must be an integer between 0 and ${MAX_SAMPLE_SIZE}.`);
      }
      options.sampleSize = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeOrigin(value) {
  return new URL(value).origin;
}

async function request(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      'user-agent': USER_AGENT,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function fetchText(url, init) {
  const response = await request(url, init);
  const body = await response.text();
  return { response, body };
}

function hasRobotsDirective(value, directive) {
  return String(value || '')
    .toLowerCase()
    .split(',')
    .map((part) => part.trim())
    .includes(directive);
}

async function runCheck(name, callback, results) {
  try {
    const detail = await callback();
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail: message });
    console.error(`FAIL ${name} - ${message}`);
  }
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(items[index], index);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

async function auditIndexableHtmlUrl(pageUrl, origin, validateHtml) {
  const parsed = new URL(pageUrl, origin);
  assert(parsed.origin === origin, `sample is on another host: ${pageUrl}`);
  const startedAt = performance.now();
  const { response, body } = await fetchText(parsed.toString(), { redirect: 'follow' });
  const elapsedMs = performance.now() - startedAt;
  assert(response.ok, `${parsed.pathname} returned HTTP ${response.status}`);
  assert(!response.redirected, `${parsed.pathname} unexpectedly redirected to ${response.url}`);
  assert(
    (response.headers.get('content-type') || '').includes('text/html'),
    `${parsed.pathname} has wrong content type`
  );
  assert(
    !hasRobotsDirective(response.headers.get('x-robots-tag'), 'noindex'),
    `${parsed.pathname} has an unexpected X-Robots-Tag noindex`
  );
  validateHtml(body, parsed.toString());
  return elapsedMs;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const origin = normalizeOrigin(options.siteUrl);
  const results = [];
  let sitemapEntries = [];
  let coreEntries = [];
  let recentEntries = [];

  await runCheck('robots.txt', async () => {
    const { response, body } = await fetchText(`${origin}/robots.txt`);
    assert(response.ok, `HTTP ${response.status}`);
    assert(body.includes(`Sitemap: ${origin}/sitemap.xml`), 'missing canonical sitemap declaration');
    assert(!/^Disallow:\s*\/$/im.test(body), 'root path is disallowed');
    return 'crawl allowed';
  }, results);

  await runCheck('sitemap index', async () => {
    const { response, body } = await fetchText(`${origin}/sitemap.xml`);
    assert(response.ok, `HTTP ${response.status}`);
    assert((response.headers.get('content-type') || '').includes('application/xml'), 'wrong content type');
    assert(/<sitemapindex[\s>]/i.test(body), 'not a sitemap index');
    sitemapEntries = extractSitemapEntries(body);
    validateSitemapLocations(sitemapEntries, {
      origin,
      label: 'sitemap index',
      maxEntries: MAX_SITEMAP_INDEX_ENTRIES,
      pathPrefix: '/sitemaps/',
    });
    assert(sitemapEntries.some((entry) => entry.loc === `${origin}/sitemaps/core.xml`), 'core sitemap missing');
    assert(sitemapEntries.some((entry) => entry.loc === `${origin}/sitemaps/recent-skills.xml`), 'recent skills sitemap missing');
    return `${sitemapEntries.length} child sitemaps`;
  }, results);

  await runCheck('sitemap child availability', async () => {
    assert(sitemapEntries.length > 0, 'sitemap index is empty');
    const timings = await mapWithConcurrency(
      sitemapEntries,
      SITEMAP_CHECK_CONCURRENCY,
      async (entry) => {
        const startedAt = performance.now();
        const response = await request(entry.loc, { method: 'HEAD', redirect: 'manual' });
        const elapsedMs = performance.now() - startedAt;
        assert(response.ok, `${entry.loc} returned HTTP ${response.status}`);
        assert(
          (response.headers.get('content-type') || '').includes('application/xml'),
          `${entry.loc} has wrong content type`
        );
        assert(
          /(?:^|,)\s*s-maxage=\d+/i.test(response.headers.get('cache-control') || ''),
          `${entry.loc} is missing shared cache control`
        );
        return elapsedMs;
      }
    );
    const slowestMs = Math.max(...timings);
    return `${sitemapEntries.length} cached XML endpoints, slowest ${Math.round(slowestMs)}ms`;
  }, results);

  await runCheck('core sitemap integrity', async () => {
    const { response, body } = await fetchText(`${origin}/sitemaps/core.xml`);
    assert(response.ok, `HTTP ${response.status}`);
    assert(/<urlset[\s>]/i.test(body), 'not a sitemap URL set');
    coreEntries = extractUrlEntries(body);
    assert(coreEntries.length > 0, 'core sitemap is empty');
    validateSitemapLocations(coreEntries, {
      origin,
      label: 'core sitemap',
      maxEntries: MAX_SITEMAP_URL_ENTRIES,
    });
    return `${coreEntries.length} unique same-origin urls`;
  }, results);

  if (options.sampleSize > 0) {
    await runCheck('core page SEO samples', async () => {
      const pageUrls = selectEvenlySpaced(coreEntries.map((entry) => entry.loc), options.sampleSize);
      assert(pageUrls.length > 0, 'no core URLs available for sampling');
      const timings = await mapWithConcurrency(
        pageUrls,
        SITEMAP_CHECK_CONCURRENCY,
        (pageUrl) => auditIndexableHtmlUrl(pageUrl, origin, validateIndexablePageHtml)
      );
      const averageMs = timings.reduce((sum, value) => sum + value, 0) / timings.length;
      return `${pageUrls.length} pages, average ${Math.round(averageMs)}ms`;
    }, results);
  } else {
    console.log('SKIP core page SEO samples - --sample-size is 0');
  }

  await runCheck('sitemap index freshness', async () => {
    const recent = sitemapEntries.find((entry) => entry.loc === `${origin}/sitemaps/recent-skills.xml`);
    assert(recent, 'recent skills sitemap entry missing');
    assert(
      isFreshSitemapDate(recent.lastmod, options.freshnessHours),
      `recent skills index lastmod ${recent.lastmod || 'missing'} is stale`
    );
    return `recent skills lastmod ${recent.lastmod}`;
  }, results);

  await runCheck('recent sitemap freshness', async () => {
    const { response, body } = await fetchText(`${origin}/sitemaps/recent-skills.xml`);
    assert(response.ok, `HTTP ${response.status}`);
    recentEntries = extractUrlEntries(body);
    assert(recentEntries.length > 0, 'recent sitemap is empty');
    validateSitemapLocations(recentEntries, {
      origin,
      label: 'recent skills sitemap',
      maxEntries: MAX_RECENT_SITEMAP_URL_ENTRIES,
      pathPrefix: '/skills/',
    });
    const latest = recentEntries.map((entry) => entry.lastmod).filter(Boolean).sort().at(-1) || '';
    assert(isFreshSitemapDate(latest, options.freshnessHours), `latest lastmod ${latest || 'missing'} is stale`);
    return `${recentEntries.length} urls, latest ${latest}`;
  }, results);

  await runCheck('deep pagination status', async () => {
    const response = await request(`${origin}/trending?page=999999`, { method: 'HEAD', redirect: 'manual' });
    assert(response.status === 404, `expected 404, got ${response.status}`);
    return '404';
  }, results);

  await runCheck('deep search pagination status', async () => {
    const response = await request(`${origin}/search?q=seo-health-check&page=999999`, {
      method: 'HEAD',
      redirect: 'manual',
    });
    assert(response.status === 404, `expected 404, got ${response.status}`);
    return '404';
  }, results);

  await runCheck('search robots', async () => {
    const response = await request(`${origin}/search?q=seo-health-check`, { method: 'HEAD' });
    const robots = response.headers.get('x-robots-tag');
    assert(response.ok, `HTTP ${response.status}`);
    assert(hasRobotsDirective(robots, 'noindex'), `missing noindex: ${robots || 'none'}`);
    assert(hasRobotsDirective(robots, 'follow'), `missing follow: ${robots || 'none'}`);
    return robots;
  }, results);

  for (const path of ['/llm.txt', '/marketplace.json']) {
    await runCheck(`${path} robots`, async () => {
      const response = await request(`${origin}${path}`, { method: 'HEAD' });
      const robots = response.headers.get('x-robots-tag');
      assert(response.ok, `HTTP ${response.status}`);
      assert(hasRobotsDirective(robots, 'noindex'), `missing noindex: ${robots || 'none'}`);
      return robots;
    }, results);
  }

  if (options.skillUrl || options.sampleSize > 0) {
    await runCheck('skill SEO samples', async () => {
      const skillUrls = options.skillUrl
        ? [new URL(options.skillUrl, origin).toString()]
        : selectEvenlySpaced(recentEntries.map((entry) => entry.loc), options.sampleSize);
      assert(skillUrls.length > 0, 'no skill URLs available for sampling');

      const timings = await mapWithConcurrency(skillUrls, SITEMAP_CHECK_CONCURRENCY, async (skillUrl) => {
        return auditIndexableHtmlUrl(skillUrl, origin, validateIndexableSkillHtml);
      });

      const averageMs = timings.reduce((sum, value) => sum + value, 0) / timings.length;
      return `${skillUrls.length} pages, average ${Math.round(averageMs)}ms`;
    }, results);
  } else {
    console.log('SKIP skill SEO samples - --sample-size is 0');
  }

  await runCheck('not-found skill status', async () => {
    const response = await request(`${origin}/skills/seo-health-check/not-a-real-skill`, {
      method: 'HEAD',
      redirect: 'manual',
    });
    assert(response.status === 404, `expected 404, got ${response.status}`);
    return '404';
  }, results);

  await runCheck('OG image', async () => {
    const response = await request(`${origin}/og?title=SkillsCat%20SEO%20Health`);
    const contentType = response.headers.get('content-type') || '';
    const bytes = (await response.arrayBuffer()).byteLength;
    assert(response.ok, `HTTP ${response.status}`);
    assert(contentType.includes('image/png'), `wrong content type: ${contentType || 'none'}`);
    assert(bytes > 1000, `image is unexpectedly small: ${bytes} bytes`);
    return `${bytes} bytes`;
  }, results);

  if (!options.skipWww && new URL(origin).hostname === 'skills.cat') {
    await runCheck('www canonical redirect', async () => {
      const response = await request(`https://www.skills.cat/seo-health-check?source=www`, {
        method: 'HEAD',
        redirect: 'manual',
      });
      assert([301, 308].includes(response.status), `expected permanent redirect, got ${response.status}`);
      assert(response.headers.get('location') === `${origin}/seo-health-check?source=www`, 'wrong redirect location');
      return `${response.status} to apex`;
    }, results);
  }

  const indexNowKey = (process.env.INDEXNOW_KEY || '').trim();
  if (indexNowKey) {
    await runCheck('IndexNow key file', async () => {
      const configuredLocation = (process.env.INDEXNOW_KEY_LOCATION || '').trim();
      const keyUrl = configuredLocation
        ? new URL(configuredLocation, origin).toString()
        : `${origin}/${encodeURIComponent(indexNowKey)}.txt`;
      const { response, body } = await fetchText(keyUrl);
      assert(response.ok, `HTTP ${response.status}`);
      assert(body.trim() === indexNowKey, 'key file body mismatch');
      return 'verified';
    }, results);
  } else {
    console.log('SKIP IndexNow key file - INDEXNOW_KEY not provided');
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`SEO health summary: ${results.length - failed.length} passed, ${failed.length} failed.`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
