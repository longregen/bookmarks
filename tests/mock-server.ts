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

// Mock HTML pages themed after iconic internet documents
const MOCK_PAGES: Record<string, { title: string; html: string }> = {
  '/page/cyberspace-independence': {
    title: 'A Declaration of the Independence of Cyberspace',
    html: `<!DOCTYPE html>
<html>
<head><title>A Declaration of the Independence of Cyberspace</title></head>
<body>
<h1>A Declaration of the Independence of Cyberspace</h1>
<article>
<p>Governments of the Industrial World, you weary giants of flesh and steel, I come from Cyberspace, the new home of Mind.</p>
<p>On behalf of the future, I ask you of the past to leave us alone. You are not welcome among us. You have no sovereignty where we gather.</p>
<p>We have no elected government, nor are we likely to have one, so I address you with no greater authority than that with which liberty itself always speaks.</p>
<p>Cyberspace consists of transactions, relationships, and thought itself, arrayed like a standing wave in the web of our communications.</p>
<p>We are creating a world that all may enter without privilege or prejudice accorded by race, economic power, military force, or station of birth.</p>
</article>
</body>
</html>`
  },
  '/page/cypherpunk-manifesto': {
    title: "A Cypherpunk's Manifesto",
    html: `<!DOCTYPE html>
<html>
<head><title>A Cypherpunk's Manifesto</title></head>
<body>
<h1>A Cypherpunk's Manifesto</h1>
<article>
<p>Privacy is necessary for an open society in the electronic age. Privacy is not secrecy.</p>
<p>A private matter is something one doesn't want the whole world to know, but a secret matter is something one doesn't want anybody to know.</p>
<p>We the Cypherpunks are dedicated to building anonymous systems. We are defending our privacy with cryptography, with anonymous mail forwarding systems, with digital signatures, and with electronic money.</p>
<p>Cypherpunks write code. We know that someone has to write software to defend privacy, and since we can't get privacy unless we all do, we're going to write it.</p>
<p>We publish our code so that our fellow Cypherpunks may practice and play with it.</p>
</article>
</body>
</html>`
  },
  '/page/hacker-manifesto': {
    title: 'The Conscience of a Hacker',
    html: `<!DOCTYPE html>
<html>
<head><title>The Conscience of a Hacker</title></head>
<body>
<h1>The Conscience of a Hacker</h1>
<article>
<p>Another one got caught today, it's all over the papers. "Teenager Arrested in Computer Crime Scandal", "Hacker Arrested after Bank Tampering"...</p>
<p>I am a hacker, enter my world... Mine is a world that begins with school... I'm smarter than most of the other kids, this crap they teach us bores me...</p>
<p>I made a discovery today. I found a computer. Wait a second, this is cool. It does what I want it to. If it makes a mistake, it's because I screwed it up.</p>
<p>And then it happened... a door opened to a world... rushing through the phone line like heroin through an addict's veins, an electronic pulse is sent out.</p>
<p>This is our world now... the world of the electron and the switch, the beauty of the baud.</p>
</article>
</body>
</html>`
  }
};

export function getMockPageUrls(baseUrl: string): string[] {
  return Object.keys(MOCK_PAGES).map(path => `${baseUrl}${path}`);
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

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        const url = req.url || '';

        // Serve mock HTML pages
        if (url.startsWith('/page/') && MOCK_PAGES[url]) {
          res.setHeader('Content-Type', 'text/html');
          res.statusCode = 200;
          res.end(MOCK_PAGES[url].html);
          return;
        }

        // API endpoints
        res.setHeader('Content-Type', 'application/json');

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
