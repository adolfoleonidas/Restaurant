// Sirve el build de producción en local con el mismo reparto que nginx: los
// archivos estáticos desde `build/` y `/api/*` proxeado al backend.
//
// Por qué existe: el arnés de auditoría tiene que medir el build de producción
// (service worker, carga bajo demanda, hashes), no el servidor de desarrollo.
// Y al proxear la API en el MISMO origen no hace falta relajar la seguridad del
// navegador de pruebas (--disable-web-security), que es lo que obligaba a servir
// la app en otro puerto con la API en una URL absoluta.
//
// Uso (desde `frontend/`, con el build ya hecho):
//
//     node e2e/audit/serve-build.mjs            # http://127.0.0.1:3001
//     PORT=3005 node e2e/audit/serve-build.mjs
//
// Variables: PORT (3001), AUDIT_API_HOST (127.0.0.1), AUDIT_API_PORT (8000).

import { createReadStream, existsSync, statSync } from 'fs';
import { createServer, request as httpRequest } from 'http';
import path from 'path';

const ROOT = path.resolve('build');
const PORT = Number(process.env.PORT || 3001);
const API_HOST = process.env.AUDIT_API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.AUDIT_API_PORT || 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** /api/* se reenvía tal cual: sin buffer, para que el SSE del seguimiento fluya. */
function proxy(req, res) {
  const upstream = httpRequest(
    {
      host: API_HOST,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('backend no disponible');
  });
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/api/')) return proxy(req, res);

  let relative;
  try {
    relative = decodeURIComponent(url);
  } catch (_) {
    res.writeHead(400);
    return res.end('ruta inválida');
  }
  const resolved = path.resolve(ROOT, relative.replace(/^[/\\]+/, ''));
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('prohibido');
  }

  let file = resolved;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Un archivo con extensión que no existe es un 404 de verdad; una ruta sin
    // extensión es una ruta de la SPA y se resuelve con el index (igual que
    // `try_files` en nginx).
    if (path.extname(relative)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('no encontrado');
    }
    file = path.join(ROOT, 'index.html');
  }

  if (!existsSync(file)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('falta el build: ejecutá `npm run build` antes de servir');
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    // Sin caché del navegador: cada medición tiene que empezar del build actual.
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`build servido en http://127.0.0.1:${PORT} (api -> http://${API_HOST}:${API_PORT})`);
});
