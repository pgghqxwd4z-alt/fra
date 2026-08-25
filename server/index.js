import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT) || 5176;
const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const INDEX_PATH = resolve(DIST_DIR, 'index.html');
const MAX_BODY_SIZE = 25 * 1024 * 1024;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const CONTENT_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request) {
  const username = process.env.AUTH_USER;
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) return true;

  const header = request.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let suppliedCredentials;
  try {
    suppliedCredentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  return safeEqual(suppliedCredentials, `${username}:${password}`);
}

function sendUnauthorized(response) {
  sendJson(response, 401, { error: 'Authentication required.' }, {
    'WWW-Authenticate': 'Basic realm="QuantSage"',
  });
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        resolveBody(null);
        return;
      }
      resolveBody(Buffer.concat(chunks));
    });
    request.on('error', rejectBody);
  });
}

function safeStaticPath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(DIST_DIR, `.${decodedPath}`);
  return candidate === DIST_DIR || candidate.startsWith(`${DIST_DIR}/`) ? candidate : null;
}

async function serveStatic(request, response, pathname) {
  const requestedPath = safeStaticPath(pathname);
  let filePath = requestedPath;
  if (filePath) {
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) filePath = null;
    } catch {
      filePath = null;
    }
  }
  if (!filePath) filePath = INDEX_PATH;

  try {
    const body = await readFile(filePath);
    const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length,
    });
    response.end(body);
  } catch {
    sendJson(response, 500, { error: 'Unable to serve the application.' });
  }
}

async function proxyGroq(request, response) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    sendJson(response, 500, { error: 'The server has no Groq key configured.' });
    return;
  }

  const body = await readBody(request);
  if (body === null) {
    sendJson(response, 413, { error: 'Request body is too large.' });
    return;
  }

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    const upstreamBody = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Content-Length': upstreamBody.length,
    };
    for (const header of [
      'x-ratelimit-limit-tokens',
      'x-ratelimit-remaining-tokens',
      'x-ratelimit-remaining-requests',
      'x-ratelimit-reset',
    ]) {
      const value = upstream.headers.get(header);
      if (value) headers[header] = value;
    }
    response.writeHead(upstream.status, headers);
    response.end(upstreamBody);
  } catch {
    sendJson(response, 502, { error: 'Unable to reach the Groq API.' });
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (!isAuthorized(request)) {
    sendUnauthorized(response);
    return;
  }

  if (requestUrl.pathname === '/api/groq/chat/completions' && request.method === 'POST') {
    await proxyGroq(request, response);
    return;
  }
  if (requestUrl.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  if (request.method !== 'GET') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  await serveStatic(request, response, requestUrl.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QuantSage listening on 0.0.0.0:${PORT}`);
});
