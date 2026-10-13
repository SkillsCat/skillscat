import pc from 'picocolors';
import stringWidth from 'fast-string-width';
import * as readline from 'node:readline';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export class PromptCancelledError extends Error {
  constructor() { super('Cancelled.'); this.name = 'PromptCancelledError'; }
}

export function terminalText(value: string): string {
  return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

function terminalWidth(): number {
  return process.stdout.isTTY && process.stdout.columns ? Math.max(1, process.stdout.columns) : 100;
}

function fit(value: string, width: number): string {
  if (stringWidth(value) <= width) return value;
  let result = '';
  for (const { segment } of graphemes.segment(value)) {
    if (stringWidth(result + segment) > width - 1) break;
    result += segment;
  }
  return width > 0 ? result + '…' : '';
}

export function heading(title: string): void {
  console.log();
  console.log(pc.bold(terminalText(title)));
}

export function hint(message: string, command?: string): void {
  console.log(pc.dim(terminalText(message)));
  if (command) console.log(`  ${pc.cyan(terminalText(command))}`);
}

export function cancelled(message = 'Cancelled.'): void {
  info(message);
}

export function dataTable(title: string, headers: string[], rows: string[][]): void {
  heading(title);
  table(headers, rows, { preserveColumns: headers.flatMap((header, i) =>
    ['Skill', 'Slug', 'Path', 'Source', 'Destination'].includes(header) ? [i] : []) });
}

export function details(title: string, fields: Array<[string, string]>): void {
  console.log();
  box(fields.map(([label, value]) => `${terminalText(label)}: ${terminalText(value)}`).join('\n'), title);
}

export function success(message: string): void {
  console.log(pc.green('✔') + ' ' + terminalText(message));
}

export function error(message: string): void {
  console.error(pc.red('✖') + ' ' + terminalText(message));
}

export function warn(message: string): void {
  console.warn(pc.yellow('⚠') + ' ' + terminalText(message));
}

export function info(message: string): void {
  console.log(pc.blue('ℹ') + ' ' + terminalText(message));
}

export function spinner(message: string): { stop: (success?: boolean | 'cancelled') => void } {
  message = terminalText(message);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  const animated = process.stdout.isTTY === true;
  const frameLabel = fit(message, Math.max(1, terminalWidth() - 2));
  let stopped = false;
  if (animated) process.stdout.write(pc.cyan(frames[0]) + ' ' + frameLabel);
  else info(message);
  const interval = animated ? setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write('\r' + pc.cyan(frames[i]) + ' ' + frameLabel);
  }, 80) : undefined;

  return {
    stop: (succeeded: boolean | 'cancelled' = true) => {
      if (stopped) return;
      stopped = true;
      if (interval) clearInterval(interval);
      if (animated) process.stdout.write('\r\x1b[2K');
      if (succeeded === 'cancelled') return;
      if (succeeded) success(message);
      else error(message);
    },
  };
}

export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.once('SIGINT', () => { reject(new PromptCancelledError()); rl.close(); });
    rl.once('close', () => reject(new Error('Input closed before confirmation. Use --yes for non-interactive commands that support it.')));
    rl.question(`${pc.cyan('?')} ${question}`, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
}

export function table(headers: string[], rows: string[][], options: { width?: number; preserveColumns?: number[] } = {}): void {
  headers = headers.map(terminalText);
  rows = rows.map((row) => row.map(terminalText));
  const maxWidth = options.width ?? terminalWidth();
  const widths = headers.map((h, i) =>
    rows.reduce((width, row) => Math.max(width, stringWidth(row[i] || '')), stringWidth(h))
  );
  const minimums = headers.map((header, i) => options.preserveColumns?.includes(i) ? widths[i] : Math.max(1, Math.min(12, stringWidth(header))));
  const available = maxWidth - (3 * headers.length + 1);
  if (available < minimums.reduce((total, width) => total + width, 0)) {
    for (const row of rows) {
      console.log();
      headers.forEach((header, i) => console.log(`${pc.dim(header + ':')} ${row[i] || ''}`));
    }
    return;
  }
  widths.forEach((width, i) => { widths[i] = Math.max(minimums[i], Math.min(width, maxWidth)); });
  while (widths.reduce((total, width) => total + width, 0) > available) {
    const index = widths.reduce((best, width, i) => width > minimums[i] && (best < 0 || width > widths[best]) ? i : best, -1);
    if (index < 0) break;
    widths[index]--;
  }
  const pad = (value: string, width: number) => value + ' '.repeat(Math.max(0, width - stringWidth(value)));

  const separator = widths.map(w => '─'.repeat(w + 2)).join('┼');

  console.log(pc.dim('┌' + separator.replace(/┼/g, '┬') + '┐'));

  // Header
  const headerRow = headers.map((h, i) => ` ${pc.bold(pad(fit(h, widths[i]), widths[i]))} `).join(pc.dim('│'));
  console.log(pc.dim('│') + headerRow + pc.dim('│'));

  console.log(pc.dim('├' + separator + '┤'));

  // Rows
  for (const row of rows) {
    const rowStr = headers.map((_, i) => ` ${pad(fit(row[i] || '', widths[i]), widths[i])} `).join(pc.dim('│'));
    console.log(pc.dim('│') + rowStr + pc.dim('│'));
  }

  console.log(pc.dim('└' + separator.replace(/┼/g, '┴') + '┘'));
}

export function box(content: string, title?: string, options: { width?: number } = {}): void {
  const inputLines = content.split('\n').map(terminalText);
  title = title ? terminalText(title) : undefined;
  const width = Math.max(8, Math.min(options.width ?? terminalWidth(), Math.max(...inputLines.map((line) => stringWidth(line)), stringWidth(title || '')) + 4));
  const innerWidth = width - 4;
  const lines: string[] = [];
  for (const line of inputLines) {
    let current = '';
    for (const { segment } of graphemes.segment(line)) {
      if (stringWidth(current + segment) > innerWidth && current) { lines.push(current); current = ''; }
      current += segment;
    }
    lines.push(current);
  }
  const pad = (value: string) => value + ' '.repeat(Math.max(0, width - 3 - stringWidth(value)));

  const top = '╭' + '─'.repeat(width - 2) + '╮';
  const bottom = '╰' + '─'.repeat(width - 2) + '╯';

  console.log(pc.dim(top));
  if (title) {
    console.log(pc.dim('│') + ' ' + pc.bold(pad(fit(title, innerWidth))) + pc.dim('│'));
    console.log(pc.dim('│') + '─'.repeat(width - 2) + pc.dim('│'));
  }
  for (const line of lines) {
    console.log(pc.dim('│') + ' ' + pad(line) + pc.dim('│'));
  }
  console.log(pc.dim(bottom));
}
