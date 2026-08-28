import { splitShellCommand } from '$lib/skill-install';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const COLOR = {
  primary: '#d4842a',
  primarySubtle: '#fdf0e2',
  accent: '#d98cb3',
  bg: '#f8f5f0',
  card: '#fdfcfa',
  fg: '#3d3830',
  muted: '#6e6660',
  border: '#c9a87a',
  // Dark terminal bar palette (matches the homepage OG install bar).
  termBg: '#3d3830',
  termText: '#fff4e8',
  termMuted: '#b9b0a2',
  termOrange: '#f9a64d',
} as const;

const FONT_FAMILY = "'Poppins', system-ui, sans-serif";
const MONO_FAMILY = "'JetBrains Mono', 'Courier New', monospace";

export interface OgSvgInput {
  title: string;
  subtitle: string;
  tag: string;
  author: string;
  stars: number;
  installCommand: string;
  showSubtitle: boolean;
  logo: string;
  avatar: string | null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatStars(num: number): string {
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine) : word;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length >= maxCharsPerLine ? `${last.slice(0, maxCharsPerLine - 1)}…` : `${last}…`;
  }
  return lines;
}

function ellipsizeLine(value: string, maxChars: number): string {
  const safeMaxChars = Math.max(2, maxChars);
  if (value.length <= safeMaxChars) return value;
  return `${value.slice(0, safeMaxChars - 1)}…`;
}

interface CommandSegment {
  text: string;
  color: string;
}

function getCommandSegmentColor(token: string): string {
  if (token === 'npx') return COLOR.accent;
  if (token === 'skillscat' || token === 'skills') return COLOR.termText;
  if (token === 'add' || token === '--skill') return COLOR.termOrange;
  if (token.includes('/')) return COLOR.termMuted;
  return COLOR.termText;
}

function lineCharCount(segments: CommandSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.text.length, 0);
}

function trimCommandLineEdges(line: CommandSegment[]): CommandSegment[] {
  const trimmed = line
    .map((segment) => ({ ...segment }))
    .filter((segment) => segment.text.length > 0);

  if (trimmed.length === 0) return [];

  trimmed[0].text = trimmed[0].text.replace(/^\s+/, '');
  trimmed[trimmed.length - 1].text = trimmed[trimmed.length - 1].text.replace(/\s+$/, '');

  return trimmed.filter((segment) => segment.text.length > 0);
}

function appendEllipsis(line: CommandSegment[], maxChars: number): CommandSegment[] {
  const trimmed = trimCommandLineEdges(line);

  while (trimmed.length > 0 && trimmed[trimmed.length - 1].text.trim() === '') {
    trimmed.pop();
  }

  while (lineCharCount(trimmed) >= maxChars && trimmed.length > 0) {
    const idx = trimmed.length - 1;
    const segment = trimmed[idx];
    if (segment.text.length <= 1) {
      trimmed.pop();
      continue;
    }
    segment.text = segment.text.slice(0, -1);
  }

  trimmed.push({ text: '…', color: COLOR.termMuted });
  return trimmed;
}

function wrapCommandSegments(command: string, maxCharsPerLine: number, maxLines: number): CommandSegment[][] {
  const safeMaxChars = Math.max(8, maxCharsPerLine);
  const tokens = splitShellCommand(command);
  const lines: CommandSegment[][] = [];
  let currentLine: CommandSegment[] = [];
  let currentLength = 0;

  const pushLine = (): void => {
    if (currentLine.length === 0) return;
    lines.push(currentLine);
    currentLine = [];
    currentLength = 0;
  };

  for (const token of tokens) {
    const color = getCommandSegmentColor(token);
    let remaining = token;
    let isFirstChunk = true;

    while (remaining.length > 0) {
      const needsLeadingSpace = currentLength > 0 && isFirstChunk;
      let available = safeMaxChars - currentLength - (needsLeadingSpace ? 1 : 0);

      if (available <= 0) {
        pushLine();
        continue;
      }

      if (needsLeadingSpace) {
        currentLine.push({ text: ' ', color: COLOR.termText });
        currentLength += 1;
        available -= 1;
        if (available <= 0) {
          pushLine();
          continue;
        }
      }

      if (remaining.length <= available) {
        currentLine.push({ text: remaining, color });
        currentLength += remaining.length;
        remaining = '';
      } else {
        currentLine.push({ text: remaining.slice(0, available), color });
        currentLength += available;
        remaining = remaining.slice(available);
        pushLine();
        isFirstChunk = false;
      }
    }
  }
  pushLine();
  const normalized = lines.map(trimCommandLineEdges).filter((line) => line.length > 0);

  if (normalized.length <= maxLines) return normalized;
  const truncated = normalized.slice(0, maxLines);
  truncated[maxLines - 1] = appendEllipsis(truncated[maxLines - 1], safeMaxChars);
  return truncated;
}

