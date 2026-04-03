import { db, type Bookmark } from '../db/schema';
import { fetchBookmarkHtml, processBookmarkContent } from '../background/processor';
import { generateSummary, generateEmbeddings, generateQAPairs } from './api';
import { extractMarkdownAsync } from './extract';
import { getPlatformAdapter } from './platform';
import { getErrorMessage } from './errors';
import { ServerApiClient, ServerApiError } from './server-api';
import { getSettings } from './settings';
import { serverSync } from './server-sync';

export type IssueType =
  | 'duplicate_bookmarks'
  | 'no_content'
  | 'no_markdown'
  | 'short_markdown'
  | 'no_summary'
  | 'no_questions'
  | 'stale_embeddings';

export interface DiagnosticResult {
  type: IssueType;
  label: string;
  description: string;
  bookmarkIds: string[];
  count: number;
}

const SHORT_MARKDOWN_THRESHOLD = 200;

function isEmbeddingModelStale(model: string | undefined, currentModel: string): boolean {
  return model === undefined || model === '' || model !== currentModel;
}

function pushResult(
  results: DiagnosticResult[],
  type: IssueType,
  label: string,
  description: string,
  bookmarkIds: string[],
): void {
  if (bookmarkIds.length > 0) {
    results.push({ type, label, description, bookmarkIds, count: bookmarkIds.length });
  }
}

export function findDuplicateBookmarks(allBookmarks: Bookmark[]): Map<string, Bookmark[]> {
  const byUrl = new Map<string, Bookmark[]>();
  for (const bookmark of allBookmarks) {
    const group = byUrl.get(bookmark.url);
    if (group) {
      group.push(bookmark);
    } else {
      byUrl.set(bookmark.url, [bookmark]);
    }
  }

  const duplicates = new Map<string, Bookmark[]>();
  for (const [url, group] of byUrl) {
    if (group.length > 1) {
      duplicates.set(url, group);
    }
  }
  return duplicates;
}

export function pickBestBookmark(group: Bookmark[]): Bookmark {
  return group.reduce((best, current) => {
    // Prefer 'complete' status
    if (current.status === 'complete' && best.status !== 'complete') return current;
    if (best.status === 'complete' && current.status !== 'complete') return best;
    // Prefer non-error status
    if (current.status !== 'error' && best.status === 'error') return current;
    if (best.status !== 'error' && current.status === 'error') return best;
    // Prefer more content
    if (current.html.length > best.html.length) return current;
    if (best.html.length > current.html.length) return best;
    // Prefer newer
    return current.updatedAt > best.updatedAt ? current : best;
  });
}

