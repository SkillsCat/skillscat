export function getCanonicalHostRedirectLocation(
  requestUrl: URL,
  publicAppUrl: string | undefined
): string | null {
  const configured = publicAppUrl?.trim();
  if (!configured) return null;

  try {
    const canonical = new URL(configured);
    const expectedWwwHost = `www.${canonical.hostname}`.toLowerCase();
    if (requestUrl.hostname.toLowerCase() !== expectedWwwHost) {
      return null;
    }

    return `${canonical.origin}${requestUrl.pathname}${requestUrl.search}`;
  } catch {
    return null;
  }
}
