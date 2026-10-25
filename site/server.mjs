// Tofu: serves Actual's prebuilt web client (the `web` folder beside this file) over HTTP on PORT.
//
// Actual keeps each budget in the visitor's own browser and needs SharedArrayBuffer for it, which a browser only
// allows on a page served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
// require-corp`. Tofu's static hosting cannot send those headers, so this small server sends every file with them,
// the same headers (and Content-Security-Policy) upstream's own sync server sends in production
// (packages/sync-server/src/app.ts). It has no dependencies, keeps no data and answers none of the sync server's own
// addresses: Actual asks this address for a sync server once, gets a 404, and runs without one.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlib, gzip } from 'node:zlib';

const ROOT = fileURLToPath(new URL('./web', import.meta.url));
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 80;
const HOST = process.env.HOST || undefined; // every interface unless HOST is set

const CSP = [
  "default-src 'self' blob:",
  "img-src 'self' blob: data:",
  "script-src 'self' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  'connect-src http: https:',
].join('; ');

const BASE_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.sqlite': 'application/octet-stream',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Text-like files worth compressing; images and fonts are compressed already.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.wasm', '.txt', '.sql', '.sqlite', '.xml', '.svg']);
const COMPRESS_MIN_BYTES = 1024;

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);
// path + encoding -> Promise<Buffer>. The files never change while the server runs, so each is compressed once.
const compressed = new Map();

function compress(file, encoding) {
  const key = `${encoding}:${file}`;
  let pending = compressed.get(key);
  if (!pending) {
    pending = readFile(file).then((bytes) =>
      encoding === 'br'
        ? brotli(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 6, [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length } })
        : gz(bytes, { level: 6 }),
    );
    pending.catch(() => compressed.delete(key));
    compressed.set(key, pending);
  }
  return pending;
}

function pickEncoding(header) {
  const accepted = String(header ?? '')
    .split(',')
    .map((part) => part.trim().split(';'))
    .filter(([, q]) => !q || !/^q=0(\.0*)?$/.test(q.trim()))
    .map(([name]) => name.trim().toLowerCase());
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

/** The file a URL path names inside ROOT, or null for one that leaves it or names a hidden file. */
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  if (decoded.split('/').some((part) => part.startsWith('.') && part.length > 0)) return null;
  const file = normalize(join(ROOT, decoded));
  return file === ROOT || file.startsWith(ROOT + sep) ? file : null;
}

async function fileInfo(file) {
  if (!file) return null;
  try {
    const info = await stat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

function cacheControl(pathname) {
  // Vite names everything under /static/ by its content hash, so those never change under the same name.
  return pathname.startsWith('/static/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

async function sendFile(req, res, file, info, pathname) {
  const ext = extname(file).toLowerCase();
  const encoding = COMPRESSIBLE.has(ext) && info.size >= COMPRESS_MIN_BYTES ? pickEncoding(req.headers['accept-encoding']) : null;
  const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}${encoding ? `-${encoding}` : ''}"`;
  const headers = {
    ...BASE_HEADERS,
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(pathname),
    ETag: etag,
    'Last-Modified': info.mtime.toUTCString(),
  };
  if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*')) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  if (encoding) {
    const body = await compress(file, encoding);
    res.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

function sendText(res, status, text, extra = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    sendText(res, 400, 'Bad request\n');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = resolveFile(pathname);
  const info = await fileInfo(file);
  if (info) {
    await sendFile(req, res, file, info, pathname);
    return;
  }

  // A page of the app (/budget, /accounts/...) is the app itself; Actual's router takes it from there. Anything
  // else is not here, including the sync server's own addresses, such as /account/needs-bootstrap, which Actual
  // asks once to find out whether a sync server runs at this address. A plain-text 404 tells it none does.
  const accept = String(req.headers.accept ?? '');
  if (accept.includes('text/html')) {
    const index = join(ROOT, 'index.html');
    const indexInfo = await fileInfo(index);
    if (indexInfo) {
      await sendFile(req, res, index, indexInfo, '/index.html');
      return;
    }
  }
  sendText(res, 404, 'Not found\n');
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (res.headersSent) res.destroy();
    else sendText(res, 500, 'Internal error\n');
  });
});
server.keepAliveTimeout = 65_000;

server.listen(PORT, HOST, () => {
  console.log(`Actual web client on http://${HOST ?? '0.0.0.0'}:${PORT}, serving ${ROOT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