export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  const allBookmarks = await db.bookmarks.toArray();
  const allBookmarkIds = new Set(allBookmarks.map(b => b.id));

  const [allMarkdown, allSummaries, allQA] = await Promise.all([
    db.markdown.toArray(),
    db.summaries.toArray(),
    db.questionsAnswers.toArray(),
  ]);

  const markdownByBookmark = new Map(allMarkdown.map(m => [m.bookmarkId, m]));
  const summaryBookmarkIds = new Set(allSummaries.map(s => s.bookmarkId));
  const qaBookmarkIds = new Set(allQA.map(qa => qa.bookmarkId));

  const settings = await getPlatformAdapter().getSettings();
  const currentEmbeddingModel = settings.embeddingModel;

  // Detect duplicate bookmarks by URL
  const duplicateGroups = findDuplicateBookmarks(allBookmarks);
  const duplicateIds: string[] = [];
  for (const group of duplicateGroups.values()) {
    for (const bookmark of group) {
      duplicateIds.push(bookmark.id);
    }
  }

  const noContentIds: string[] = [];
  const noMarkdownIds: string[] = [];
  const shortMarkdownIds: string[] = [];
  const noSummaryIds: string[] = [];
  const noQuestionsIds: string[] = [];

  for (const bookmark of allBookmarks) {
    if (!bookmark.html) {
      noContentIds.push(bookmark.id);
      continue;
    }

    const md = markdownByBookmark.get(bookmark.id);
    if (!md) {
      noMarkdownIds.push(bookmark.id);
      continue;
    }

    if (md.content.length < SHORT_MARKDOWN_THRESHOLD) {
      shortMarkdownIds.push(bookmark.id);
    }

    if (!summaryBookmarkIds.has(bookmark.id)) {
      noSummaryIds.push(bookmark.id);
    }

    if (!qaBookmarkIds.has(bookmark.id)) {
      noQuestionsIds.push(bookmark.id);
    }
  }

  const staleEmbeddingIds = new Set<string>();
  for (const qa of allQA) {
    if (isEmbeddingModelStale(qa.embeddingModel, currentEmbeddingModel)) {
      staleEmbeddingIds.add(qa.bookmarkId);
    }
  }
  for (const summary of allSummaries) {
    if (isEmbeddingModelStale(summary.embeddingModel, currentEmbeddingModel)) {
      staleEmbeddingIds.add(summary.bookmarkId);
    }
  }
  const staleIds = [...staleEmbeddingIds].filter(id => allBookmarkIds.has(id));

  const results: DiagnosticResult[] = [];
  pushResult(results, 'duplicate_bookmarks', 'Duplicate Bookmarks', `${duplicateGroups.size} URLs with multiple bookmark entries (e.g. from sync conflicts)`, duplicateIds);
  pushResult(results, 'no_content', 'Missing Content', 'Bookmarks with no HTML content downloaded', noContentIds);
  pushResult(results, 'no_markdown', 'Missing Markdown', 'Bookmarks with HTML but no extracted markdown', noMarkdownIds);
  pushResult(results, 'short_markdown', 'Short Markdown', `Bookmarks with markdown shorter than ${SHORT_MARKDOWN_THRESHOLD} characters`, shortMarkdownIds);
  pushResult(results, 'no_summary', 'Missing Summary', 'Bookmarks with markdown but no AI-generated summary', noSummaryIds);
  pushResult(results, 'no_questions', 'Missing Questions', 'Bookmarks with markdown but no AI-generated Q&A pairs', noQuestionsIds);
  pushResult(results, 'stale_embeddings', 'Stale Embeddings', 'Bookmarks with embeddings from a different model than currently configured', staleIds);

  return results;
}

// Heal functions: fill in ONLY what's missing

async function deleteBookmarkFromServer(loserIds: string[]): Promise<void> {
  const settings = await getSettings();
  if (!settings.serverEnabled || !settings.serverUrl || !settings.serverSessionToken) return;

  let client: ServerApiClient | undefined;
  try {
    client = new ServerApiClient(settings.serverUrl, settings.serverSessionToken);
  } catch {
    return;
  }

  for (const loserId of loserIds) {
    try {
      await client.deleteBookmark(loserId);
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound()) {
        // Bookmark never existed on server — nothing to do
        continue;
      }
      // Network or other error — queue for later
      await serverSync.queueOfflineChange({
        type: 'delete',
        bookmarkId: loserId,
        timestamp: Date.now(),
      });
    }
  }
}

export async function healDuplicateBookmarks(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const bookmarks = await db.bookmarks.where('id').anyOf(bookmarkIds).toArray();
  const duplicateGroups = findDuplicateBookmarks(bookmarks);

  const groups = [...duplicateGroups.values()];
  const total = groups.length;
  let done = 0;

  for (const group of groups) {
    if (signal?.aborted === true) return;

    try {
      const keeper = pickBestBookmark(group);
      const losers = group.filter(b => b.id !== keeper.id);
      const loserIds = losers.map(b => b.id);

      await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers, db.summaries, db.bookmarkTags], async () => {
        // Migrate tags from losers to keeper (skip duplicates via compound key)
        for (const loserId of loserIds) {
          const tags = await db.bookmarkTags.where('bookmarkId').equals(loserId).toArray();
          for (const tag of tags) {
            const exists = await db.bookmarkTags.get([keeper.id, tag.tagName]);
            if (!exists) {
              await db.bookmarkTags.put({ bookmarkId: keeper.id, tagName: tag.tagName, addedAt: tag.addedAt });
            }
          }
        }

        // Delete loser bookmarks and all their related records
        for (const loserId of loserIds) {
          await db.markdown.where('bookmarkId').equals(loserId).delete();
          await db.questionsAnswers.where('bookmarkId').equals(loserId).delete();
          await db.summaries.where('bookmarkId').equals(loserId).delete();
          await db.bookmarkTags.where('bookmarkId').equals(loserId).delete();
          await db.bookmarks.delete(loserId);
        }
      });

      // Best-effort server cleanup: delete losers, queue on failure
      await deleteBookmarkFromServer(loserIds);
    } catch (error) {
      console.error(`[SelfHeal] Failed to deduplicate group:`, getErrorMessage(error));
    }

    done++;
    onProgress?.(done, total);
  }
}

