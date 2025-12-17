import { db, type Bookmark, JobType, JobStatus, type Job } from '../db/schema';
import { extractMarkdownAsync } from '../lib/extract';
import { generateQAPairs, generateEmbeddings, type QAPair } from '../lib/api';
import { createJob, updateJob, completeJob, failJob } from '../lib/jobs';
import { broadcastEvent } from '../lib/events';
import { config } from '../lib/config-registry';
import { getErrorMessage, getErrorStack } from '../lib/errors';
import { createDebugLog, debugOnly } from '../lib/debug';

const debugLog = createDebugLog('Processor');

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

    await db.bookmarks.update(bookmark.id, {
      status: 'complete',
      updatedAt: new Date(),
    });

    await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: bookmark.id, status: 'complete' });
  }

  return qaPairs;
}

async function generateEmbeddingsStep(
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

  debugOnly(() => {
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive runtime checks for API responses */
    debugLog('Received embeddings from API', {
      questionEmbeddings: {
        count: questionEmbeddings.length,
        dimensions: questionEmbeddings.map(e => e.length),
        hasUndefined: questionEmbeddings.some(e => e === undefined || e === null),
      },
      answerEmbeddings: {
        count: answerEmbeddings.length,
        dimensions: answerEmbeddings.map(e => e.length),
        hasUndefined: answerEmbeddings.some(e => e === undefined || e === null),
      },
      combinedEmbeddings: {
        count: combinedEmbeddings.length,
        dimensions: combinedEmbeddings.map(e => e.length),
        hasUndefined: combinedEmbeddings.some(e => e === undefined || e === null),
      },
    });
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */

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
      debugLog('Embedding dimensions are consistent:', uniqueDimensions[0]);
    }
  });

  return { questionEmbeddings, answerEmbeddings, combinedEmbeddings, embeddingTimeMs };
}

async function saveResultsStep(
  bookmark: Bookmark,
  job: Job,
  qaPairs: QAPair[],
  embeddings: { questionEmbeddings: number[][]; answerEmbeddings: number[][]; combinedEmbeddings: number[][] }
): Promise<void> {
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
        dimension: questionEmbeddings[i].length,
        isArray: Array.isArray(questionEmbeddings[i]),
      },
      embeddingAnswer: {
        dimension: answerEmbeddings[i].length,
        isArray: Array.isArray(answerEmbeddings[i]),
      },
      embeddingBoth: {
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

export async function processBookmark(bookmark: Bookmark): Promise<void> {
  let markdownJobId: string | undefined;
  let qaJobId: string | undefined;

  try {
    await db.bookmarks.update(bookmark.id, {
      status: 'processing',
      updatedAt: new Date(),
    });

    const markdownJob = await createJob({
      type: JobType.MARKDOWN_GENERATION,
      status: JobStatus.IN_PROGRESS,
      bookmarkId: bookmark.id,
    });
    markdownJobId = markdownJob.id;

    const markdownData = await extractMarkdownStep(bookmark, markdownJob);

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

    const embeddings = await generateEmbeddingsStep(qaJob, qaPairs);

    const totalApiTimeMs = Date.now() - qaStartTime;

    await updateJob(qaJobId, {
      metadata: {
        apiTimeMs: totalApiTimeMs,
        embeddingTimeMs: embeddings.embeddingTimeMs,
      },
    });

    await saveResultsStep(bookmark, qaJob, qaPairs, {
      questionEmbeddings: embeddings.questionEmbeddings,
      answerEmbeddings: embeddings.answerEmbeddings,
      combinedEmbeddings: embeddings.combinedEmbeddings,
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
