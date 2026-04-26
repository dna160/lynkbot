import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const API_TARGET = process.env.API_URL || 'http://host.docker.internal:3000';
const DIST_DIR = path.join(__dirname, 'dist');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function proxyRequest(req, res, targetPath) {
  const options = {
    hostname: 'host.docker.internal',
    port: 3000,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: 'host.docker.internal:3000' },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'API unavailable', message: err.message }));
  });

  req.pipe(proxyReq);
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url?.startsWith('/api/') || req.url?.startsWith('/webhooks/')) {
    proxyRequest(req, res, req.url);
    return;
  }

  let filePath = path.join(DIST_DIR, req.url === '/' ? 'index.html' : req.url);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      serveFile(filePath, res);
    } else {
      serveFile(path.join(DIST_DIR, 'index.html'), res);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard server running at http://0.0.0.0:${PORT}/`);
  console.log(`API proxy: ${API_TARGET}`);
});
