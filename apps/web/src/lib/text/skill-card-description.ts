const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const HTML_TAGS =
  '(?:a|abbr|article|b|blockquote|br|code|del|details|div|em|figcaption|figure|h[1-6]|hr|i|img|kbd|li|mark|ol|p|pre|s|section|small|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul)';

const HTML_TAG_REGEX = new RegExp(`<\\/?${HTML_TAGS}\\b[^>]*>`, 'gi');
const BLOCK_HTML_CLOSE_REGEX = new RegExp(`</(?:article|blockquote|details|div|figcaption|figure|h[1-6]|li|ol|p|section|summary|table|tbody|thead|tr|ul)>`, 'gi');
const BLOCK_HTML_OPEN_REGEX = new RegExp(`<(?:article|blockquote|details|div|figcaption|figure|h[1-6]|ol|p|section|summary|table|tbody|thead|tr|ul)\\b[^>]*>`, 'gi');
const LIST_ITEM_OPEN_REGEX = /<li\b[^>]*>/gi;
const TABLE_CELL_REGEX = /<\/?(?:td|th)\b[^>]*>/gi;
const INLINE_CODE_TAG_REGEX = /<code\b[^>]*>([\s\S]*?)<\/code>/gi;
const BLOCK_CODE_TAG_REGEX = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi;

function decodeNumericEntity(match: string, rawValue: string, radix: number): string {
  const codePoint = Number.parseInt(rawValue, radix);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return match;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return match;
  }
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();

    if (normalized in HTML_ENTITY_MAP) {
      return HTML_ENTITY_MAP[normalized];
    }

    if (normalized.startsWith('#x')) {
      return decodeNumericEntity(match, normalized.slice(2), 16);
    }

    if (normalized.startsWith('#')) {
      return decodeNumericEntity(match, normalized.slice(1), 10);
    }

    return match;
  });
}

function findClosingMarker(value: string, start: number, open: string, close: string): number {
  let depth = 0;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\') {
      index += 1;
      continue;
    }

    if (char === open) {
      depth += 1;
      continue;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function stripMarkdownLinks(value: string): string {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const isImage = value[index] === '!' && value[index + 1] === '[';
    const labelStart = isImage ? index + 1 : index;

    if (value[labelStart] !== '[') {
      result += value[index];
      continue;
    }

    const labelEnd = findClosingMarker(value, labelStart, '[', ']');
    if (labelEnd === -1) {
      result += value[index];
      continue;
    }

    const markerStart = labelEnd + 1;
    const marker = value[markerStart];
    if (marker !== '(' && marker !== '[') {
      result += value[index];
      continue;
    }

    const markerEnd = findClosingMarker(value, markerStart, marker, marker === '(' ? ')' : ']');
    if (markerEnd === -1) {
      result += value[index];
      continue;
    }

    result += value.slice(labelStart + 1, labelEnd);
    index = markerEnd;
  }

  return result;
}

function stripInlineMarkdown(value: string): string {
  return stripMarkdownLinks(value)
    .replace(/(?<!\w)\*\*\*([^*\n]+)\*\*\*(?!\w)/g, '$1')
    .replace(/(?<!\w)___([^_\n]+)___(?!\w)/g, '$1')
    .replace(/(?<!\w)\*\*([^*\n]+)\*\*(?!\w)/g, '$1')
    .replace(/(?<!\w)__([^_\n]+)__(?!\w)/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>|~])/g, '$1');
}

function stripHtmlPresentation(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK_CODE_TAG_REGEX, ' ')
    .replace(INLINE_CODE_TAG_REGEX, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_HTML_CLOSE_REGEX, '\n')
    .replace(BLOCK_HTML_OPEN_REGEX, ' ')
    .replace(LIST_ITEM_OPEN_REGEX, '\n')
    .replace(TABLE_CELL_REGEX, ' ')
    .replace(HTML_TAG_REGEX, '');
}

export function cleanSkillCardDescription(value: string | null | undefined): string | null {
  if (!value) return null;

  let text = value.replace(/\r\n?/g, '\n');

  text = stripHtmlPresentation(text);
  text = stripHtmlPresentation(decodeHtmlEntities(text));

  text = text
    .replace(/^\s*\[[^\]]+\]:\s+\S.*$/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]\s+\[[ xX]\]\s+|\d+\.\s+|[-*+]\s+)/gm, '')
    .replace(/^\s*[-=]{3,}\s*$/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, row: string) => `${row.replace(/\s*\|\s*/g, ' ')}\n`)
    .replace(/\|/g, ' ');

  text = stripInlineMarkdown(text);

  const normalized = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || null;
}

export function matchesSkillCardDescription(
  description: string | null | undefined,
  query: string
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return false;

  return cleanSkillCardDescription(description)?.toLowerCase().includes(normalizedQuery) ?? false;
}
