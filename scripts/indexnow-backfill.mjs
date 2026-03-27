#!/usr/bin/env node

const DEFAULT_SITE_URL = 'https://skills.cat';
const DEFAULT_INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const DEFAULT_KEY_LOCATION_PATH = '/indexnow.txt';
const MAX_URLS_PER_REQUEST = 10_000;

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: 0,
    siteUrl: process.env.SITE_URL || DEFAULT_SITE_URL,
    sitemapUrl: process.env.INDEXNOW_SITEMAP_URL || '',
    endpoint: process.env.INDEXNOW_API_URL || DEFAULT_INDEXNOW_ENDPOINT,
    key: process.env.INDEXNOW_KEY || '',
    keyLocation: process.env.INDEXNOW_KEY_LOCATION || '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--limit') {
      const value = Number(argv[index + 1] || '0');
      options.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      index += 1;
      continue;
    }

    if (arg === '--site') {
      options.siteUrl = argv[index + 1] || options.siteUrl;
      index += 1;
      continue;
    }

    if (arg === '--sitemap') {
      options.sitemapUrl = argv[index + 1] || options.sitemapUrl;
      index += 1;
      continue;
    }

    if (arg === '--endpoint') {
      options.endpoint = argv[index + 1] || options.endpoint;
      index += 1;
      continue;
    }

    if (arg === '--key') {
      options.key = argv[index + 1] || options.key;
      index += 1;
      continue;
    }

    if (arg === '--key-location') {
      options.keyLocation = argv[index + 1] || options.keyLocation;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeOrigin(input) {
  return new URL(input).origin.replace(/\/+$/, '');
}

function getSitemapUrl(siteUrl, sitemapUrl) {
  return sitemapUrl || `${normalizeOrigin(siteUrl)}/sitemap.xml`;
}

function getKeyLocation(siteUrl, keyLocation) {
  if (keyLocation) {
    if (/^https?:\/\//i.test(keyLocation)) {
      return keyLocation;
    }
    return `${normalizeOrigin(siteUrl)}${keyLocation.startsWith('/') ? keyLocation : `/${keyLocation}`}`;
  }

  return `${normalizeOrigin(siteUrl)}${DEFAULT_KEY_LOCATION_PATH}`;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/gis)].map((match) => decodeXml(match[1].trim()));
}

function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'SkillsCat-IndexNow-Backfill/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function collectUrlsFromSitemap(startUrl, siteHost, visited = new Set()) {
  if (visited.has(startUrl)) {
    return [];
  }
  visited.add(startUrl);

  const xml = await fetchText(startUrl);
  const locs = extractLocs(xml);

  if (isSitemapIndex(xml)) {
    const allUrls = [];
    for (const loc of locs) {
      if (new URL(loc).host !== siteHost) {
        continue;
      }
      allUrls.push(...await collectUrlsFromSitemap(loc, siteHost, visited));
    }
    return allUrls;
  }

  return locs.filter((loc) => {
    try {
      return new URL(loc).host === siteHost;
    } catch {
      return false;
    }
  });
}

function chunkUrls(urls) {
  const chunks = [];

  for (let index = 0; index < urls.length; index += MAX_URLS_PER_REQUEST) {
    chunks.push(urls.slice(index, index + MAX_URLS_PER_REQUEST));
  }

  return chunks;
}

async function submitUrls({ endpoint, host, key, keyLocation, urls, dryRun }) {
  const chunks = chunkUrls(urls);

  for (const [index, chunk] of chunks.entries()) {
    if (dryRun) {
      console.log(`[dry-run] chunk ${index + 1}/${chunks.length}: ${chunk.length} urls`);
      continue;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        host,
        key,
        keyLocation,
        urlList: chunk,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`IndexNow submission failed for chunk ${index + 1}: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }

    console.log(`Submitted chunk ${index + 1}/${chunks.length}: ${chunk.length} urls`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const siteOrigin = normalizeOrigin(options.siteUrl);
  const siteHost = new URL(siteOrigin).host;
  const sitemapUrl = getSitemapUrl(siteOrigin, options.sitemapUrl);
  const keyLocation = getKeyLocation(siteOrigin, options.keyLocation);

  if (!options.dryRun && !options.key.trim()) {
    throw new Error('INDEXNOW_KEY is required unless --dry-run is used.');
  }

  console.log(`Collecting URLs from ${sitemapUrl} ...`);
  const collectedUrls = await collectUrlsFromSitemap(sitemapUrl, siteHost);
  const dedupedUrls = [...new Set(collectedUrls)];
  const limitedUrls = options.limit > 0 ? dedupedUrls.slice(0, options.limit) : dedupedUrls;

  console.log(`Collected ${collectedUrls.length} URLs, deduped to ${dedupedUrls.length}.`);
  if (options.limit > 0) {
    console.log(`Applying limit: ${limitedUrls.length} URLs will be submitted.`);
  }

  await submitUrls({
    endpoint: options.endpoint,
    host: siteHost,
    key: options.key.trim(),
    keyLocation,
    urls: limitedUrls,
    dryRun: options.dryRun,
  });

  console.log(options.dryRun ? 'Dry run complete.' : 'IndexNow backfill complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
