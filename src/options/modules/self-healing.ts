import { getElement, createElement } from '../../ui/dom';
import { getErrorMessage } from '../../lib/errors';
import {
  runDiagnostics,
  HEAL_FUNCTIONS,
  REGENERATE_OPTIONS_BY_ISSUE,
  type DiagnosticResult,
} from '../../lib/self-healing';
import { createJob, JobStatus, JobType } from '../../lib/jobs';
import { db } from '../../db/schema';

let activeAbortController: AbortController | null = null;
let isOperationRunning = false;

function setOperationRunning(running: boolean): void {
  isOperationRunning = running;
  const scanBtn = getElement<HTMLButtonElement>('selfHealScanBtn');
  scanBtn.disabled = running;

  document.querySelectorAll<HTMLButtonElement>('.self-heal-action-btn').forEach(btn => {
    btn.disabled = running;
  });
  document.querySelectorAll<HTMLButtonElement>('.self-heal-regen-btn').forEach(btn => {
    btn.disabled = running;
  });
  document.querySelectorAll<HTMLSelectElement>('.self-heal-regen-select').forEach(select => {
    select.disabled = running;
  });
}

function showProgress(visible: boolean): void {
  const progressContainer = getElement('selfHealProgress');
  if (visible) {
    progressContainer.classList.remove('hidden');
  } else {
    progressContainer.classList.add('hidden');
  }
}

function updateProgress(done: number, total: number, label: string): void {
  const progressBar = getElement('selfHealProgressBar');
  const progressStatus = getElement('selfHealProgressStatus');
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressStatus.textContent = `${label}: ${done}/${total}`;
}

