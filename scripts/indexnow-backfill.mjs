#!/usr/bin/env node

const DEFAULT_SITE_URL = 'https://skills.cat';
const DEFAULT_INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS_PER_REQUEST = 10_000;
const MIN_URLS_PER_REQUEST = 500;
const DEFAULT_RETRY_AFTER_MS = 10 * 60 * 1000;
const MAX_429_RETRIES = 6;

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: 0,
    siteUrl: process.env.PUBLIC_APP_URL || process.env.SITE_URL || DEFAULT_SITE_URL,
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

function getKeyLocation(siteUrl, key, keyLocation) {
  if (keyLocation) {
    if (/^https?:\/\//i.test(keyLocation)) {
      return keyLocation;
    }
    return `${normalizeOrigin(siteUrl)}${keyLocation.startsWith('/') ? keyLocation : `/${keyLocation}`}`;
  }

  return `${normalizeOrigin(siteUrl)}/${encodeURIComponent(key)}.txt`;
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

async function verifyKeyFile({ keyFileUrl, key }) {
  const response = await fetch(keyFileUrl, {
    headers: {
      'user-agent': 'SkillsCat-IndexNow-Backfill/1.0',
      accept: 'text/plain, */*;q=0.1',
    },
  });

  if (!response.ok) {
    throw new Error(`IndexNow key file check failed for ${keyFileUrl}: ${response.status} ${response.statusText}`);
  }

  const body = (await response.text()).trim();
  if (body !== key) {
    throw new Error(`IndexNow key file check failed for ${keyFileUrl}: response body did not match the configured key.`);
  }
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

function parseRetryAfterMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_RETRY_AFTER_MS;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(seconds * 1000, 1000);
  }

  const retryAt = Date.parse(raw);
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), 1000);
  }

  return DEFAULT_RETRY_AFTER_MS;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function submitChunk({ endpoint, host, key, keyLocation, chunk }) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      host,
      key,
      ...(keyLocation ? { keyLocation } : {}),
      urlList: chunk,
    }),
  });
}

async function submitUrls({ endpoint, host, key, keyLocation, urls, dryRun }) {
  const totalChunks = chunkUrls(urls).length || 1;
  let submittedUrls = 0;
  let chunkIndex = 0;
  let batchSize = MAX_URLS_PER_REQUEST;
  let throttledRetries = 0;

  while (submittedUrls < urls.length) {
    const chunk = urls.slice(submittedUrls, submittedUrls + batchSize);
    chunkIndex += 1;

    if (dryRun) {
      console.log(`[dry-run] chunk ${chunkIndex}/${totalChunks}: ${chunk.length} urls`);
      submittedUrls += chunk.length;
      continue;
    }

    const response = await submitChunk({
      endpoint,
      host,
      key,
      keyLocation,
      chunk,
    });

    if (response.status === 429) {
      throttledRetries += 1;
      if (throttledRetries > MAX_429_RETRIES) {
        throw new Error(`IndexNow submission hit 429 too many times while sending chunk ${chunkIndex}.`);
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      batchSize = Math.max(Math.floor(batchSize / 2), MIN_URLS_PER_REQUEST);
      console.log(`IndexNow returned 429. Waiting ${Math.ceil(retryAfterMs / 1000)}s before retrying chunk ${chunkIndex} with batch size ${batchSize}.`);
      await sleep(retryAfterMs);
      chunkIndex -= 1;
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`IndexNow submission failed for chunk ${chunkIndex}: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }

    throttledRetries = 0;
    submittedUrls += chunk.length;
    console.log(`Submitted chunk ${chunkIndex}/${Math.max(totalChunks, chunkIndex)}: ${chunk.length} urls`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const siteOrigin = normalizeOrigin(options.siteUrl);
  const siteHost = new URL(siteOrigin).host;
  const sitemapUrl = getSitemapUrl(siteOrigin, options.sitemapUrl);
  const key = options.key.trim();
  const keyLocation = key ? getKeyLocation(siteOrigin, key, options.keyLocation) : '';

  if (!options.dryRun && !key) {
    throw new Error('INDEXNOW_KEY is required unless --dry-run is used.');
  }

  if (!options.dryRun) {
    console.log(`Verifying IndexNow key file at ${keyLocation} ...`);
    await verifyKeyFile({ keyFileUrl: keyLocation, key });
    console.log('IndexNow key file verified.');
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
    key,
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
