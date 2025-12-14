import { db, Bookmark } from '../db/schema';
import { extractMarkdown } from '../lib/extract';
import { generateQAPairs, generateEmbeddings } from '../lib/api';

export async function processBookmark(bookmark: Bookmark): Promise<void> {
  try {
    // Update status to 'processing'
    await db.bookmarks.update(bookmark.id, {
      status: 'processing',
      updatedAt: new Date(),
    });

    // Step 1: Extract markdown from HTML
    console.log(`Extracting markdown for: ${bookmark.title}`);
    const extracted = extractMarkdown(bookmark.html, bookmark.url);

    // Save markdown to database
    const markdownId = crypto.randomUUID();
    await db.markdown.add({
      id: markdownId,
      bookmarkId: bookmark.id,
      content: extracted.content,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Step 2: Generate Q&A pairs
    console.log(`Generating Q&A pairs for: ${bookmark.title}`);
    const qaPairs = await generateQAPairs(extracted.content);

    if (qaPairs.length === 0) {
      console.warn(`No Q&A pairs generated for: ${bookmark.title}`);
      // Mark as complete even with no Q&A pairs
      await db.bookmarks.update(bookmark.id, {
        status: 'complete',
        updatedAt: new Date(),
      });
      return;
    }

    // Step 3: Generate embeddings for Q&A pairs
    console.log(`Generating embeddings for ${qaPairs.length} Q&A pairs`);

    // Prepare texts for embedding
    const questions = qaPairs.map(qa => qa.question);
    const answers = qaPairs.map(qa => qa.answer);
    const combined = qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

    // Batch embedding generation
    const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
      generateEmbeddings(questions),
      generateEmbeddings(answers),
      generateEmbeddings(combined),
    ]);

    // Step 4: Save Q&A pairs with embeddings
    for (let i = 0; i < qaPairs.length; i++) {
      const qa = qaPairs[i];
      await db.questionsAnswers.add({
        id: crypto.randomUUID(),
        bookmarkId: bookmark.id,
        question: qa.question,
        answer: qa.answer,
        embeddingQuestion: questionEmbeddings[i],
        embeddingAnswer: answerEmbeddings[i],
        embeddingBoth: combinedEmbeddings[i],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Mark as complete
    await db.bookmarks.update(bookmark.id, {
      status: 'complete',
      updatedAt: new Date(),
    });

    console.log(`Successfully processed bookmark: ${bookmark.title}`);
  } catch (error) {
    console.error(`Error processing bookmark ${bookmark.id}:`, error);

    // Mark as error with stack trace for debugging
    await db.bookmarks.update(bookmark.id, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      updatedAt: new Date(),
    });

    throw error;
  }
}
