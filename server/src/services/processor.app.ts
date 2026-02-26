import type { AppDependencies } from '../app.ts';
import type { QueueMessage, QueueConsumer } from '../adapters/queue/interface.ts';
import { generateId, now } from '../utils/common.ts';

interface QAPair {
  question: string;
  answer: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

interface EmbeddingResponse {
  data: { embedding: number[] }[];
}

/** Maximum content length (in characters) to send to the LLM for Q&A generation */
const MAX_CONTENT_LENGTH = 12000;

export function createQueueConsumer(deps: AppDependencies): QueueConsumer {
  return {
    async process(message: QueueMessage): Promise<void> {
      await processBookmark(deps, message.bookmarkId);
    },
  };
}

async function processBookmark(deps: AppDependencies, bookmarkId: string): Promise<void> {
  const bookmark = await deps.db.prepare<{
    id: string;
    html: string | null;
    title: string;
    url: string;
  }>('SELECT * FROM bookmarks WHERE id = ?').bind(bookmarkId).first();

  if (!bookmark) {
    console.log(`Bookmark ${bookmarkId} not found, skipping`);
    return;
  }

  await deps.db.prepare(`
    UPDATE bookmarks SET status = 'processing', updated_at = ? WHERE id = ?
  `).bind(now(), bookmarkId).run();

  try {
    let html = bookmark.html || '';

    if (!html.trim()) {
      try {
        const response = await fetch(bookmark.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BookmarkBot/1.0)' },
          redirect: 'follow',
        });
        if (response.ok) {
          html = await response.text();
          await deps.db.prepare('UPDATE bookmarks SET html = ?, updated_at = ? WHERE id = ?')
            .bind(html, now(), bookmarkId).run();
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (fetchError) {
        const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.warn(`Failed to fetch URL ${bookmark.url}: ${msg}`);
        await deps.db.prepare(`
          UPDATE bookmarks SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?
        `).bind(`Failed to fetch URL: ${msg}`, now(), bookmarkId).run();
        return;
      }
    }

    const markdown = htmlToMarkdown(html);

    await deps.db.prepare(`
      UPDATE bookmarks SET markdown = ?, updated_at = ? WHERE id = ?
    `).bind(markdown, now(), bookmarkId).run();

    const qaPairs = await generateQAPairs(deps, bookmark.title, markdown, bookmark.url);

    if (qaPairs.length > 0) {
      await deps.db.prepare('DELETE FROM questions_answers WHERE bookmark_id = ?').bind(bookmarkId).run();

      const textsToEmbed: string[] = [];
      for (const qa of qaPairs) {
        textsToEmbed.push(qa.question);
        textsToEmbed.push(qa.answer);
        textsToEmbed.push(`${qa.question} ${qa.answer}`);
      }

      let embeddings: Float32Array[] = [];
      try {
        embeddings = await getEmbeddings(deps, textsToEmbed);
      } catch (error) {
        console.warn(`Failed to get embeddings for bookmark ${bookmarkId}:`, error);
      }

      for (let i = 0; i < qaPairs.length; i++) {
        const qa = qaPairs[i];
        const embeddingOffset = i * 3;

        const embeddingQuestion = embeddings[embeddingOffset]
          ? new Uint8Array(embeddings[embeddingOffset].buffer)
          : null;
        const embeddingAnswer = embeddings[embeddingOffset + 1]
          ? new Uint8Array(embeddings[embeddingOffset + 1].buffer)
          : null;
        const embeddingBoth = embeddings[embeddingOffset + 2]
          ? new Uint8Array(embeddings[embeddingOffset + 2].buffer)
          : null;

        await deps.db.prepare(`
          INSERT INTO questions_answers (id, bookmark_id, question, answer, embedding_question, embedding_answer, embedding_both, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          generateId(),
          bookmarkId,
          qa.question,
          qa.answer,
          embeddingQuestion,
          embeddingAnswer,
          embeddingBoth,
          now()
        ).run();
      }
    }

    await deps.db.prepare(`
      UPDATE bookmarks SET status = 'complete', error_message = NULL, updated_at = ? WHERE id = ?
    `).bind(now(), bookmarkId).run();

    console.log(`Processed bookmark ${bookmarkId}: ${qaPairs.length} Q&A pairs generated`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await deps.db.prepare(`
      UPDATE bookmarks SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?
    `).bind(errorMessage, now(), bookmarkId).run();
    throw error;
  }
}

function stripElementsByTag(html: string, tag: string): string {
  let text = html;
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  const tagLen = closeTag.length;
  let lower = text.toLowerCase();
  let idx: number;
  while ((idx = lower.indexOf(openTag.toLowerCase())) !== -1) {
    const closeIdx = lower.indexOf(closeTag.toLowerCase(), idx);
    if (closeIdx === -1) {
      text = text.substring(0, idx);
      break;
    }
    text = text.substring(0, idx) + text.substring(closeIdx + tagLen);
    lower = text.toLowerCase();
  }
  return text;
}

function htmlToMarkdown(html: string): string {
  let text = html;

  text = stripElementsByTag(text, 'script');
  text = stripElementsByTag(text, 'style');

  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  text = text.replace(/<br[^>]*>/gi, '\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n');
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n');

  // Strip remaining HTML tags, looping to handle nested artifacts
  let prev;
  do {
    prev = text;
    text = text.replace(/<[^>]+>/g, '');
  } while (text !== prev);

  // Decode HTML entities — decode &amp; last to prevent double-unescaping
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&amp;/g, '&');

  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

async function generateQAPairs(deps: AppDependencies, title: string, markdown: string, url: string): Promise<QAPair[]> {
  const OPENAI_API_BASE = deps.env.get('OPENAI_API_BASE') || 'https://api.openai.com/v1';
  const OPENAI_API_KEY = deps.env.get('OPENAI_API_KEY');
  const CHAT_MODEL = deps.env.get('CHAT_MODEL') || 'gpt-4o-mini';

  if (!OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not configured, skipping Q&A generation');
    return [];
  }

  const content = markdown.length > MAX_CONTENT_LENGTH
    ? markdown.substring(0, MAX_CONTENT_LENGTH) + '...'
    : markdown;

  const prompt = `Given the following webpage content, generate 3-5 question and answer pairs that capture the key information.

Title: ${title}
URL: ${url}

Content:
${content}

Generate questions that would help someone find this page when searching. Include:
1. A direct question about the main topic
2. Questions about specific details or facts
3. A "how to" or "what is" question if applicable

Respond with a JSON array of objects with "question" and "answer" keys. Keep answers concise but informative.

Example format:
[
  {"question": "What is...", "answer": "..."},
  {"question": "How do I...", "answer": "..."}
]`;

  try {
    const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Chat API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as ChatCompletionResponse;
    const responseContent = data.choices?.[0]?.message?.content;

    if (!responseContent) {
      throw new Error('No content in response');
    }

    const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const qaPairs = JSON.parse(jsonMatch[0]) as QAPair[];

    return qaPairs.filter(
      qa => qa.question && qa.answer && typeof qa.question === 'string' && typeof qa.answer === 'string'
    );
  } catch (error) {
    console.error('Failed to generate Q&A pairs:', error);
    return [];
  }
}

async function getEmbeddings(deps: AppDependencies, texts: string[]): Promise<Float32Array[]> {
  const OPENAI_API_BASE = deps.env.get('OPENAI_API_BASE') || 'https://api.openai.com/v1';
  const OPENAI_API_KEY = deps.env.get('OPENAI_API_KEY');
  const EMBEDDING_MODEL = deps.env.get('EMBEDDING_MODEL') || 'text-embedding-3-small';

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (texts.length === 0) {
    return [];
  }

  const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as EmbeddingResponse;

  return data.data.map(item => new Float32Array(item.embedding));
}

export { processBookmark };
