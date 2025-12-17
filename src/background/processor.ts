import { db, type Bookmark, JobType, JobStatus, type Job } from '../db/schema';
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

async function extractMarkdownStep(
  bookmark: Bookmark,
  job: Job
): Promise<{ content: string; characterCount: number; wordCount: number }> {
  console.log(`[Processor] Extracting markdown for: ${bookmark.title}`, {
    url: bookmark.url,
    htmlLength: bookmark.html.length,
    htmlPreview: bookmark.html.slice(0, 200),
  });

  const markdownStartTime = Date.now();
  const extracted = await extractMarkdownAsync(bookmark.html, bookmark.url);
  const extractionTimeMs = Date.now() - markdownStartTime;

  const markdownId = crypto.randomUUID();
  console.log(`[Processor] Saving markdown to database`, {
    bookmarkId: bookmark.id,
    contentLength: extracted.content.length,
    contentPreview: extracted.content.slice(0, 200),
  });
  await db.markdown.add({
    id: markdownId,
    bookmarkId: bookmark.id,
    content: extracted.content,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const wordCount = extracted.content.split(/\s+/).length;
  await completeJob(job.id, {
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

    await completeJob(job.id, {
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

async function generateEmbeddingsStep(
  bookmark: Bookmark,
  job: Job,
  qaPairs: QAPair[]
): Promise<{ questionEmbeddings: number[][]; answerEmbeddings: number[][]; combinedEmbeddings: number[][]; embeddingTimeMs: number }> {
  await updateJob(job.id, {
    currentStep: 'Generating embeddings...',
    progress: config.PROCESSOR_QA_GENERATION_PROGRESS,
  });
  debugLog(`Generating embeddings for ${qaPairs.length} Q&A pairs`);

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
        dimensions: questionEmbeddings.map(e => e.length),
        hasUndefined: false,
      },
      answerEmbeddings: {
        count: answerEmbeddings.length,
        dimensions: answerEmbeddings.map(e => e.length),
        hasUndefined: false,
      },
      combinedEmbeddings: {
        count: combinedEmbeddings.length,
        dimensions: combinedEmbeddings.map(e => e.length),
        hasUndefined: false,
      },
    });

    const allDimensions = [
      ...questionEmbeddings.map(e => e.length),
      ...answerEmbeddings.map(e => e.length),
      ...combinedEmbeddings.map(e => e.length),
    ];
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

  await updateJob(job.id, {
    currentStep: 'Saving Q&A pairs...',
    progress: config.PROCESSOR_QA_SAVING_PROGRESS,
  });

  for (let i = 0; i < qaPairs.length; i++) {
    const qa = qaPairs[i];

    debugLog(`Saving Q&A pair ${i + 1}/${qaPairs.length}`, {
      questionLength: qa.question.length,
      answerLength: qa.answer.length,
      embeddingQuestion: {
        exists: true,
        dimension: questionEmbeddings[i].length,
        isArray: Array.isArray(questionEmbeddings[i]),
      },
      embeddingAnswer: {
        exists: true,
        dimension: answerEmbeddings[i].length,
        isArray: Array.isArray(answerEmbeddings[i]),
      },
      embeddingBoth: {
        exists: true,
        dimension: combinedEmbeddings[i].length,
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
  await completeJob(job.id, {
    pairsGenerated: qaPairs.length,
  });

  await db.bookmarks.update(bookmark.id, {
    status: 'complete',
    updatedAt: new Date(),
  });

  console.log(`Successfully processed bookmark: ${bookmark.title}`);

  await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: bookmark.id, status: 'complete' });
}

/**
 * Main orchestrator function that processes a bookmark through the pipeline
 */
export async function processBookmark(bookmark: Bookmark): Promise<void> {
  let markdownJobId: string | undefined;
  let qaJobId: string | undefined;

  try {
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

    if (markdownJobId !== undefined) {
      try {
        await failJob(markdownJobId, getErrorMessage(error));
      } catch (e) {
        console.error('Failed to mark markdown job as failed:', e);
      }
    }

    if (qaJobId !== undefined) {
      try {
        await failJob(qaJobId, getErrorMessage(error));
      } catch (e) {
        console.error('Failed to mark QA job as failed:', e);
      }
    }

    await db.bookmarks.update(bookmark.id, {
      status: 'error',
      errorMessage: getErrorMessage(error),
      errorStack: getErrorStack(error),
      updatedAt: new Date(),
    });

    await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: bookmark.id, status: 'error' });

    throw error;
  }
}
