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
const SCRIPT_STYLE_TAG_REGEX = /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi;

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();

    if (normalized in HTML_ENTITY_MAP) {
      return HTML_ENTITY_MAP[normalized];
    }

    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
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

export function cleanSkillCardDescription(value: string | null | undefined): string | null {
  if (!value) return null;

  let text = value.replace(/\r\n?/g, '\n');

  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(SCRIPT_STYLE_TAG_REGEX, ' ')
    .replace(BLOCK_CODE_TAG_REGEX, ' ')
    .replace(INLINE_CODE_TAG_REGEX, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_HTML_CLOSE_REGEX, '\n')
    .replace(BLOCK_HTML_OPEN_REGEX, ' ')
    .replace(LIST_ITEM_OPEN_REGEX, '\n')
    .replace(TABLE_CELL_REGEX, ' ')
    .replace(HTML_TAG_REGEX, ' ');

  text = decodeHtmlEntities(text).replace(HTML_TAG_REGEX, ' ');

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
