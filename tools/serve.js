const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const port = parseInt(process.argv[3], 10) || 5000;
const appName = process.argv[4] || 'App';
const backendHost = process.env.BACKEND_HOST || '127.0.0.1';
const backendPort = parseInt(process.env.BACKEND_PORT, 10) || 3000;
const tlsKeyPath = process.env.HTTPS_KEY_FILE;
const tlsCertPath = process.env.HTTPS_CERT_FILE;

if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath)) {
  throw new Error('Set both HTTPS_KEY_FILE and HTTPS_CERT_FILE to enable HTTPS.');
}

const tlsOptions = tlsKeyPath && tlsCertPath
  ? { key: fs.readFileSync(tlsKeyPath), cert: fs.readFileSync(tlsCertPath) }
  : null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const handleRequest = (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/')) {
    const proxy = http.request({
      hostname: backendHost,
      port: backendPort,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: req.method,
      headers: { ...req.headers, host: `${backendHost}:${backendPort}` }
    }, (backendRes) => {
      res.writeHead(backendRes.statusCode, backendRes.headers);
      backendRes.pipe(res);
    });

    proxy.on('error', (error) => {
      console.error(`API proxy error (${backendHost}:${backendPort}): ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('502 Backend Unavailable');
    });
    req.pipe(proxy);
    return;
  }

  // Normalize URL and remove query strings
  let reqPath = decodeURI(requestUrl.pathname);
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(targetDir, reqPath);

  // Security check to prevent directory traversal
  if (!filePath.startsWith(targetDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('500 Internal Server Error');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    });
  });
};

const server = tlsOptions
  ? https.createServer(tlsOptions, handleRequest)
  : http.createServer(handleRequest);

server.listen(port, () => {
  const protocol = tlsOptions ? 'https' : 'http';
  const url = `${protocol}://localhost:${port}`;
  console.log(`====================================================`);
  console.log(`  Mango Royal - ${appName}`);
  console.log(`  Serving folder: ${targetDir}`);
  console.log(`  Running at:     ${url}`);
  Object.values(os.networkInterfaces()).flat().forEach((network) => {
    if (network && network.family === 'IPv4' && !network.internal) {
      console.log(`  LAN address:    ${protocol}://${network.address}:${port}`);
    }
  });
  if (!tlsOptions) {
    console.log('  Tablet PWA:     Configure HTTPS_KEY_FILE and HTTPS_CERT_FILE for secure LAN access.');
  }
  console.log(`  Press Ctrl+C to stop`);
  console.log(`====================================================\n`);

  // Open the browser
  if (process.env.NO_BROWSER !== '1') {
    exec(`start "" "${url}"`);
  }
});
