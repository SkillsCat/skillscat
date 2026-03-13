const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const BLOCKED_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'frameset', 'frame',
  'portal', 'template',
]);

const BLOCKED_STANDALONE_TAGS = new Set([
  'base', 'link', 'meta',
]);

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption',
  'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'i', 'img', 'input', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby',
  's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',
]);

const GLOBAL_ALLOWED_ATTRS = new Set([
  'align', 'class', 'dir', 'id', 'lang', 'role', 'tabindex', 'title',
]);

const BOOLEAN_ATTRS = new Set([
  'checked', 'disabled', 'download', 'open', 'reversed',
]);

const TAG_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['download', 'href', 'name', 'rel', 'target']),
  blockquote: new Set(['cite']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span', 'width']),
  del: new Set(['cite', 'datetime']),
  details: new Set(['open']),
  img: new Set(['alt', 'decoding', 'height', 'loading', 'src', 'width']),
  input: new Set(['checked', 'disabled', 'type']),
  ins: new Set(['cite', 'datetime']),
  li: new Set(['value']),
  ol: new Set(['reversed', 'start']),
  q: new Set(['cite']),
  td: new Set(['colspan', 'headers', 'rowspan', 'scope', 'valign', 'width']),
  th: new Set(['abbr', 'colspan', 'headers', 'rowspan', 'scope', 'valign', 'width']),
  time: new Set(['datetime']),
};

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: '\'',
  colon: ':',
  gt: '>',
  lt: '<',
  newline: '\n',
  quot: '"',
  tab: '\t',
};

interface ParsedAttribute {
  name: string;
  value: string | null;
}

interface ParsedTag {
  attrs: ParsedAttribute[];
  end: number;
  name: string;
  selfClosing: boolean;
  type: 'open' | 'close';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function normalizeRelativeFilePath(path: string): string {
  return path.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
}

export function isRelativeMarkdownLink(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith('#')) return false;
  if (value.startsWith('//')) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^mailto:/i.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);?/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function normalizeUrlForValidation(value: string): string {
  return decodeHtmlEntities(value).trim().replace(/[\u0000-\u0020\u007f]+/g, '');
}

export function sanitizeMarkdownHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;

  const normalized = normalizeUrlForValidation(href);
  if (!normalized) return null;

  if (/^(javascript|data|vbscript|file):/i.test(normalized)) return null;
  if (normalized.startsWith('//')) return null;

  if (normalized.startsWith('#')) return href;
  if (/^mailto:/i.test(normalized) || /^tel:/i.test(normalized)) return href;
  if (/^https?:\/\//i.test(normalized)) return href;
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return href;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return href;

  return null;
}

export function sanitizeImageSrc(rawSrc: string): string | null {
  const src = rawSrc.trim();
  if (!src) return null;

  const normalized = normalizeUrlForValidation(src);
  if (!normalized) return null;

  if (/^(javascript|data|vbscript|file):/i.test(normalized)) return null;
  if (normalized.startsWith('//')) return null;
  if (/^https?:\/\//i.test(normalized)) return src;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return src;

  return null;
}

function isExternalHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|tel:)/i.test(normalizeUrlForValidation(href));
}

function sanitizeTarget(rawTarget: string | null): string | null {
  if (!rawTarget) return null;

  const target = rawTarget.trim().toLowerCase();
  if (target === '_blank' || target === '_self' || target === '_parent' || target === '_top') {
    return target;
  }

  return null;
}

function sanitizeIntegerAttr(rawValue: string | null, { min = 0, max = 10000, allowPercent = false } = {}): string | null {
  if (!rawValue) return null;

  const value = rawValue.trim();
  if (!value) return null;

  if (allowPercent && /^\d{1,4}%$/.test(value)) {
    return value;
  }

  if (!/^\d+$/.test(value)) return null;

  const numeric = Number.parseInt(value, 10);
  if (numeric < min || numeric > max) return null;

  return String(numeric);
}

function sanitizeEnumAttr(rawValue: string | null, allowed: readonly string[]): string | null {
  if (!rawValue) return null;

  const value = rawValue.trim().toLowerCase();
  return allowed.includes(value) ? value : null;
}

function isAllowedAttrName(tagName: string, attrName: string): boolean {
  if (GLOBAL_ALLOWED_ATTRS.has(attrName)) return true;
  if (attrName.startsWith('aria-')) return true;
  if (attrName.startsWith('data-')) return true;
  return TAG_ALLOWED_ATTRS[tagName]?.has(attrName) ?? false;
}

