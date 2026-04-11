import { execFile, spawnSync } from 'node:child_process';

interface BrowserCommand {
  command: string;
  args: string[];
}

function hasCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookupCommand, [trimmed], {
    stdio: 'ignore',
  });

  return result.status === 0;
}

function getEnvBrowserCommand(url: string): BrowserCommand | null {
  const rawBrowser = process.env.BROWSER?.trim();
  if (!rawBrowser || rawBrowser.toLowerCase() === 'none') {
    return null;
  }

  const [command, ...rawArgs] = rawBrowser.split(/\s+/);
  if (!command) {
    return null;
  }

  let replacedUrl = false;
  const args = rawArgs.map((arg) => {
    if (!arg.includes('%s')) {
      return arg;
    }

    replacedUrl = true;
    return arg.replace(/%s/g, url);
  });

  if (!replacedUrl) {
    args.push(url);
  }

  return { command, args };
}

function getDefaultBrowserCommand(url: string): BrowserCommand {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [url] };
  }

  if (process.platform === 'win32') {
    return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  }

  if ((process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) && hasCommand('wslview')) {
    return { command: 'wslview', args: [url] };
  }

  return { command: 'xdg-open', args: [url] };
}

function getBrowserCommand(url: string): BrowserCommand {
  return getEnvBrowserCommand(url) || getDefaultBrowserCommand(url);
}

function hasBrowserEnvironment(): boolean {
  const rawBrowser = process.env.BROWSER?.trim();
  if (rawBrowser?.toLowerCase() === 'none') {
    return false;
  }

  if (rawBrowser) {
    return true;
  }

  if (process.env.CI) {
    return false;
  }

  if (process.platform === 'linux') {
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      return true;
    }

    return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  }

  return true;
}

export function canOpenUrlInBrowser(): boolean {
  if (!hasBrowserEnvironment()) {
    return false;
  }

  return hasCommand(getBrowserCommand('https://skills.cat').command);
}

export async function openUrlInBrowser(url: string): Promise<boolean> {
  if (!canOpenUrlInBrowser()) {
    return false;
  }

  const browserCommand = getBrowserCommand(url);

  return new Promise((resolve) => {
    execFile(browserCommand.command, browserCommand.args, (err) => {
      resolve(!err);
    });
  });
}
