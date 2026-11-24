import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const models = {
  '/__local-kart.glb': 'go-kart-fitted.glb',
  '/__mixamo-kart.glb': 'mixamo-kart.glb',
};
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function serveLocalKart(server) {
  server.middlewares.use((req, res, next) => {
    const filename = models[req.url?.split('?')[0]];
    if (!filename) return next();
    const model = fileURLToPath(new URL('./.local-assets/' + filename, import.meta.url));
    const host = req.headers.host?.replace(/:\d+$/, '');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' || !loopbackHosts.has(host) ||
        !loopbackAddresses.has(req.socket.remoteAddress)) {
      res.writeHead(404).end();
      return;
    }
    const file = createReadStream(model);
    file.once('open', () => {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
      file.pipe(res);
    });
    file.once('error', error => {
      if (res.headersSent) res.destroy(error);
      else res.writeHead(error.code === 'ENOENT' ? 204 : 500).end();
    });
    res.once('close', () => file.destroy());
  });
}

function servePreview(server) {
  serveLocalKart(server);
  server.middlewares.use((req, res, next) => {
    const isNavigation = req.method === 'GET' && req.headers.accept?.includes('text/html');
    if (!isNavigation) return next();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // The preview has one entry point. Its settings travel in the query string.
    if (url.pathname === '/' || url.pathname === '/index.html' ||
        /\.[^/]+$/.test(url.pathname.replace(/\/$/, ''))) return next();
    res.writeHead(302, {Location:'/' + url.search, 'Cache-Control':'no-store'}).end();
  });
}

export default defineConfig({
  appType: 'mpa',
  preview: { port:4194, strictPort:true },
  server: {
    fs: {
      deny: [
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml',
        '**/.git/**', '**/.local-assets/**',
      ],
    },
  },
  plugins: [{
    name: 'local-kart',
    configureServer: serveLocalKart,
    configurePreviewServer: servePreview,
  }],
});