// Dark terminal-style install bar, visually matching the homepage OG image.
function buildInstallBar(installCommand: string, cardX: number, cardY: number, cardW: number, cardH: number): { svg: string; reservedBottom: number } {
  const maxLines = 4;
  const barX = cardX + 48;
  const bottomPadding = 30;
  const textOffsetX = 84;
  const rightPadding = 20;
  const verticalPadding = 13;
  const lineHeight = 20;
  const fontSize = 15;
  const charWidth = 9.1;
  const maxWidth = cardW - 96;
  // Reserve 2 chars on the first line for the "$ " prompt.
  const maxCharsPerLine = Math.max(16, Math.floor((maxWidth - textOffsetX - rightPadding) / charWidth) - 2);
  const lines = wrapCommandSegments(installCommand, maxCharsPerLine, maxLines);
  if (lines.length > 0) {
    lines[0] = [{ text: '$ ', color: COLOR.accent }, ...lines[0]];
  }
  const lineWidths = lines.map((line) => lineCharCount(line) * charWidth);
  const textWidth = Math.max(...lineWidths, 0);
  const barW = Math.min(maxWidth, Math.max(0, textOffsetX + textWidth + rightPadding));
  const barH = Math.max(46, verticalPadding * 2 + lines.length * lineHeight);
  const barY = cardY + cardH - bottomPadding - barH;
  const textX = barX + textOffsetX;
  const firstBaselineY = barY + verticalPadding + 15;

  const textSvg = lines
    .map((line, lineIndex) => {
      const baselineY = firstBaselineY + lineIndex * lineHeight;
      const segments = line
        .filter((segment) => segment.text.length > 0)
        .map((segment) => `<tspan fill="${segment.color}">${escapeXml(segment.text)}</tspan>`)
        .join('');
      return `<text x="${textX}" y="${baselineY}" font-family="${MONO_FAMILY}" font-size="${fontSize}" font-weight="700">${segments}</text>`;
    })
    .join('');

  const dotCy = barY + barH / 2;
  const dotsSvg = [
    { cx: barX + 26, fill: COLOR.accent },
    { cx: barX + 44, fill: COLOR.termOrange },
    { cx: barX + 62, fill: COLOR.termText },
  ]
    .map((dot) => `<circle cx="${dot.cx}" cy="${dotCy}" r="5" fill="${dot.fill}" />`)
    .join('');

  const svg = `<rect x="${barX + 4}" y="${barY + 4}" width="${barW}" height="${barH}" rx="14" fill="${COLOR.border}" />`
    + `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="14" fill="${COLOR.termBg}" />`
    + dotsSvg
    + textSvg;
  const reservedBottom = bottomPadding + barH + 16;

  return { svg, reservedBottom };
}

function buildDomainPill(cardX: number, cardY: number, cardW: number, cardH: number): string {
  const label = 'skills.cat';
  const pillW = 134;
  const pillH = 40;
  const x = cardX + cardW - 30 - pillW;
  const y = cardY + cardH - 30 - pillH;
  return `<rect x="${x + 3}" y="${y + 3}" width="${pillW}" height="${pillH}" rx="20" fill="${COLOR.border}" />`
    + `<rect x="${x}" y="${y}" width="${pillW}" height="${pillH}" rx="20" fill="${COLOR.primary}" />`
    + `<text x="${x + pillW / 2}" y="${y + 26}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="17" font-weight="700" fill="${COLOR.termText}">${label}</text>`;
}

