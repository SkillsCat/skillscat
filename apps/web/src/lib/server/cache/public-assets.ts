import { getCachedResponse } from '$lib/server/cache';

type WaitUntilFn = (promise: Promise<unknown>) => void;

interface PublicAssetOptions {
  url: string;
  cacheKeyPrefix: string;
  ttlSeconds: number;
  headers?: HeadersInit;
  waitUntil?: WaitUntilFn;
}

function normalizeHeadersForKey(headers: Headers): string {
  return [...headers.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey.localeCompare(rightKey);
      return leftValue.localeCompare(rightValue);
    })
    .map(([key, value]) => `${key}:${value}`)
    .join('\n');
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function buildPublicAssetCacheKey(url: string, headers: Headers, cacheKeyPrefix: string): Promise<string> {
  const canonical = `${url}\n${normalizeHeadersForKey(headers)}`;
  const digest = await sha256Hex(canonical);
  return `${cacheKeyPrefix}:${digest}`;
}

export async function fetchPublicAssetResponse({
  url,
  cacheKeyPrefix,
  ttlSeconds,
  headers,
  waitUntil,
}: PublicAssetOptions): Promise<{ response: Response; hit: boolean }> {
  const requestHeaders = new Headers(headers ?? {});
  const cacheKey = await buildPublicAssetCacheKey(url, requestHeaders, cacheKeyPrefix);

  return getCachedResponse(
    cacheKey,
    () => fetch(url, { headers: requestHeaders }),
    ttlSeconds,
    {
      waitUntil,
      shouldCache: (response) => response.ok,
    },
  );
}

export async function fetchPublicTextAsset(
  options: PublicAssetOptions,
): Promise<{ data: string; contentType: string | null; hit: boolean }> {
  const { response, hit } = await fetchPublicAssetResponse(options);
  if (!response.ok) {
    throw new Error(`Failed to fetch text asset: ${options.url} (${response.status})`);
  }

  return {
    data: await response.text(),
    contentType: response.headers.get('content-type'),
    hit,
  };
}

export async function fetchPublicBinaryAsset(
  options: PublicAssetOptions,
): Promise<{ data: Uint8Array; contentType: string | null; hit: boolean }> {
  const { response, hit } = await fetchPublicAssetResponse(options);
  if (!response.ok) {
    throw new Error(`Failed to fetch binary asset: ${options.url} (${response.status})`);
  }

  return {
    data: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
    hit,
  };
}

export async function fetchPublicDataUri(
  options: PublicAssetOptions,
): Promise<{ dataUri: string; contentType: string; hit: boolean }> {
  const { data, contentType, hit } = await fetchPublicBinaryAsset(options);
  const resolvedContentType = contentType || 'application/octet-stream';

  return {
    dataUri: `data:${resolvedContentType};base64,${bytesToBase64(data)}`,
    contentType: resolvedContentType,
    hit,
  };
}
