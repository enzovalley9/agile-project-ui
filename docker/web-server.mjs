import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.md', 'text/plain; charset=utf-8'],
]);

export async function publicHeaders(root) {
  const lines = (await readFile(path.join(root, '_headers'), 'utf8')).split('\n');
  const headers = {};
  let global = false;
  for (const line of lines) {
    if (line && !/^\s/.test(line)) {
      global = line.trim() === '/*';
      continue;
    }
    const header = /^\s+([^:]+):\s*(.+)$/.exec(line);
    if (global && header) headers[header[1]] = header[2];
  }
  if (!headers['Content-Security-Policy'] || !headers['X-Content-Type-Options'])
    throw new Error('The web bundle must include its security headers.');
  return headers;
}

export async function startWebServer({
  root,
  port = 8080,
  hostname = '0.0.0.0',
  signals = true,
  origin,
}) {
  const directory = await realpath(root);
  const headers = await publicHeaders(directory);
  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.setHeader('Cache-Control', 'no-store');
    const respond = (status, body) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const allowedHosts = [
      `127.0.0.1:${actualPort}`,
      `localhost:${actualPort}`,
      `[::1]:${actualPort}`,
    ];
    if (origin) allowedHosts.push(new URL(origin).host);
    if (!allowedHosts.includes(request.headers.host))
      return respond(403, 'Loopback host required.\n');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return respond(405, 'Method not allowed.\n');
    }
    try {
      // Reject raw/encoded dot segments before URL normalization can erase them.
      const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
      if (
        !pathname.startsWith('/') ||
        /[\\\0\r\n]/.test(pathname) ||
        pathname.split('/').some((segment) => segment.startsWith('.'))
      )
        return respond(404, 'Not found.\n');
      if (pathname === '/healthz') {
        response.setHeader('Content-Type', 'application/json');
        return response.end(
          request.method === 'HEAD' ? undefined : '{"status":"ok","service":"web"}\n',
        );
      }
      if (pathname === '/_headers' || pathname.endsWith('.map'))
        return respond(404, 'Not found.\n');
      let file = path.join(directory, pathname);
      if ((await lstat(file)).isDirectory()) file = path.join(file, 'index.html');
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (await realpath(file)) !== file ||
        !file.startsWith(directory + path.sep)
      )
        return respond(404, 'Not found.\n');
      const contentType =
        types.get(path.extname(file)) ??
        (path.basename(file) === 'LICENSE' ? 'text/plain; charset=utf-8' : null);
      if (!contentType) return respond(404, 'Not found.\n');
      const body = request.method === 'HEAD' ? undefined : await readFile(file);
      response.setHeader('Content-Type', contentType);
      response.setHeader('Content-Length', info.size);
      if (pathname.startsWith('/assets/'))
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.end(body);
    } catch {
      return respond(404, 'Not found.\n');
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, resolve);
  });
  if (signals) {
    const shutdown = () => {
      server.close();
      setTimeout(() => server.closeAllConnections(), 10_000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
  return server;
}