export async function healNoContent(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;

    try {
      const bookmark = await db.bookmarks.get(bookmarkIds[i]);
      if (bookmark) {
        const updated = await fetchBookmarkHtml(bookmark);
        await processBookmarkContent(updated);
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to heal content for ${bookmarkIds[i]}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function healNoMarkdown(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;

    try {
      const bookmark = await db.bookmarks.get(bookmarkIds[i]);
      if (bookmark !== undefined && bookmark.html !== '') {
        const existingMd = await db.markdown.where('bookmarkId').equals(bookmark.id).first();
        if (!existingMd) {
          const extracted = await extractMarkdownAsync(bookmark.html, bookmark.url);
          await db.markdown.add({
            id: crypto.randomUUID(),
            bookmarkId: bookmark.id,
            content: extracted.content,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          await generateDownstream(bookmark, extracted.content);
        }
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to heal markdown for ${bookmarkIds[i]}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function healShortMarkdown(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;

    try {
      const bookmark = await db.bookmarks.get(bookmarkIds[i]);
      if (bookmark) {
        const updated = await fetchBookmarkHtml({ ...bookmark, html: '' });
        await db.markdown.where('bookmarkId').equals(bookmark.id).delete();
        const extracted = await extractMarkdownAsync(updated.html, updated.url);
        await db.markdown.add({
          id: crypto.randomUUID(),
          bookmarkId: bookmark.id,
          content: extracted.content,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await db.summaries.where('bookmarkId').equals(bookmark.id).delete();
        await db.questionsAnswers.where('bookmarkId').equals(bookmark.id).delete();
        await generateDownstream(bookmark, extracted.content);
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to heal short markdown for ${bookmarkIds[i]}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function healNoSummary(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;
    const bookmarkId = bookmarkIds[i];

    try {
      const existing = await db.summaries.where('bookmarkId').equals(bookmarkId).first();
      if (!existing) {
        const md = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
        if (md) {
          const summary = await generateSummary(md.content);
          const settings = await getPlatformAdapter().getSettings();
          const [embedding] = await generateEmbeddings([summary]);

          await db.summaries.add({
            id: crypto.randomUUID(),
            bookmarkId,
            content: summary,
            embedding,
            embeddingModel: settings.embeddingModel,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to heal summary for ${bookmarkId}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function healNoQuestions(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;
    const bookmarkId = bookmarkIds[i];

    try {
      const existingQA = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).first();
      if (!existingQA) {
        const md = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
        if (md) {
          const qaPairs = await generateQAPairs(md.content);
          if (qaPairs.length > 0) {
            const questions = qaPairs.map(qa => qa.question);
            const answers = qaPairs.map(qa => qa.answer);
            const combined = qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

            const settings = await getPlatformAdapter().getSettings();
            const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
              generateEmbeddings(questions),
              generateEmbeddings(answers),
              generateEmbeddings(combined),
            ]);

            const qaRecords = qaPairs.map((qa, idx) => ({
              id: crypto.randomUUID(),
              bookmarkId,
              question: qa.question,
              answer: qa.answer,
              embeddingQuestion: questionEmbeddings[idx],
              embeddingAnswer: answerEmbeddings[idx],
              embeddingBoth: combinedEmbeddings[idx],
              embeddingModel: settings.embeddingModel,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));
            await db.questionsAnswers.bulkAdd(qaRecords);
          }
        }
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to heal questions for ${bookmarkId}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function healStaleEmbeddings(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  const settings = await getPlatformAdapter().getSettings();

  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;
    const bookmarkId = bookmarkIds[i];

    try {
      const qaRecords = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();
      if (qaRecords.length > 0) {
        const questions = qaRecords.map(qa => qa.question);
        const answers = qaRecords.map(qa => qa.answer);
        const combined = qaRecords.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

        const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
          generateEmbeddings(questions),
          generateEmbeddings(answers),
          generateEmbeddings(combined),
        ]);

        await db.transaction('rw', db.questionsAnswers, async () => {
          for (let j = 0; j < qaRecords.length; j++) {
            await db.questionsAnswers.update(qaRecords[j].id, {
              embeddingQuestion: questionEmbeddings[j],
              embeddingAnswer: answerEmbeddings[j],
              embeddingBoth: combinedEmbeddings[j],
              embeddingModel: settings.embeddingModel,
              updatedAt: new Date(),
            });
          }
        });
      }

      const summaryRecord = await db.summaries.where('bookmarkId').equals(bookmarkId).first();
      if (summaryRecord) {
        const [embedding] = await generateEmbeddings([summaryRecord.content]);
        await db.summaries.update(summaryRecord.id, {
          embedding,
          embeddingModel: settings.embeddingModel,
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to heal stale embeddings for ${bookmarkId}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

// Upstream regeneration: destructive operations

export async function regenerateFromContent(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;
    const bookmarkId = bookmarkIds[i];

    try {
      await db.bookmarks.update(bookmarkId, { html: '', updatedAt: new Date() });
      await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
      await db.summaries.where('bookmarkId').equals(bookmarkId).delete();
      await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();

      const bookmark = await db.bookmarks.get(bookmarkId);
      if (bookmark) {
        const updated = await fetchBookmarkHtml(bookmark);
        await processBookmarkContent(updated);
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to regenerate from content for ${bookmarkId}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function regenerateFromMarkdown(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;
    const bookmarkId = bookmarkIds[i];

    try {
      await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
      await db.summaries.where('bookmarkId').equals(bookmarkId).delete();
      await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();

      const bookmark = await db.bookmarks.get(bookmarkId);
      if (bookmark !== undefined && bookmark.html !== '') {
        await processBookmarkContent(bookmark);
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to regenerate from markdown for ${bookmarkId}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function regenerateFromSummary(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;
    const bookmarkId = bookmarkIds[i];

    try {
      await db.summaries.where('bookmarkId').equals(bookmarkId).delete();

      const md = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
      if (md) {
        const summary = await generateSummary(md.content);
        const settings = await getPlatformAdapter().getSettings();
        const [embedding] = await generateEmbeddings([summary]);

        await db.summaries.add({
          id: crypto.randomUUID(),
          bookmarkId,
          content: summary,
          embedding,
          embeddingModel: settings.embeddingModel,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to regenerate summary for ${bookmarkId}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function regenerateFromQuestions(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = bookmarkIds.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted === true) return;
    const bookmarkId = bookmarkIds[i];

    try {
      await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();

      const md = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
      if (md) {
        const qaPairs = await generateQAPairs(md.content);
        if (qaPairs.length > 0) {
          const questions = qaPairs.map(qa => qa.question);
          const answers = qaPairs.map(qa => qa.answer);
          const combined = qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

          const settings = await getPlatformAdapter().getSettings();
          const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
            generateEmbeddings(questions),
            generateEmbeddings(answers),
            generateEmbeddings(combined),
          ]);

          const qaRecords = qaPairs.map((qa, idx) => ({
            id: crypto.randomUUID(),
            bookmarkId,
            question: qa.question,
            answer: qa.answer,
            embeddingQuestion: questionEmbeddings[idx],
            embeddingAnswer: answerEmbeddings[idx],
            embeddingBoth: combinedEmbeddings[idx],
            embeddingModel: settings.embeddingModel,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));
          await db.questionsAnswers.bulkAdd(qaRecords);
        }
      }
    } catch (error) {
      console.error(`[SelfHeal] Failed to regenerate questions for ${bookmarkId}:`, getErrorMessage(error));
    }

    onProgress?.(i + 1, total);
  }
}

export async function regenerateEmbeddings(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return healStaleEmbeddings(bookmarkIds, onProgress, signal);
}

// Shared helper

async function generateDownstream(bookmark: Bookmark, markdownContent: string): Promise<void> {
  const settings = await getPlatformAdapter().getSettings();

  const summaryExists = await db.summaries.where('bookmarkId').equals(bookmark.id).first();
  const qaExists = await db.questionsAnswers.where('bookmarkId').equals(bookmark.id).first();

  const tasks: Promise<void>[] = [];

  if (!summaryExists) {
    tasks.push((async () => {
      const summary = await generateSummary(markdownContent);
      const [embedding] = await generateEmbeddings([summary]);
      await db.summaries.add({
        id: crypto.randomUUID(),
        bookmarkId: bookmark.id,
        content: summary,
        embedding,
        embeddingModel: settings.embeddingModel,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    })());
  }

  if (!qaExists) {
    tasks.push((async () => {
      const qaPairs = await generateQAPairs(markdownContent);
      if (qaPairs.length === 0) return;

      const questions = qaPairs.map(qa => qa.question);
      const answers = qaPairs.map(qa => qa.answer);
      const combined = qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`);

      const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = await Promise.all([
        generateEmbeddings(questions),
        generateEmbeddings(answers),
        generateEmbeddings(combined),
      ]);

      const qaRecords = qaPairs.map((qa, idx) => ({
        id: crypto.randomUUID(),
        bookmarkId: bookmark.id,
        question: qa.question,
        answer: qa.answer,
        embeddingQuestion: questionEmbeddings[idx],
        embeddingAnswer: answerEmbeddings[idx],
        embeddingBoth: combinedEmbeddings[idx],
        embeddingModel: settings.embeddingModel,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await db.questionsAnswers.bulkAdd(qaRecords);
    })());
  }

  await Promise.all(tasks);
}

export type HealFunction = typeof healNoContent;

export const HEAL_FUNCTIONS: Record<IssueType, HealFunction> = {
  duplicate_bookmarks: healDuplicateBookmarks,
  no_content: healNoContent,
  no_markdown: healNoMarkdown,
  short_markdown: healShortMarkdown,
  no_summary: healNoSummary,
  no_questions: healNoQuestions,
  stale_embeddings: healStaleEmbeddings,
};

export interface RegenerateOption {
  label: string;
  fn: (bookmarkIds: string[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal) => Promise<void>;
}

export const REGENERATE_OPTIONS_BY_ISSUE: Record<IssueType, RegenerateOption[]> = {
  duplicate_bookmarks: [],
  no_content: [
    { label: 'Regenerate Content', fn: regenerateFromContent },
  ],
  no_markdown: [
    { label: 'Regenerate Markdown', fn: regenerateFromMarkdown },
    { label: 'Regenerate Content', fn: regenerateFromContent },
  ],
  short_markdown: [
    { label: 'Regenerate Markdown', fn: regenerateFromMarkdown },
    { label: 'Regenerate Content', fn: regenerateFromContent },
  ],
  no_summary: [
    { label: 'Regenerate Summary', fn: regenerateFromSummary },
    { label: 'Regenerate Markdown', fn: regenerateFromMarkdown },
  ],
  no_questions: [
    { label: 'Regenerate Questions', fn: regenerateFromQuestions },
    { label: 'Regenerate Markdown', fn: regenerateFromMarkdown },
  ],
  stale_embeddings: [
    { label: 'Regenerate Embeddings', fn: regenerateEmbeddings },
  ],
};