function sanitizeAttributeValue(tagName: string, attrName: string, rawValue: string | null): string | null {
  if (BOOLEAN_ATTRS.has(attrName)) {
    return '';
  }

  if (rawValue == null) {
    return null;
  }

  if (attrName === 'href') {
    return tagName === 'a' ? sanitizeMarkdownHref(rawValue) : null;
  }

  if (attrName === 'src') {
    return tagName === 'img' ? sanitizeImageSrc(rawValue) : null;
  }

  if (attrName === 'cite') {
    return sanitizeMarkdownHref(rawValue);
  }

  if (attrName === 'target') {
    return sanitizeTarget(rawValue);
  }

  if (attrName === 'loading') {
    return sanitizeEnumAttr(rawValue, ['eager', 'lazy']);
  }

  if (attrName === 'type') {
    return tagName === 'input' ? sanitizeEnumAttr(rawValue, ['checkbox']) : null;
  }

  if (attrName === 'decoding') {
    return sanitizeEnumAttr(rawValue, ['async', 'auto', 'sync']);
  }

  if (attrName === 'dir') {
    return sanitizeEnumAttr(rawValue, ['auto', 'ltr', 'rtl']);
  }

  if (attrName === 'scope') {
    return sanitizeEnumAttr(rawValue, ['col', 'colgroup', 'row', 'rowgroup']);
  }

  if (attrName === 'align') {
    return sanitizeEnumAttr(rawValue, ['center', 'justify', 'left', 'right']);
  }

  if (attrName === 'valign') {
    return sanitizeEnumAttr(rawValue, ['baseline', 'bottom', 'middle', 'top']);
  }

  if (attrName === 'height' || attrName === 'width') {
    return sanitizeIntegerAttr(rawValue, { max: 10000, allowPercent: true });
  }

  if (attrName === 'colspan' || attrName === 'rowspan' || attrName === 'span') {
    return sanitizeIntegerAttr(rawValue, { min: 1, max: 1000 });
  }

  if (attrName === 'start' || attrName === 'value') {
    return sanitizeIntegerAttr(rawValue, { max: 1000000 });
  }

  if (attrName === 'tabindex') {
    if (!/^-?\d+$/.test(rawValue.trim())) return null;
    return String(Number.parseInt(rawValue, 10));
  }

  const value = rawValue.trim();
  return value ? value : null;
}

function sanitizeTagAttributes(tagName: string, attrs: ParsedAttribute[]): string | null {
  const serialized: string[] = [];
  let href: string | null = null;
  let target: string | null = null;
  let rel: string | null = null;
  let src: string | null = null;

  for (const attr of attrs) {
    const attrName = attr.name.toLowerCase();

    if (!attrName) continue;
    if (attrName.startsWith('on')) continue;
    if (attrName === 'style' || attrName === 'srcdoc') continue;
    if (attrName.includes(':')) continue;
    if (!isAllowedAttrName(tagName, attrName)) continue;

    const sanitizedValue = sanitizeAttributeValue(tagName, attrName, attr.value);
    if (sanitizedValue == null) continue;

    if (attrName === 'href') {
      href = sanitizedValue;
      continue;
    }

    if (attrName === 'src') {
      src = sanitizedValue;
      continue;
    }

    if (attrName === 'target') {
      target = sanitizedValue;
      continue;
    }

    if (attrName === 'rel') {
      rel = sanitizedValue;
      continue;
    }

    if (BOOLEAN_ATTRS.has(attrName)) {
      serialized.push(attrName);
      continue;
    }

    serialized.push(`${attrName}="${escapeAttr(sanitizedValue)}"`);
  }

  if (tagName === 'img') {
    if (!src) return null;
    serialized.unshift(`src="${escapeAttr(src)}"`);
    return serialized.join(' ');
  }

  if (tagName === 'a') {
    if (href) {
      serialized.unshift(`href="${escapeAttr(href)}"`);
    }

    if (target) {
      serialized.push(`target="${escapeAttr(target)}"`);
    }

    const needsSafeRel = Boolean(target === '_blank' || (href && isExternalHref(href)));
    if (needsSafeRel) {
      serialized.push('rel="noopener noreferrer nofollow"');
    } else if (rel) {
      serialized.push(`rel="${escapeAttr(rel)}"`);
    }

    return serialized.join(' ');
  }

  return serialized.join(' ');
}

