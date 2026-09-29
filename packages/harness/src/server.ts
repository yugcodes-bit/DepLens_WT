/**
 * Minimal static server for measurement (doc 07 §3.5).
 * Serves several dist roots under path prefixes on one origin, with identical headers
 * and `Cache-Control: no-store`. No compression: CPU runs are measured without network
 * throttling; network cost is modeled from brotli bytes (doc 07 §4.6).
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

export interface StaticServer {
  origin: string;
  mount(prefix: string, dir: string): void;
  close(): Promise<void>;
}

export async function startServer(port = 0): Promise<StaticServer> {
  const mounts = new Map<string, string>();
  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const [, prefix, ...rest] = url.pathname.split('/');
      const root = mounts.get(prefix ?? '');
      if (!root) {
        res.writeHead(404).end();
        return;
      }
      const rel = normalize(rest.join('/') || 'index.html');
      if (rel.startsWith('..')) {
        res.writeHead(400).end();
        return;
      }
      const body = await readFile(join(root, rel));
      res.writeHead(200, {
        'content-type': TYPES[extname(rel)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'content-length': body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    origin: `http://127.0.0.1:${actualPort}`,
    mount: (prefix, dir) => mounts.set(prefix, dir),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
