import { getDatabase, generateId, now } from '../db/database.ts';
import { getEmbeddings } from './embeddings.ts';

const OPENAI_API_BASE = Deno.env.get('OPENAI_API_BASE') || 'https://api.openai.com/v1';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const CHAT_MODEL = Deno.env.get('CHAT_MODEL') || 'gpt-4o-mini';

interface QAPair {
  question: string;
  answer: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

// Simple in-memory queue
const processingQueue: string[] = [];
let isProcessing = false;

export function queueBookmarkProcessing(bookmarkId: string): void {
  if (!processingQueue.includes(bookmarkId)) {
    processingQueue.push(bookmarkId);
    processNext();
  }
}

async function processNext(): Promise<void> {
  if (isProcessing || processingQueue.length === 0) return;

  isProcessing = true;
  const bookmarkId = processingQueue.shift()!;

  try {
    await processBookmark(bookmarkId);
  } catch (error) {
    console.error(`Failed to process bookmark ${bookmarkId}:`, error);
  }

  isProcessing = false;

  // Process next in queue
  if (processingQueue.length > 0) {
    setTimeout(processNext, 100);
  }
}

async function processBookmark(bookmarkId: string): Promise<void> {
  const db = getDatabase();

  // Get bookmark
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmarkId) as {
    id: string;
    html: string | null;
    title: string;
    url: string;
  } | undefined;

  if (!bookmark) {
    console.log(`Bookmark ${bookmarkId} not found, skipping`);
    return;
  }

  // Mark as processing
  db.prepare(`
    UPDATE bookmarks SET status = 'processing', updated_at = ? WHERE id = ?
  `).run(now(), bookmarkId);

  try {
    // Extract markdown from HTML
    const markdown = await htmlToMarkdown(bookmark.html || '');

    // Update markdown
    db.prepare(`
      UPDATE bookmarks SET markdown = ?, updated_at = ? WHERE id = ?
    `).run(markdown, now(), bookmarkId);

    // Generate Q&A pairs
    const qaPairs = await generateQAPairs(bookmark.title, markdown, bookmark.url);

    if (qaPairs.length > 0) {
      // Delete existing Q&A
      db.prepare('DELETE FROM questions_answers WHERE bookmark_id = ?').run(bookmarkId);

      // Generate embeddings for all Q&A pairs
      const textsToEmbed: string[] = [];
      for (const qa of qaPairs) {
        textsToEmbed.push(qa.question);
        textsToEmbed.push(qa.answer);
        textsToEmbed.push(`${qa.question} ${qa.answer}`);
      }

      let embeddings: Float32Array[] = [];
      try {
        embeddings = await getEmbeddings(textsToEmbed);
      } catch (error) {
        console.warn(`Failed to get embeddings for bookmark ${bookmarkId}:`, error);
        // Continue without embeddings
      }

      // Insert Q&A pairs
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

        db.prepare(`
          INSERT INTO questions_answers (id, bookmark_id, question, answer, embedding_question, embedding_answer, embedding_both, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId(),
          bookmarkId,
          qa.question,
          qa.answer,
          embeddingQuestion,
          embeddingAnswer,
          embeddingBoth,
          now()
        );
      }
    }

    // Mark as complete
    db.prepare(`
      UPDATE bookmarks SET status = 'complete', error_message = NULL, updated_at = ? WHERE id = ?
    `).run(now(), bookmarkId);

    console.log(`Processed bookmark ${bookmarkId}: ${qaPairs.length} Q&A pairs generated`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE bookmarks SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?
    `).run(errorMessage, now(), bookmarkId);
    throw error;
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  // Simple HTML to markdown conversion
  // In production, use a proper library like Readability + Turndown

  let text = html;

  // Remove scripts and styles
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert common elements
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

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

async function generateQAPairs(title: string, markdown: string, url: string): Promise<QAPair[]> {
  if (!OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not configured, skipping Q&A generation');
    return [];
  }

  // Truncate content if too long
  const maxContentLength = 12000;
  const content = markdown.length > maxContentLength
    ? markdown.substring(0, maxContentLength) + '...'
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
        messages: [
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Chat API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in response');
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
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
