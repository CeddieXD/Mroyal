const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const net = require('net');
const { createRequire } = require('module');
const { exec } = require('child_process');

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const port = parseInt(process.argv[3], 10) || 5000;
const appName = process.argv[4] || 'App';
const backendHost = process.env.BACKEND_HOST || '127.0.0.1';
const backendPort = parseInt(process.env.BACKEND_PORT, 10) || 3000;
const tlsKeyPath = process.env.HTTPS_KEY_FILE;
const tlsCertPath = process.env.HTTPS_CERT_FILE;
const liveReloadEnabled = process.env.LIVE_RELOAD === '1';
const reloadClients = new Set();
const backendRequire = createRequire(path.join(
  __dirname,
  '..',
  'mango-royal-kiosk',
  'mango-royal-backend',
  'package.json'
));

if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath)) {
  throw new Error('Set both HTTPS_KEY_FILE and HTTPS_CERT_FILE to enable HTTPS.');
}

const tlsOptions = tlsKeyPath && tlsCertPath
  ? { key: fs.readFileSync(tlsKeyPath), cert: fs.readFileSync(tlsCertPath) }
  : null;

function getLanAddress() {
  const configuredAddress = process.env.LAN_HOST;
  if (configuredAddress) {
    if (!net.isIPv4(configuredAddress)) {
      return Promise.reject(new Error('LAN_HOST must be a valid IPv4 address.'));
    }
    return Promise.resolve(configuredAddress);
  }

  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (address) => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve(address);
    };

    socket.once('error', () => finish(null));
    socket.connect(9, '1.1.1.1', () => {
      const address = socket.address().address;
      finish(net.isIPv4(address) && !address.startsWith('127.') ? address : null);
    });
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

  // SSE endpoint for live reload
  if (liveReloadEnabled && requestUrl.pathname === '/__dev/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.write('data: connected\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }

  // Proxy /api/* to the backend
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

  // Serve static files
  let reqPath = decodeURI(requestUrl.pathname);
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(targetDir, reqPath);

  // Prevent directory traversal
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
      const isEntryHtml = requestUrl.pathname === '/' || requestUrl.pathname === '/index.html';

      // In live-reload mode, inject the SSE client into index.html
      const responseContent = liveReloadEnabled && isEntryHtml
        ? content.toString('utf8').replace(/<head(?:\s[^>]*)?>/i, headTag => `${headTag}
    <script>
      (function () {
        var events = new EventSource('/__dev/events');
        events.addEventListener('change', function () { window.location.reload(); });
      })();
    </script>`)
        : content;

      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        // Disable all caching in dev mode so every reload fetches fresh files
        ...(liveReloadEnabled ? { 'Cache-Control': 'no-store' } : {})
      });
      res.end(responseContent);
    });
  });
};

const server = tlsOptions
  ? https.createServer(tlsOptions, handleRequest)
  : http.createServer(handleRequest);
let bonjourInstance = null;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Cannot start Mango Royal - ${appName}: port ${port} is already in use.`);
  } else {
    console.error(`Cannot start Mango Royal - ${appName}: ${error.message}`);
  }
  process.exitCode = 1;
});

function advertiseOnLocalNetwork(lanAddress) {
  try {
    const { Bonjour } = backendRequire('bonjour-service');
    bonjourInstance = new Bonjour({}, error => {
      console.error(`  Local discovery error: ${error ? error.message : 'Unknown Bonjour error.'}`);
    });
    const service = bonjourInstance.publish({
      name: `Mango Royal - ${appName}`,
      type: 'http',
      port,
      host: 'mroyal.local',
      txt: { app: appName }
    });
    const getRecords = service.records.bind(service);
    service.records = () => getRecords().filter(record =>
      (record.type !== 'A' && record.type !== 'AAAA') || record.data === lanAddress
    );
    return true;
  } catch (error) {
    console.error(`  Local discovery unavailable: ${error.message}`);
    return false;
  }
}

server.listen(port, async () => {
  if (liveReloadEnabled) {
    let reloadTimer;
    try {
      fs.watch(targetDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          for (const client of reloadClients) client.write('event: change\ndata: reload\n\n');
          console.log(`  File changed: ${filename}`);
        }, 150);
      });
      console.log('  Live reload:    enabled');
    } catch (error) {
      console.error(`Live reload could not watch ${targetDir}: ${error.message}`);
    }
  }

  const protocol = tlsOptions ? 'https' : 'http';
  const url = `${protocol}://localhost:${port}`;
  let lanAddress = null;
  console.log(`====================================================`);
  console.log(`  Mango Royal - ${appName}`);
  console.log(`  Serving folder: ${targetDir}`);
  console.log(`  Running at:     ${url}`);
  try {
    lanAddress = await getLanAddress();
  } catch (error) {
    console.error(`  LAN address could not be determined: ${error.message}`);
  }
  if (lanAddress) {
    if (advertiseOnLocalNetwork(lanAddress)) {
      console.log(`  Local name:     http://mroyal.local:${port}`);
    }
    console.log(`  LAN address:    ${protocol}://${lanAddress}:${port}`);
  } else {
    console.log('  LAN address:    unavailable (no active network route)');
  }
  console.log(`  Press Ctrl+C to stop`);
  console.log(`====================================================\n`);

  if (process.env.NO_BROWSER !== '1') {
    exec(`start "" "${url}"`);
  }
});

server.on('close', () => {
  if (bonjourInstance) bonjourInstance.destroy();
});

process.once('exit', () => {
  if (bonjourInstance) bonjourInstance.destroy();
});