function parseHtmlTag(input: string, start: number): ParsedTag | null {
  const length = input.length;
  let index = start + 1;
  let type: 'open' | 'close' = 'open';

  if (index >= length) return null;

  if (input[index] === '/') {
    type = 'close';
    index += 1;
  }

  const nameStart = index;
  while (index < length && /[A-Za-z0-9:-]/.test(input[index] || '')) {
    index += 1;
  }

  if (index === nameStart) return null;

  const name = input.slice(nameStart, index).toLowerCase();
  const attrs: ParsedAttribute[] = [];
  let selfClosing = false;

  while (index < length) {
    while (index < length && /\s/.test(input[index] || '')) {
      index += 1;
    }

    const current = input[index];
    if (!current) return null;

    if (current === '>') {
      return { attrs, end: index + 1, name, selfClosing, type };
    }

    if (current === '/' && input[index + 1] === '>') {
      selfClosing = true;
      return { attrs, end: index + 2, name, selfClosing, type };
    }

    if (type === 'close') {
      return null;
    }

    const attrStart = index;
    while (index < length && /[^\s=/>\u0000]/.test(input[index] || '')) {
      index += 1;
    }

    const attrName = input.slice(attrStart, index).toLowerCase();
    if (!attrName) return null;

    while (index < length && /\s/.test(input[index] || '')) {
      index += 1;
    }

    let attrValue: string | null = null;
    if (input[index] === '=') {
      index += 1;
      while (index < length && /\s/.test(input[index] || '')) {
        index += 1;
      }

      const quote = input[index];
      if (quote === '"' || quote === '\'') {
        index += 1;
        const valueStart = index;
        while (index < length && input[index] !== quote) {
          index += 1;
        }
        if (index >= length) return null;
        attrValue = input.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < length && /[^\s>]/.test(input[index] || '')) {
          index += 1;
        }
        attrValue = input.slice(valueStart, index);
      }
    }

    attrs.push({ name: attrName, value: attrValue });
  }

  return null;
}

function sanitizeTag(tag: ParsedTag): string {
  const { name, selfClosing, type } = tag;

  if (BLOCKED_STANDALONE_TAGS.has(name)) return '';
  if (!ALLOWED_TAGS.has(name)) return '';

  if (type === 'close') {
    return VOID_TAGS.has(name) ? '' : `</${name}>`;
  }

  const attrs = sanitizeTagAttributes(name, tag.attrs);
  if (attrs == null) return '';

  const suffix = selfClosing && VOID_TAGS.has(name) ? ' /' : '';
  return attrs ? `<${name} ${attrs}${suffix}>` : `<${name}${suffix}>`;
}

export function sanitizeRenderedHtml(html: string): string {
  if (!html) return '';

  let output = '';
  let index = 0;
  const blockedStack: string[] = [];

  while (index < html.length) {
    const insideBlockedTag = blockedStack.length > 0;

    if (html.startsWith('<!--', index)) {
      const commentEnd = html.indexOf('-->', index + 4);
      const end = commentEnd === -1 ? html.length : commentEnd + 3;
      if (insideBlockedTag) {
        output += escapeHtml(html.slice(index, end));
      }
      index = end;
      continue;
    }

    const current = html[index];
    if (current !== '<') {
      const nextTagIndex = html.indexOf('<', index);
      const end = nextTagIndex === -1 ? html.length : nextTagIndex;
      const fragment = html.slice(index, end);
      output += insideBlockedTag ? escapeHtml(fragment) : fragment;
      index = end;
      continue;
    }

    if (html.startsWith('<!', index) || html.startsWith('<?', index)) {
      const declarationEnd = html.indexOf('>', index + 2);
      const end = declarationEnd === -1 ? html.length : declarationEnd + 1;
      if (insideBlockedTag) {
        output += escapeHtml(html.slice(index, end));
      }
      index = end;
      continue;
    }

    const tag = parseHtmlTag(html, index);
    if (!tag) {
      output += '&lt;';
      index += 1;
      continue;
    }

    const rawTag = html.slice(index, tag.end);
    index = tag.end;

    if (insideBlockedTag) {
      output += escapeHtml(rawTag);
      if (tag.type === 'open' && BLOCKED_CONTENT_TAGS.has(tag.name) && !tag.selfClosing) {
        blockedStack.push(tag.name);
      } else if (tag.type === 'close' && tag.name === blockedStack[blockedStack.length - 1]) {
        blockedStack.pop();
      }
      continue;
    }

    if (BLOCKED_CONTENT_TAGS.has(tag.name)) {
      output += escapeHtml(rawTag);
      if (tag.type === 'open' && !tag.selfClosing) {
        blockedStack.push(tag.name);
      }
      continue;
    }

    output += sanitizeTag(tag);
  }

  return output;
}