async function runHealOperation(
  label: string,
  bookmarkIds: string[],
  fn: (ids: string[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal) => Promise<void>,
): Promise<void> {
  if (isOperationRunning) return;

  activeAbortController = new AbortController();
  setOperationRunning(true);
  showProgress(true);
  updateProgress(0, bookmarkIds.length, label);

  let jobId: string | undefined;
  try {
    const job = await createJob({
      type: JobType.SELF_HEAL,
      status: JobStatus.IN_PROGRESS,
      metadata: {
        totalUrls: bookmarkIds.length,
        successCount: 0,
      },
    });
    jobId = job.id;
  } catch {
    // Job creation is optional
  }

  try {
    await fn(
      bookmarkIds,
      (done, total) => updateProgress(done, total, label),
      activeAbortController.signal,
    );

    if (jobId !== undefined) {
      try {
        await db.jobs.update(jobId, {
          status: activeAbortController.signal.aborted ? JobStatus.CANCELLED : JobStatus.COMPLETED,
          metadata: { totalUrls: bookmarkIds.length, successCount: bookmarkIds.length },
        });
      } catch { /* best effort */ }
    }
  } catch (error) {
    console.error(`[SelfHeal] Operation failed:`, getErrorMessage(error));
    if (jobId !== undefined) {
      try {
        await db.jobs.update(jobId, {
          status: JobStatus.FAILED,
          metadata: { errorMessage: getErrorMessage(error) },
        });
      } catch { /* best effort */ }
    }
  } finally {
    activeAbortController = null;
    setOperationRunning(false);
    showProgress(false);
  }
}

const PREVIEW_LIMIT = 5;

async function buildBookmarkPreview(bookmarkIds: string[]): Promise<HTMLElement> {
  const previewIds = bookmarkIds.slice(0, PREVIEW_LIMIT);
  const bookmarks = await db.bookmarks.where('id').anyOf(previewIds).toArray();
  const bookmarkMap = new Map(bookmarks.map(b => [b.id, b]));

  const list = createElement('ul', { className: 'self-heal-preview-list' });
  for (const id of previewIds) {
    const bookmark = bookmarkMap.get(id);
    const li = createElement('li', { className: 'self-heal-preview-item' });

    const displayText = bookmark?.title !== undefined && bookmark.title !== ''
      ? bookmark.title
      : bookmark?.url ?? id;
    const link = createElement('a', {
      className: 'self-heal-preview-link',
      textContent: displayText,
    });
    link.href = `../view/view.html?id=${encodeURIComponent(id)}&from=options`;
    link.title = bookmark?.url ?? '';
    li.appendChild(link);

    list.appendChild(li);
  }

  if (bookmarkIds.length > PREVIEW_LIMIT) {
    const li = createElement('li', {
      className: 'self-heal-preview-item self-heal-preview-more',
      textContent: `\u2026and ${bookmarkIds.length - PREVIEW_LIMIT} more`,
    });
    list.appendChild(li);
  }

  return list;
}

async function renderResults(results: DiagnosticResult[]): Promise<void> {
  const container = getElement('selfHealResults');
  container.textContent = '';

  if (results.length === 0) {
    container.appendChild(
      createElement('p', { textContent: 'No issues found. All bookmarks are healthy.' })
    );
    return;
  }

  for (const result of results) {
    const card = createElement('div', { className: 'self-heal-card' });

    const header = createElement('div', { className: 'self-heal-card__header' });
    header.appendChild(createElement('strong', { textContent: `${result.label} (${result.count})` }));
    header.appendChild(createElement('p', { textContent: result.description }));
    card.appendChild(header);

    const preview = await buildBookmarkPreview(result.bookmarkIds);
    card.appendChild(preview);

    const actions = createElement('div', { className: 'self-heal-card__actions' });

    const healBtn = createElement('button', {
      className: 'btn btn-primary btn-sm self-heal-action-btn',
      textContent: 'Heal All',
    });
    healBtn.addEventListener('click', () => {
      void runHealOperation(
        result.label,
        result.bookmarkIds,
        HEAL_FUNCTIONS[result.type],
      );
    });
    actions.appendChild(healBtn);

    const selectContainer = createElement('div', {
      className: 'self-heal-regen-container',
    });

    const regenOptions = REGENERATE_OPTIONS_BY_ISSUE[result.type];
    const select = createElement('select', { className: 'self-heal-regen-select' });
    for (const opt of regenOptions) {
      const option = createElement('option', { textContent: opt.label });
      option.value = opt.label;
      select.appendChild(option);
    }
    selectContainer.appendChild(select);

    const goBtn = createElement('button', {
      className: 'btn btn-secondary btn-sm self-heal-regen-btn',
      textContent: 'Go',
    });
    goBtn.addEventListener('click', () => {
      const selectedLabel = select.value;
      const selectedOpt = regenOptions.find(o => o.label === selectedLabel);
      if (selectedOpt) {
        void runHealOperation(
          selectedOpt.label,
          result.bookmarkIds,
          selectedOpt.fn,
        );
      }
    });
    selectContainer.appendChild(goBtn);

    actions.appendChild(selectContainer);
    card.appendChild(actions);
    container.appendChild(card);
  }
}

async function handleScan(): Promise<void> {
  const scanBtn = getElement<HTMLButtonElement>('selfHealScanBtn');
  const container = getElement('selfHealResults');

  scanBtn.disabled = true;
  container.textContent = '';
  container.appendChild(createElement('p', { textContent: 'Scanning bookmarks...' }));

  try {
    const results = await runDiagnostics();
    await renderResults(results);
  } catch (error) {
    container.textContent = '';
    container.appendChild(
      createElement('p', { textContent: `Scan failed: ${getErrorMessage(error)}` })
    );
  } finally {
    scanBtn.disabled = false;
  }
}

export function initSelfHealingModule(): () => void {
  const scanBtn = getElement<HTMLButtonElement>('selfHealScanBtn');
  const cancelBtn = getElement<HTMLButtonElement>('selfHealCancelBtn');

  scanBtn.addEventListener('click', () => void handleScan());
  cancelBtn.addEventListener('click', () => {
    if (activeAbortController) {
      activeAbortController.abort();
    }
  });

  return () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  };
}
