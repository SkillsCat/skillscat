import type { PageServerLoad } from './$types';

function isAllowedRedirectUri(value: string): boolean {
  if (!value) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:') return false;

  const host = parsed.hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function decodeLabel(value: string | null): string | null {
  if (!value) return null;

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes).trim();
    return decoded ? decoded.slice(0, 80) : null;
  } catch {
    return null;
  }
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth?.();
  const redirectUri = (url.searchParams.get('redirect_uri') ?? '').trim();
  const state = (url.searchParams.get('state') ?? '').trim();
  const label =
    decodeLabel(url.searchParams.get('label_b64')) ||
    (url.searchParams.get('label') ?? '').trim() ||
    'ClawHub CLI token';

  return {
    user: session?.user ?? null,
    redirectUri,
    state,
    label,
    isValidRedirect: isAllowedRedirectUri(redirectUri),
  };
};
