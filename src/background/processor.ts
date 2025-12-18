import { db, type Bookmark } from '../db/schema';
import { extractMarkdownAsync } from '../lib/extract';
import { generateQAPairs, generateEmbeddings } from '../lib/api';
import { browserFetch } from '../lib/browser-fetch';
import { extractTitleFromHtml } from '../lib/bulk-import';
import { config } from '../lib/config-registry';

export async function fetchBookmarkHtml(bookmark: Bookmark): Promise<Bookmark> {
  if (bookmark.html && bookmark.html.length > 0) {
    return bookmark;
  }

  console.log(`[Processor] Fetching HTML for: ${bookmark.url}`);
  const captured = await browserFetch(bookmark.url, config.FETCH_TIMEOUT_MS);
  const title = captured.title || extractTitleFromHtml(captured.html) || bookmark.title || bookmark.url;

  await db.bookmarks.update(bookmark.id, {
    html: captured.html,
    title,
    status: 'downloaded',
    updatedAt: new Date(),
  });

  return { ...bookmark, html: captured.html, title, status: 'downloaded' };
}

async function generateMarkdownIfNeeded(bookmark: Bookmark): Promise<string> {
  const existing = await db.markdown.where('bookmarkId').equals(bookmark.id).first();
  if (existing) {
    console.log(`[Processor] Markdown already exists for: ${bookmark.title}`);
    return existing.content;
  }

  console.log(`[Processor] Extracting markdown for: ${bookmark.title}`);
  const extracted = await extractMarkdownAsync(bookmark.html, bookmark.url);

  await db.markdown.add({
    id: crypto.randomUUID(),
    bookmarkId: bookmark.id,
    content: extracted.content,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`[Processor] Saved markdown (${extracted.content.length} chars)`);
  return extracted.content;
}

async function generateQAIfNeeded(bookmark: Bookmark, markdownContent: string): Promise<void> {
  const existingQA = await db.questionsAnswers.where('bookmarkId').equals(bookmark.id).first();
  if (existingQA) {
    console.log(`[Processor] Q&A already exists for: ${bookmark.title}`);
    return;
  }

  console.log(`[Processor] Generating Q&A for: ${bookmark.title}`);
  const qaPairs = await generateQAPairs(markdownContent);

  if (qaPairs.length === 0) {
    console.log(`[Processor] No Q&A pairs generated for: ${bookmark.title}`);
    return;
  }

  console.log(`[Processor] Generating embeddings for ${qaPairs.length} Q&A pairs`);
  const questions = qaPairs.map(qa => qa.question);
  const answers = qaPairs.map(qa => qa.answer);
  const combined = qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

  const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
    generateEmbeddings(questions),
    generateEmbeddings(answers),
    generateEmbeddings(combined),
  ]);

  console.log(`[Processor] Saving ${qaPairs.length} Q&A pairs with embeddings`);
  const qaRecords = qaPairs.map((qa, i) => ({
    id: crypto.randomUUID(),
    bookmarkId: bookmark.id,
    question: qa.question,
    answer: qa.answer,
    embeddingQuestion: questionEmbeddings[i],
    embeddingAnswer: answerEmbeddings[i],
    embeddingBoth: combinedEmbeddings[i],
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.questionsAnswers.bulkAdd(qaRecords);

  console.log(`[Processor] Completed Q&A generation for: ${bookmark.title}`);
}

export async function processBookmarkContent(bookmark: Bookmark): Promise<void> {
  // Ensure we have HTML (for bookmarks that may have been fetched previously)
  let bookmarkWithHtml = bookmark;
  if (!bookmark.html || bookmark.html.length === 0) {
    bookmarkWithHtml = await fetchBookmarkHtml(bookmark);
  }

  // Generate markdown if needed
  const markdownContent = await generateMarkdownIfNeeded(bookmarkWithHtml);

  // Generate Q&A with embeddings if needed
  await generateQAIfNeeded(bookmarkWithHtml, markdownContent);
}

export async function processBookmark(bookmark: Bookmark): Promise<void> {
  await processBookmarkContent(bookmark);
}
