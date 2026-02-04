/**
 * Local HTTP server to receive OAuth callback from browser
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT_RANGE_START = 9876;
const PORT_RANGE_END = 9886;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface CallbackResult {
  code: string;
  state: string;
}

export interface CallbackError {
  error: string;
  state?: string;
}

export interface CallbackServer {
  port: number;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}

/**
 * Try to start a server on a port, returns null if port is in use
 */
function tryStartServer(
  port: number,
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer(handler);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(null);
      } else {
        resolve(null);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

/**
 * Start a local callback server on an available port
 */
export async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  let server: Server | null = null;
  let port = PORT_RANGE_START;

  // Try ports in range until one is available
  while (port <= PORT_RANGE_END && !server) {
    let resolveCallback: (result: CallbackResult) => void;
    let rejectCallback: (error: Error) => void;

    const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });

    const handler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET' || !req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      // Return simple OK response (this is called via fetch, not browser navigation)
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('OK');

      if (error) {
        rejectCallback(new Error(error));
        return;
      }

      if (!code || !state) {
        rejectCallback(new Error('Missing code or state'));
        return;
      }

      if (state !== expectedState) {
        rejectCallback(new Error('State mismatch'));
        return;
      }

      resolveCallback({ code, state });
    };

    server = await tryStartServer(port, handler);

    if (server) {
      const currentPort = port;
      let timeoutId: NodeJS.Timeout;

      const waitForCallback = (): Promise<CallbackResult> => {
        return new Promise((resolve, reject) => {
          timeoutId = setTimeout(() => {
            server?.close();
            reject(new Error('Authorization timed out'));
          }, TIMEOUT_MS);

          callbackPromise
            .then((result) => {
              clearTimeout(timeoutId);
              // Give browser time to receive response before closing
              setTimeout(() => server?.close(), 100);
              resolve(result);
            })
            .catch((err) => {
              clearTimeout(timeoutId);
              setTimeout(() => server?.close(), 100);
              reject(err);
            });
        });
      };

      const close = () => {
        clearTimeout(timeoutId);
        server?.close();
      };

      return {
        port: currentPort,
        waitForCallback,
        close,
      };
    }

    port++;
  }

  throw new Error(`Could not find available port in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}
