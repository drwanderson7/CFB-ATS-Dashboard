// Shared harness for real browser-driven interaction tests (as opposed to
// the regex-against-source-code tests elsewhere in this suite). Spins up a
// plain Node http server for the project's static files (ES modules need a
// real http:// origin — file:// breaks module imports under CORS) and a
// Playwright Chromium page, and tears both down cleanly.
//
// Why this exists: `npm run check` passing has repeatedly NOT proven the app
// actually works — see HANDOFF.md's v1.12.0 entry, where three real
// integration bugs (one with zero console output at all) were only caught by
// manually driving the app in a browser. These tests make that verification
// step permanent and repeatable instead of ad hoc.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function createStaticServer() {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
    // Guard against path traversal outside the project root.
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

// Runs `testFn({ page, baseURL, consoleErrors, pageErrors })` against a fresh
// server + browser page, then tears both down — including on failure, so a
// thrown assertion doesn't leak a hanging server or browser process.
export async function withBrowserPage(testFn, { viewport = { width: 1280, height: 1000 } } = {}) {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });
  const { port } = server.address();
  const baseURL = `http://localhost:${port}`;

  const browser = await chromium.launch();
  const consoleErrors = [];
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport });
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(String(err && err.message ? err.message : err)));
    await testFn({ page, baseURL, consoleErrors, pageErrors });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

// Throws with a clear message if the page threw any uncaught error or logged
// any console.error during the test. Call this at the point in a test where
// "the app should be in a clean, fully-loaded state" — not necessarily at
// the very end, since some tests intentionally trigger and check error
// states (e.g. a failed sync request), which is different from an
// *unintended* JS error.
export function assertNoErrors(consoleErrors, pageErrors, label = '') {
  if (pageErrors.length) {
    throw new Error(`${label ? label + ': ' : ''}uncaught page error(s): ${pageErrors.join(' | ')}`);
  }
  if (consoleErrors.length) {
    throw new Error(`${label ? label + ': ' : ''}console.error call(s): ${consoleErrors.join(' | ')}`);
  }
}