export function buildOgSvg(input: OgSvgInput): string {
  const { title, subtitle, tag, author, stars, installCommand, showSubtitle, logo, avatar } = input;
  let subtitleLines = showSubtitle ? wrapLines(subtitle, 46, 2) : [];

  const cardX = 48;
  const cardY = 40;
  const cardW = 1104;
  const cardH = 550;
  const shadowOffset = 4;
  const contentX = cardX + 48;

  // Brand row (logo + wordmark), top-left.
  const brandLogoSize = 40;
  const brandLogoY = cardY + 38;

  // Tag pill + stars badge on their own row below the brand row, right-aligned.
  let tagSvg = '';
  const pillY = cardY + 86;
  const pillHeight = 34;
  const pillGap = 10;
  let pillRight = cardX + cardW - 30;

  if (stars > 0) {
    // Poppins' latin subset has no U+2605, so draw the star as a path.
    const starsText = formatStars(stars);
    const starsWidth = starsText.length * 9 + 48;
    const sx = pillRight - starsWidth;
    const starPath = 'M0 -7.5 L1.88 -2.59 L7.13 -2.32 L3.04 0.99 L4.41 6.07 L0 3.2 L-4.41 6.07 L-3.04 0.99 L-7.13 -2.32 L-1.88 -2.59 Z';
    tagSvg += `<rect x="${sx}" y="${pillY}" width="${starsWidth}" height="${pillHeight}" rx="17" fill="${COLOR.bg}" />`
      + `<path d="${starPath}" transform="translate(${sx + 20} ${pillY + pillHeight / 2})" fill="${COLOR.primary}" />`
      + `<text x="${sx + 34}" y="${pillY + 23}" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="${COLOR.muted}">${escapeXml(starsText)}</text>`;
    pillRight = sx - pillGap;
  }
  if (tag) {
    const maxTagChars = 18;
    const displayTag = tag.length > maxTagChars ? tag.slice(0, maxTagChars - 1) + '…' : tag;
    const tagWidth = displayTag.length * 10 + 32;
    const tx = pillRight - tagWidth;
    tagSvg += `<rect x="${tx}" y="${pillY}" width="${tagWidth}" height="${pillHeight}" rx="17" fill="${COLOR.primarySubtle}" />`
      + `<text x="${tx + tagWidth / 2}" y="${pillY + 23}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="${COLOR.primary}">${escapeXml(displayTag)}</text>`;
  }

  // Title block.
  const avatarSize = 84;
  const avatarTop = cardY + 170;
  const hasAvatar = !!avatar;
  const textStartX = hasAvatar ? contentX + avatarSize + 20 : contentX;
  const titleY = avatarTop + 50;
  const authorY = titleY + 44;
  const subtitleStartY = author ? authorY + 46 : titleY + 56;

  // Title spans the full card width now that pills live above it.
  const titleMaxWidth = cardX + cardW - 48 - textStartX;
  const titleMaxChars = Math.max(10, Math.floor(titleMaxWidth / 31));
  const titleText = ellipsizeLine(title, titleMaxChars);

  // Avatar + clip
  let avatarClipDef = '';
  let avatarImageSvg = '';
  if (hasAvatar) {
    const avatarCx = contentX + avatarSize / 2;
    const avatarCy = author ? titleY - 4 : titleY;
    avatarClipDef = `<clipPath id="avatarClip"><circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarSize / 2}" /></clipPath>`;
    avatarImageSvg = `<image clip-path="url(#avatarClip)" href="${avatar}" x="${contentX}" y="${avatarCy - avatarSize / 2}" width="${avatarSize}" height="${avatarSize}" />`
      + `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarSize / 2}" fill="none" stroke="${COLOR.border}" stroke-width="2.5" />`;
  }

  const titleSvg = `<text x="${textStartX}" y="${titleY}" font-family="${FONT_FAMILY}" font-size="56" font-weight="800" fill="${COLOR.fg}">${escapeXml(titleText)}</text>`;

  const authorSvg = author
    ? `<text x="${textStartX}" y="${authorY}" font-family="${FONT_FAMILY}" font-size="23" font-weight="700" fill="${COLOR.muted}">by ${escapeXml(author)}</text>`
    : '';

  // Install bar (skills) or domain pill (everything else), bottom-anchored.
  const hasInstall = !!installCommand;
  const installLayout = hasInstall ? buildInstallBar(installCommand, cardX, cardY, cardW, cardH) : null;
  const reservedBottom = installLayout?.reservedBottom ?? 30;
  const bottomSvg = installLayout?.svg ?? buildDomainPill(cardX, cardY, cardW, cardH);

  // Subtitle with overflow protection.
  const subtitleLineHeight = 32;
  const cardBottom = cardY + cardH - reservedBottom;
  while (subtitleLines.length > 0 && subtitleStartY + (subtitleLines.length - 1) * subtitleLineHeight > cardBottom) {
    subtitleLines.pop();
  }
  const subtitleSvg = subtitleLines
    .map((line, i) => `<text x="${textStartX}" y="${subtitleStartY + i * subtitleLineHeight}" font-family="${FONT_FAMILY}" font-size="20" font-weight="700" fill="${COLOR.muted}" opacity="0.75">${escapeXml(line)}</text>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <clipPath id="cardClip">
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" />
    </clipPath>
    ${avatarClipDef}
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${COLOR.bg}" />
  <rect x="${cardX + shadowOffset}" y="${cardY + shadowOffset}" width="${cardW}" height="${cardH}" rx="24" fill="${COLOR.border}" />
  <g clip-path="url(#cardClip)">
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" fill="${COLOR.card}" stroke="${COLOR.border}" stroke-width="3" />
    <circle cx="${cardX + cardW}" cy="${cardY}" r="78" fill="${COLOR.primary}" />
    <circle cx="${cardX}" cy="${cardY + cardH}" r="58" fill="${COLOR.accent}" />
    <image href="${logo}" x="${cardX + cardW - 340}" y="${cardY + cardH - 310}" width="360" height="360" opacity="0.07" />
    <image href="${logo}" x="${contentX}" y="${brandLogoY}" width="${brandLogoSize}" height="${brandLogoSize}" />
    <text x="${contentX + brandLogoSize + 12}" y="${brandLogoY + 29}" font-family="${FONT_FAMILY}" font-size="15" font-weight="800" letter-spacing="3" fill="${COLOR.primary}">SKILLSCAT</text>
    ${tagSvg}
    ${titleSvg}
    ${authorSvg}
    ${subtitleSvg}
    ${bottomSvg}
    ${avatarImageSvg}
  </g>
</svg>`;
}
