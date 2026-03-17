function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const YAML_QUOTE_PREFIXES = ['"', "'", '`', '“', '‘', '「', '『', '《', '〈'];

const OUTER_TITLE_WRAPPERS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
  ['〈', '〉'],
  ['【', '】'],
  ['[', ']'],
  ['{', '}'],
];

const INLINE_QUOTE_WRAPPERS: Array<[string, string]> = [
  ['"', '"'],
  ['`', '`'],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
  ['〈', '〉'],
];

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripOuterTitleWrappers(value: string): string {
  let title = value.trim();
  let changed = true;

  while (changed && title.length > 1) {
    changed = false;

    for (const [open, close] of OUTER_TITLE_WRAPPERS) {
      if (title.startsWith(open) && title.endsWith(close)) {
        const inner = title.slice(open.length, title.length - close.length).trim();
        if (inner) {
          title = inner;
          changed = true;
          break;
        }
      }
    }
  }

  return title;
}

function stripInlineQuoteWrappers(value: string): string {
  let title = value;

  for (const [open, close] of INLINE_QUOTE_WRAPPERS) {
    const pattern = new RegExp(`${escapeRegExp(open)}\\s*([^\\n${escapeRegExp(open)}${escapeRegExp(close)}]+?)\\s*${escapeRegExp(close)}`, 'gu');
    title = title.replace(pattern, (_, inner: string) => inner.trim());
  }

  return title;
}

export function normalizeExtractedSkillTitle(rawTitle: string): string {
  let title = collapseWhitespace(rawTitle);
  title = stripOuterTitleWrappers(title);
  title = stripInlineQuoteWrappers(title);
  return collapseWhitespace(title);
}

export function stripYamlInlineComment(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (YAML_QUOTE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return trimmed;
  }

  return trimmed.replace(/\s+#.*$/, '').trim();
}
