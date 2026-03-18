const MAX_UNICODE_CODE_POINT = 0x10ffff;

export interface PrefixRange {
  start: string;
  end: string | null;
}

export function getPrefixRangeEnd(prefix: string): string | null {
  if (!prefix) return null;

  const codePoints = Array.from(prefix, (char) => char.codePointAt(0) ?? 0);
  for (let index = codePoints.length - 1; index >= 0; index -= 1) {
    const codePoint = codePoints[index];
    if (codePoint >= MAX_UNICODE_CODE_POINT) continue;

    const next = [...codePoints.slice(0, index), codePoint + 1];
    return String.fromCodePoint(...next);
  }

  return null;
}

export function buildPrefixRange(prefix: string): PrefixRange {
  return {
    start: prefix,
    end: getPrefixRangeEnd(prefix),
  };
}
