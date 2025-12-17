import http from 'http';
import {
  getMockQAPairsResponse,
  getMockEmbeddingsResponse,
  getMockModelsResponse,
} from './e2e-shared';

export interface MockServer {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startMockServer(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        const url = req.url || '';

        if (url.includes('/chat/completions')) {
          res.statusCode = 200;
          res.end(JSON.stringify(getMockQAPairsResponse()));
        } else if (url.includes('/embeddings')) {
          let inputCount = 1;
          if (body) {
            try {
              const parsed = JSON.parse(body);
              inputCount = Array.isArray(parsed.input) ? parsed.input.length : 1;
            } catch { /* ignore parse errors */ }
          }
          res.statusCode = 200;
          res.end(JSON.stringify(getMockEmbeddingsResponse(inputCount)));
        } else if (url.includes('/models')) {
          res.statusCode = 200;
          res.end(JSON.stringify(getMockModelsResponse()));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        const url = `http://127.0.0.1:${port}`;
        console.log(`Mock API server running at ${url}`);
        resolve({
          server,
          port,
          url,
          close: () => new Promise<void>(res => server.close(() => res())),
        });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}
