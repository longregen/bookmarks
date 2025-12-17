import { db, Bookmark, JobType, JobStatus, Job } from '../db/schema';
import { extractMarkdownAsync } from '../lib/extract';
import { generateQAPairs, generateEmbeddings } from '../lib/api';
import { createJob, updateJob, completeJob, failJob } from '../lib/jobs';
import { broadcastEvent } from '../lib/events';
import { config } from '../lib/config-registry';
import { getErrorMessage, getErrorStack } from '../lib/errors';

interface QAPair {
  question: string;
  answer: string;
}

// Debug logger that compiles away when __DEBUG_EMBEDDINGS__ is false
const debugLog = __DEBUG_EMBEDDINGS__
  ? (msg: string, data?: unknown) => console.log(`[Processor] ${msg}`, data)
  : (_msg: string, _data?: unknown) => {};

/**
 * Step 1: Extract markdown from HTML and save to database
 */
async function extractMarkdownStep(
  bookmark: Bookmark,
  job: Job
): Promise<{ content: string; characterCount: number; wordCount: number }> {
  console.log(`[Processor] Extracting markdown for: ${bookmark.title}`, {
    url: bookmark.url,
    htmlLength: bookmark.html?.length ?? 0,
    htmlPreview: bookmark.html?.slice(0, 200) ?? '',
  });

  const markdownStartTime = Date.now();
  const extracted = await extractMarkdownAsync(bookmark.html, bookmark.url);
  const extractionTimeMs = Date.now() - markdownStartTime;

  // Save markdown to database
  const markdownId = crypto.randomUUID();
  console.log(`[Processor] Saving markdown to database`, {
    bookmarkId: bookmark.id,
    contentLength: extracted.content?.length ?? 0,
    contentPreview: extracted.content?.slice(0, 200) ?? '',
  });
  await db.markdown.add({
    id: markdownId,
    bookmarkId: bookmark.id,
    content: extracted.content,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Complete markdown job
  const wordCount = extracted.content.split(/\s+/).length;
  await completeJob(job.id!, {
    characterCount: extracted.content.length,
    wordCount,
    extractionTimeMs,
  });

  return {
    content: extracted.content,
    characterCount: extracted.content.length,
    wordCount,
  };
}

/**
 * Step 2: Generate Q&A pairs from markdown content
 */
async function generateQAPairsStep(
  bookmark: Bookmark,
  job: Job,
  markdownContent: string
): Promise<QAPair[]> {
  console.log(`Generating Q&A pairs for: ${bookmark.title}`);

  const qaStartTime = Date.now();
  const qaPairs = await generateQAPairs(markdownContent);

  if (qaPairs.length === 0) {
    console.warn(`No Q&A pairs generated for: ${bookmark.title}`);

    // Complete QA job with zero pairs
    await completeJob(job.id!, {
      pairsGenerated: 0,
      apiTimeMs: Date.now() - qaStartTime,
    });

    // Mark bookmark as complete even with no Q&A pairs
    await db.bookmarks.update(bookmark.id, {
      status: 'complete',
      updatedAt: new Date(),
    });
  }

  return qaPairs;
}

/**
 * Step 3: Generate embeddings for Q&A pairs
 */
async function generateEmbeddingsStep(
  bookmark: Bookmark,
  job: Job,
  qaPairs: QAPair[]
): Promise<{ questionEmbeddings: number[][]; answerEmbeddings: number[][]; combinedEmbeddings: number[][]; embeddingTimeMs: number }> {
  await updateJob(job.id!, {
    currentStep: 'Generating embeddings...',
    progress: config.PROCESSOR_QA_GENERATION_PROGRESS,
  });
  debugLog(`Generating embeddings for ${qaPairs.length} Q&A pairs`);

  // Prepare texts for embedding
  const questions = qaPairs.map(qa => qa.question);
  const answers = qaPairs.map(qa => qa.answer);
  const combined = qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

  debugLog('Prepared texts for embedding', {
    questionCount: questions.length,
    answerCount: answers.length,
    combinedCount: combined.length,
    sampleQuestion: questions[0]?.slice(0, 100),
    sampleAnswer: answers[0]?.slice(0, 100),
  });

  // Batch embedding generation
  const embeddingStartTime = Date.now();
  const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
    generateEmbeddings(questions),
    generateEmbeddings(answers),
    generateEmbeddings(combined),
  ]);
  const embeddingTimeMs = Date.now() - embeddingStartTime;

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

  return { questionEmbeddings, answerEmbeddings, combinedEmbeddings, embeddingTimeMs };
}

