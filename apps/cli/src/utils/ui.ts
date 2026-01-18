import pc from 'picocolors';
import * as readline from 'readline';

export function success(message: string): void {
  console.log(pc.green('✔') + ' ' + message);
}

export function error(message: string): void {
  console.error(pc.red('✖') + ' ' + message);
}

export function warn(message: string): void {
  console.warn(pc.yellow('⚠') + ' ' + message);
}

export function info(message: string): void {
  console.log(pc.blue('ℹ') + ' ' + message);
}

export function spinner(message: string): { stop: (success?: boolean) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  process.stdout.write(pc.cyan(frames[0]) + ' ' + message);

  const interval = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write('\r' + pc.cyan(frames[i]) + ' ' + message);
  }, 80);

  return {
    stop: (succeeded = true) => {
      clearInterval(interval);
      process.stdout.write('\r');
      if (succeeded) {
        console.log(pc.green('✔') + ' ' + message);
      } else {
        console.log(pc.red('✖') + ' ' + message);
      }
    },
  };
}

export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || '').length))
  );

  const separator = widths.map(w => '─'.repeat(w + 2)).join('┼');

  console.log(pc.dim('┌' + separator.replace(/┼/g, '┬') + '┐'));

  // Header
  const headerRow = headers.map((h, i) => ` ${pc.bold(h.padEnd(widths[i]))} `).join(pc.dim('│'));
  console.log(pc.dim('│') + headerRow + pc.dim('│'));

  console.log(pc.dim('├' + separator + '┤'));

  // Rows
  for (const row of rows) {
    const rowStr = row.map((cell, i) => ` ${(cell || '').padEnd(widths[i])} `).join(pc.dim('│'));
    console.log(pc.dim('│') + rowStr + pc.dim('│'));
  }

  console.log(pc.dim('└' + separator.replace(/┼/g, '┴') + '┘'));
}

export function box(content: string, title?: string): void {
  const lines = content.split('\n');
  const maxLength = Math.max(...lines.map((l) => l.length), title?.length || 0);
  const width = maxLength + 4;

  const top = '╭' + '─'.repeat(width - 2) + '╮';
  const bottom = '╰' + '─'.repeat(width - 2) + '╯';

  console.log(pc.dim(top));
  if (title) {
    console.log(pc.dim('│') + ' ' + pc.bold(title.padEnd(width - 3)) + pc.dim('│'));
    console.log(pc.dim('│') + '─'.repeat(width - 2) + pc.dim('│'));
  }
  for (const line of lines) {
    console.log(pc.dim('│') + ' ' + line.padEnd(width - 3) + pc.dim('│'));
  }
  console.log(pc.dim(bottom));
}
