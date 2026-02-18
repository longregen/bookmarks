/**
 * Screenshot Capture Script for Golden Ratio Validation
 *
 * Uses Chrome's native --screenshot flag for reliability in CI environments.
 * Serves the built Chrome extension pages directly (no base path issues).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CHROME_DIR = path.resolve(PROJECT_ROOT, 'dist-chrome');
const OUTPUT_DIR = path.resolve(PROJECT_ROOT, 'golden-ratio-screenshots');
const BROWSER_PATH = process.env.BROWSER_PATH || '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';

function startServer(dir: string, port: number): Promise<ReturnType<typeof createServer>> {
  const resolvedDir = path.resolve(dir);
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const urlPath = req.url?.split('?')[0] || '/';
      let filePath = path.resolve(dir, '.' + urlPath);
      // Prevent path traversal — resolved path must stay within served dir
      if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const types: Record<string, string> = {
        '.html': 'text/html', '.css': 'text/css',
        '.js': 'application/javascript', '.png': 'image/png',
        '.json': 'application/json', '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(port, () => resolve(server));
  });
}

const themes = ['light', 'dark', 'terminal', 'tufte'] as const;

const pages = [
  { name: 'welcome', path: '/src/welcome/welcome.html', width: 1200, height: 800 },
  { name: 'options', path: '/src/options/options.html', width: 1200, height: 900 },
  { name: 'library', path: '/src/library/library.html', width: 1200, height: 800 },
  { name: 'search', path: '/src/search/search.html', width: 1200, height: 800 },
  { name: 'popup', path: '/src/popup/popup.html', width: 320, height: 240 },
];

function captureScreenshot(url: string, outputPath: string, width: number, height: number): boolean {
  const args = [
    BROWSER_PATH,
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-software-rasterizer',
    `--screenshot=${outputPath}`,
    `--window-size=${width},${height}`,
    url,
  ];

  try {
    execSync(args.map(a => `"${a}"`).join(' '), { stdio: 'pipe', timeout: 30000 });
  } catch {
    // Chrome often exits with non-zero even when screenshot succeeds
  }

  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000;
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Golden Ratio Design System - Screenshot Validation');
  console.log('='.repeat(60));

  if (!fs.existsSync(CHROME_DIR)) {
    console.error('Build dist-chrome first: npm run build:chrome');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const server = await startServer(CHROME_DIR, 8765);
  console.log(`Server: http://localhost:8765`);
  console.log(`Browser: ${BROWSER_PATH}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  let captured = 0;
  const total = pages.length * themes.length;

  for (const pageConfig of pages) {
    for (const theme of themes) {
      const filename = `${pageConfig.name}-${theme}.png`;
      const outPath = path.join(OUTPUT_DIR, filename);
      process.stdout.write(`  ${pageConfig.name} (${theme})...`);

      // Chrome's --screenshot can't set data-theme via JS, so we serve
      // a tiny wrapper that sets the theme attribute before the page loads.
      // Use a query param to pass the theme and inject it via inline script.
      const url = `http://localhost:8765${pageConfig.path}#theme=${theme}`;

      // Create a themed wrapper HTML that redirects CSS vars
      const tmpPath = path.join(CHROME_DIR, `_themed_${filename.replace('.png', '.html')}`);
      const cssPath = getCssPath(pageConfig.path);

      fs.writeFileSync(tmpPath, `<!DOCTYPE html>
<html data-theme="${theme}" lang="en">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${cssPath}">
<style>
html, body { margin: 0; padding: 0; width: ${pageConfig.width}px; height: ${pageConfig.height}px; overflow: hidden; }
</style>
</head>
<body>
<iframe src="${pageConfig.path}" style="width:${pageConfig.width}px;height:${pageConfig.height}px;border:none;"
  onload="try{this.contentDocument.documentElement.setAttribute('data-theme','${theme}')}catch(e){}"></iframe>
</body>
</html>`);

      const wrapperUrl = `http://localhost:8765/_themed_${filename.replace('.png', '.html')}`;

      if (captureScreenshot(wrapperUrl, outPath, pageConfig.width, pageConfig.height)) {
        const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
        console.log(` ${kb} KB`);
        captured++;
      } else {
        console.log(` FAILED`);
      }

      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  server.close();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Captured ${captured} / ${total} screenshots`);
  console.log(`Output: ${OUTPUT_DIR}/`);
  console.log('='.repeat(60));
}

function getCssPath(pagePath: string): string {
  // Read the HTML to find the CSS link
  const htmlPath = path.join(CHROME_DIR, pagePath);
  if (!fs.existsSync(htmlPath)) return '';
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const match = html.match(/href="([^"]+\.css)"/);
  return match ? match[1] : '';
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