/**
 * Step 4: Save Q&A pairs with embeddings to database
 */
async function saveResultsStep(
  bookmark: Bookmark,
  job: Job,
  data: {
    markdown: { content: string; characterCount: number; wordCount: number };
    qaPairs: QAPair[];
    embeddings: { questionEmbeddings: number[][]; answerEmbeddings: number[][]; combinedEmbeddings: number[][] };
  }
): Promise<void> {
  const { qaPairs, embeddings } = data;
  const { questionEmbeddings, answerEmbeddings, combinedEmbeddings } = embeddings;

  await updateJob(job.id!, {
    currentStep: 'Saving Q&A pairs...',
    progress: config.PROCESSOR_QA_SAVING_PROGRESS,
  });

  // Save Q&A pairs with embeddings
  for (let i = 0; i < qaPairs.length; i++) {
    const qa = qaPairs[i];

    debugLog(`Saving Q&A pair ${i + 1}/${qaPairs.length}`, {
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

  // Complete QA job (job timing is managed by the caller)
  await completeJob(job.id!, {
    pairsGenerated: qaPairs.length,
  });

  // Mark bookmark as complete
  await db.bookmarks.update(bookmark.id, {
    status: 'complete',
    updatedAt: new Date(),
  });

  console.log(`Successfully processed bookmark: ${bookmark.title}`);

  // Broadcast event that bookmark processing is complete
  await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: bookmark.id, status: 'complete' });
}

/**
 * Main orchestrator function that processes a bookmark through the pipeline
 */
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
    const markdownJob = await createJob({
      type: JobType.MARKDOWN_GENERATION,
      status: JobStatus.IN_PROGRESS,
      bookmarkId: bookmark.id,
    });
    markdownJobId = markdownJob.id;

    const markdownData = await extractMarkdownStep(bookmark, markdownJob);

    // Step 2: Generate Q&A pairs
    const qaJob = await createJob({
      type: JobType.QA_GENERATION,
      status: JobStatus.IN_PROGRESS,
      bookmarkId: bookmark.id,
      currentStep: 'Generating questions and answers...',
    });
    qaJobId = qaJob.id;

    const qaStartTime = Date.now();
    const qaPairs = await generateQAPairsStep(bookmark, qaJob, markdownData.content);

    // Early return if no Q&A pairs were generated
    if (qaPairs.length === 0) {
      return;
    }

    // Step 3: Generate embeddings for Q&A pairs
    const embeddings = await generateEmbeddingsStep(bookmark, qaJob, qaPairs);

    // Step 4: Save results to database
    const totalApiTimeMs = Date.now() - qaStartTime;

    // Update job metadata with timing information before saving
    await updateJob(qaJobId, {
      metadata: {
        apiTimeMs: totalApiTimeMs,
        embeddingTimeMs: embeddings.embeddingTimeMs,
      },
    });

    await saveResultsStep(bookmark, qaJob, {
      markdown: markdownData,
      qaPairs,
      embeddings: {
        questionEmbeddings: embeddings.questionEmbeddings,
        answerEmbeddings: embeddings.answerEmbeddings,
        combinedEmbeddings: embeddings.combinedEmbeddings,
      },
    });
  } catch (error) {
    console.error(`Error processing bookmark ${bookmark.id}:`, error);

    // Mark jobs as failed if they were created
    if (markdownJobId) {
      try {
        await failJob(markdownJobId, getErrorMessage(error));
      } catch (e) {
        console.error('Failed to mark markdown job as failed:', e);
      }
    }

    if (qaJobId) {
      try {
        await failJob(qaJobId, getErrorMessage(error));
      } catch (e) {
        console.error('Failed to mark QA job as failed:', e);
      }
    }

    // Mark as error with stack trace for debugging
    await db.bookmarks.update(bookmark.id, {
      status: 'error',
      errorMessage: getErrorMessage(error),
      errorStack: getErrorStack(error),
      updatedAt: new Date(),
    });

    // Broadcast event that bookmark has an error
    await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: bookmark.id, status: 'error' });

    throw error;
  }
}
