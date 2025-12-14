import { db, Bookmark, JobType, JobStatus } from '../db/schema';
import { extractMarkdown } from '../lib/extract';
import { generateQAPairs, generateEmbeddings } from '../lib/api';
import { createJob, updateJob, completeJob, failJob } from '../lib/jobs';

export async function processBookmark(bookmark: Bookmark): Promise<void> {
  let markdownJobId: string | undefined;
  let qaJobId: string | undefined;

  try {
    // Update status to 'processing'
    await db.bookmarks.update(bookmark.id, {
      status: 'processing',
      updatedAt: new Date(),
    });

    // Step 1: Extract markdown from HTML
    console.log(`Extracting markdown for: ${bookmark.title}`);

    // Create MARKDOWN_GENERATION job
    const markdownJob = await createJob({
      type: JobType.MARKDOWN_GENERATION,
      status: JobStatus.IN_PROGRESS,
      bookmarkId: bookmark.id,
    });
    markdownJobId = markdownJob.id;

    const markdownStartTime = Date.now();
    const extracted = extractMarkdown(bookmark.html, bookmark.url);
    const extractionTimeMs = Date.now() - markdownStartTime;

    // Save markdown to database
    const markdownId = crypto.randomUUID();
    await db.markdown.add({
      id: markdownId,
      bookmarkId: bookmark.id,
      content: extracted.content,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Complete markdown job
    const wordCount = extracted.content.split(/\s+/).length;
    await completeJob(markdownJobId, {
      characterCount: extracted.content.length,
      wordCount,
      extractionTimeMs,
    });

    // Step 2: Generate Q&A pairs
    console.log(`Generating Q&A pairs for: ${bookmark.title}`);

    // Create QA_GENERATION job
    const qaJob = await createJob({
      type: JobType.QA_GENERATION,
      status: JobStatus.IN_PROGRESS,
      bookmarkId: bookmark.id,
      currentStep: 'Generating questions and answers...',
    });
    qaJobId = qaJob.id;

    const qaStartTime = Date.now();
    const qaPairs = await generateQAPairs(extracted.content);

    if (qaPairs.length === 0) {
      console.warn(`No Q&A pairs generated for: ${bookmark.title}`);

      // Complete QA job with zero pairs
      await completeJob(qaJobId, {
        pairsGenerated: 0,
        apiTimeMs: Date.now() - qaStartTime,
      });

      // Mark bookmark as complete even with no Q&A pairs
      await db.bookmarks.update(bookmark.id, {
        status: 'complete',
        updatedAt: new Date(),
      });
      return;
    }

    // Step 3: Generate embeddings for Q&A pairs
    await updateJob(qaJobId, {
      currentStep: 'Generating embeddings...',
      progress: 33,
    });
    if (__DEBUG_EMBEDDINGS__) {
      console.log(`[Processor] Generating embeddings for ${qaPairs.length} Q&A pairs`);
    }

    // Prepare texts for embedding
    const questions = qaPairs.map(qa => qa.question);
    const answers = qaPairs.map(qa => qa.answer);
    const combined = qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Processor] Prepared texts for embedding', {
        questionCount: questions.length,
        answerCount: answers.length,
        combinedCount: combined.length,
        sampleQuestion: questions[0]?.slice(0, 100),
        sampleAnswer: answers[0]?.slice(0, 100),
      });
    }

    // Batch embedding generation
    const embeddingStartTime = Date.now();
    const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
      generateEmbeddings(questions),
      generateEmbeddings(answers),
      generateEmbeddings(combined),
    ]);
    const embeddingTimeMs = Date.now() - embeddingStartTime;

    // Update progress
    await updateJob(qaJobId, {
      currentStep: 'Saving Q&A pairs...',
      progress: 66,
    });

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Processor] Received embeddings from API', {
        questionEmbeddings: {
          count: questionEmbeddings.length,
          dimensions: questionEmbeddings.map(e => e?.length ?? 'undefined'),
          hasUndefined: questionEmbeddings.some(e => !e),
        },
        answerEmbeddings: {
          count: answerEmbeddings.length,
          dimensions: answerEmbeddings.map(e => e?.length ?? 'undefined'),
          hasUndefined: answerEmbeddings.some(e => !e),
        },
        combinedEmbeddings: {
          count: combinedEmbeddings.length,
          dimensions: combinedEmbeddings.map(e => e?.length ?? 'undefined'),
          hasUndefined: combinedEmbeddings.some(e => !e),
        },
      });

      // Validate embedding dimensions are consistent
      const allDimensions = [
        ...questionEmbeddings.map(e => e?.length),
        ...answerEmbeddings.map(e => e?.length),
        ...combinedEmbeddings.map(e => e?.length),
      ].filter(d => d !== undefined);
      const uniqueDimensions = [...new Set(allDimensions)];

      if (uniqueDimensions.length > 1) {
        console.error('[Processor] WARNING: Inconsistent embedding dimensions detected!', {
          uniqueDimensions,
          expected: 'All embeddings should have the same dimension',
        });
      } else {
        console.log('[Processor] Embedding dimensions are consistent:', uniqueDimensions[0]);
      }
    }

    // Step 4: Save Q&A pairs with embeddings
    for (let i = 0; i < qaPairs.length; i++) {
      const qa = qaPairs[i];

      if (__DEBUG_EMBEDDINGS__) {
        // Debug: Log each Q&A pair being saved
        console.log(`[Processor] Saving Q&A pair ${i + 1}/${qaPairs.length}`, {
          questionLength: qa.question.length,
          answerLength: qa.answer.length,
          embeddingQuestion: {
            exists: !!questionEmbeddings[i],
            dimension: questionEmbeddings[i]?.length,
            isArray: Array.isArray(questionEmbeddings[i]),
          },
          embeddingAnswer: {
            exists: !!answerEmbeddings[i],
            dimension: answerEmbeddings[i]?.length,
            isArray: Array.isArray(answerEmbeddings[i]),
          },
          embeddingBoth: {
            exists: !!combinedEmbeddings[i],
            dimension: combinedEmbeddings[i]?.length,
            isArray: Array.isArray(combinedEmbeddings[i]),
          },
        });
      }

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

    // Complete QA job
    const totalApiTimeMs = Date.now() - qaStartTime;
    await completeJob(qaJobId, {
      pairsGenerated: qaPairs.length,
      apiTimeMs: totalApiTimeMs,
      embeddingTimeMs,
    });

    // Mark as complete
    await db.bookmarks.update(bookmark.id, {
      status: 'complete',
      updatedAt: new Date(),
    });

    console.log(`Successfully processed bookmark: ${bookmark.title}`);
  } catch (error) {
    console.error(`Error processing bookmark ${bookmark.id}:`, error);

    // Mark jobs as failed if they were created
    if (markdownJobId) {
      try {
        await failJob(markdownJobId, error instanceof Error ? error : String(error));
      } catch (e) {
        console.error('Failed to mark markdown job as failed:', e);
      }
    }

    if (qaJobId) {
      try {
        await failJob(qaJobId, error instanceof Error ? error : String(error));
      } catch (e) {
        console.error('Failed to mark QA job as failed:', e);
      }
    }

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
