const SUSPICIOUS_UTF8_MOJIBAKE_PATTERN = /[ÃÂð]|[\u0080-\u009f]/;

function latin1StringToBytes(value: string): Uint8Array | null {
  const bytes = new Uint8Array(value.length);

  for (let i = 0; i < value.length; i++) {
    const codePoint = value.charCodeAt(i);
    if (codePoint > 0xff) {
      return null;
    }
    bytes[i] = codePoint;
  }

  return bytes;
}

export function decodeBase64Utf8(base64: string): string {
  const cleanBase64 = base64.replace(/\n/g, '');
  const binaryString = atob(cleanBase64);
  const bytes = latin1StringToBytes(binaryString);

  if (!bytes) {
    throw new Error('Failed to convert base64 payload to bytes');
  }

  return new TextDecoder('utf-8').decode(bytes);
}

export function repairUtf8Mojibake(value: string): string | null {
  if (!value || !SUSPICIOUS_UTF8_MOJIBAKE_PATTERN.test(value)) {
    return null;
  }

  const bytes = latin1StringToBytes(value);
  if (!bytes) {
    return null;
  }

  try {
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return repaired !== value ? repaired : null;
  } catch {
    return null;
  }
}

export function looksLikeUtf8Mojibake(value: string): boolean {
  return repairUtf8Mojibake(value) !== null;
}

export function looksLikeGarbledUnicode(value: string): boolean {
  return value.includes('�') || looksLikeUtf8Mojibake(value);
}
