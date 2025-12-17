import { db, type Bookmark } from '../db/schema';
import { extractMarkdownAsync } from '../lib/extract';
import { generateQAPairs, generateEmbeddings } from '../lib/api';
import { browserFetch } from '../lib/browser-fetch';
import { extractTitleFromHtml } from '../lib/bulk-import';
import { config } from '../lib/config-registry';

async function fetchHtmlIfNeeded(bookmark: Bookmark): Promise<Bookmark> {
  if (bookmark.html && bookmark.html.length > 0) {
    return bookmark;
  }

  console.log(`[Processor] Fetching HTML for: ${bookmark.url}`);
  const html = await browserFetch(bookmark.url, config.FETCH_TIMEOUT_MS);
  const title = extractTitleFromHtml(html) || bookmark.title || bookmark.url;

  await db.bookmarks.update(bookmark.id, {
    html,
    title,
    updatedAt: new Date(),
  });

  return { ...bookmark, html, title };
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
  for (let i = 0; i < qaPairs.length; i++) {
    await db.questionsAnswers.add({
      id: crypto.randomUUID(),
      bookmarkId: bookmark.id,
      question: qaPairs[i].question,
      answer: qaPairs[i].answer,
      embeddingQuestion: questionEmbeddings[i],
      embeddingAnswer: answerEmbeddings[i],
      embeddingBoth: combinedEmbeddings[i],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  console.log(`[Processor] Completed Q&A generation for: ${bookmark.title}`);
}

export async function processBookmark(bookmark: Bookmark): Promise<void> {
  // Step 1: Fetch HTML if needed (for bulk imports)
  const bookmarkWithHtml = await fetchHtmlIfNeeded(bookmark);

  // Step 2: Generate markdown if needed
  const markdownContent = await generateMarkdownIfNeeded(bookmarkWithHtml);

  // Step 3: Generate Q&A with embeddings if needed
  await generateQAIfNeeded(bookmarkWithHtml, markdownContent);
}
