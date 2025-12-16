import { Bookmark, QuestionAnswer, Markdown } from '../db/schema.js';
import { createElement } from '../lib/dom.js';
import { formatTimeAgoShort } from '../lib/time.js';

export interface DetailPanelOptions {
  bookmark: Bookmark;
  markdown?: Markdown;
  qaPairs?: QuestionAnswer[];
  onClose: () => void;
  onDelete: (bookmarkId: string) => void;
  onExport: (bookmark: Bookmark) => void;
  onDebugHtml: (bookmark: Bookmark) => void;
  onTagsChange?: (bookmarkId: string, tags: string[]) => void;
}

/**
 * Create a detail panel for displaying bookmark information
 * This component is shared across Library, Search, and Stumble pages
 */
export function createDetailPanel(options: DetailPanelOptions): HTMLElement {
  const { bookmark, markdown, qaPairs = [], onClose, onDelete, onExport, onDebugHtml } = options;

  const panel = createElement('div', { className: 'detail-panel' });

  // Back button
  const backButton = createElement('button', {
    className: 'detail-panel__back-btn',
    textContent: '← Back'
  });
  backButton.addEventListener('click', onClose);
  panel.appendChild(backButton);

  // Title
  const title = createElement('h1', {
    className: 'detail-panel__title',
    textContent: bookmark.title
  });
  panel.appendChild(title);

  // Divider
  panel.appendChild(createElement('hr', { className: 'detail-panel__divider' }));

  // URL (linkable)
  const urlLink = createElement('a', {
    className: 'detail-panel__url',
    href: bookmark.url,
    textContent: bookmark.url
  });
  urlLink.setAttribute('target', '_blank');
  urlLink.setAttribute('rel', 'noopener noreferrer');
  panel.appendChild(urlLink);

  // Meta info: Time ago + Status
  const metaInfo = createElement('div', { className: 'detail-panel__meta' });

  // Format date according to REDESIGN.md rules
  const dateStr = formatDate(bookmark.createdAt);
  const timeText = `Saved ${dateStr}`;
  metaInfo.appendChild(createElement('span', {
    className: 'detail-panel__time',
    textContent: timeText
  }));

  metaInfo.appendChild(createElement('span', {
    className: 'detail-panel__meta-separator',
    textContent: '·'
  }));

  // Status indicator with symbol
  const statusSpan = createElement('span', { className: 'detail-panel__status' });
  const statusSymbol = getStatusSymbol(bookmark.status);
  const statusText = bookmark.status === 'processing' && bookmark.errorMessage?.includes('%')
    ? bookmark.errorMessage
    : bookmark.status.charAt(0).toUpperCase() + bookmark.status.slice(1);

  statusSpan.appendChild(createElement('span', {
    className: `detail-panel__status-symbol detail-panel__status-symbol--${bookmark.status}`,
    textContent: statusSymbol
  }));
  statusSpan.appendChild(createElement('span', { textContent: ` ${statusText}` }));
  metaInfo.appendChild(statusSpan);

  panel.appendChild(metaInfo);

  // Tags section (placeholder)
  const tagsSection = createElement('div', { className: 'detail-panel__tags-section' });
  const tagsLabel = createElement('div', {
    className: 'detail-panel__section-label',
    textContent: 'TAGS'
  });
  tagsSection.appendChild(tagsLabel);

  const tagsPlaceholder = createElement('div', {
    className: 'detail-panel__tags-placeholder',
    textContent: '[Tags placeholder - will be replaced by tag-editor component]'
  });
  tagsSection.appendChild(tagsPlaceholder);
  panel.appendChild(tagsSection);

  // Divider
  panel.appendChild(createElement('hr', { className: 'detail-panel__divider' }));

  // Markdown content
  if (markdown) {
    const markdownDiv = createElement('div', { className: 'detail-panel__markdown' });

    if (typeof __IS_FIREFOX__ !== 'undefined' && __IS_FIREFOX__) {
      // Use DOMParser in Firefox to avoid AMO linter innerHTML warnings
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(renderMarkdown(markdown.content), 'text/html');
      while (parsedDoc.body.firstChild) {
        markdownDiv.appendChild(parsedDoc.body.firstChild);
      }
    } else {
      // Chrome: innerHTML is fine in page context
      markdownDiv.innerHTML = renderMarkdown(markdown.content);
    }

    panel.appendChild(markdownDiv);
  } else {
    panel.appendChild(createElement('p', {
      className: 'detail-panel__no-content',
      textContent: 'Content not yet extracted.'
    }));
  }

  // Divider
  panel.appendChild(createElement('hr', { className: 'detail-panel__divider' }));

  // Q&A Pairs section (expandable)
  if (qaPairs.length > 0) {
    const qaSection = createQASection(qaPairs);
    panel.appendChild(qaSection);

    // Divider after Q&A
    panel.appendChild(createElement('hr', { className: 'detail-panel__divider' }));
  }

  // Action buttons
  const actionsDiv = createElement('div', { className: 'detail-panel__actions' });

  const debugBtn = createElement('button', {
    className: 'btn btn-secondary btn--sm',
    textContent: 'Debug HTML'
  });
  debugBtn.addEventListener('click', () => onDebugHtml(bookmark));
  actionsDiv.appendChild(debugBtn);

  const exportBtn = createElement('button', {
    className: 'btn btn-secondary btn--sm',
    textContent: 'Export'
  });
  exportBtn.addEventListener('click', () => onExport(bookmark));
  actionsDiv.appendChild(exportBtn);

  const deleteBtn = createElement('button', {
    className: 'btn btn-danger btn--sm',
    textContent: 'Delete'
  });
  deleteBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this bookmark?')) {
      onDelete(bookmark.id);
    }
  });
  actionsDiv.appendChild(deleteBtn);

  panel.appendChild(actionsDiv);

  // Processing Info section (collapsed by default)
  const processingInfo = createProcessingInfoSection(bookmark, markdown, qaPairs);
  panel.appendChild(processingInfo);

  return panel;
}

/**
 * Create the Q&A pairs section (expandable)
 */
function createQASection(qaPairs: QuestionAnswer[]): HTMLElement {
  const section = createElement('div', { className: 'detail-panel__qa-section' });

  // Header with expand/collapse
  const header = createElement('div', { className: 'detail-panel__qa-header' });
  const expandIcon = createElement('span', {
    className: 'detail-panel__expand-icon',
    textContent: '▼'
  });
  const headerText = createElement('span', {
    className: 'detail-panel__section-label',
    textContent: `Q&A PAIRS (${qaPairs.length})`
  });
  header.appendChild(expandIcon);
  header.appendChild(headerText);

  // Content container (expanded by default)
  const content = createElement('div', { className: 'detail-panel__qa-content' });

  qaPairs.forEach(qa => {
    const qaPair = createElement('div', { className: 'detail-panel__qa-pair' });

    const question = createElement('div', { className: 'detail-panel__qa-question' });
    question.appendChild(createElement('strong', { textContent: 'Q: ' }));
    question.appendChild(document.createTextNode(qa.question));
    qaPair.appendChild(question);

    const answer = createElement('div', { className: 'detail-panel__qa-answer' });
    answer.appendChild(createElement('strong', { textContent: 'A: ' }));
    answer.appendChild(document.createTextNode(qa.answer));
    qaPair.appendChild(answer);

    content.appendChild(qaPair);
  });

  // Toggle functionality
  let isExpanded = true;
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    isExpanded = !isExpanded;
    content.style.display = isExpanded ? 'block' : 'none';
    expandIcon.textContent = isExpanded ? '▼' : '▶';
  });

  section.appendChild(header);
  section.appendChild(content);

  return section;
}

/**
 * Create the Processing Info section (collapsed by default)
 */
function createProcessingInfoSection(
  bookmark: Bookmark,
  markdown?: Markdown,
  qaPairs?: QuestionAnswer[]
): HTMLElement {
  const section = createElement('div', { className: 'detail-panel__processing-info' });

  // Header with expand/collapse
  const header = createElement('div', { className: 'detail-panel__processing-header' });
  const expandIcon = createElement('span', {
    className: 'detail-panel__expand-icon',
    textContent: '▶'
  });
  const headerText = createElement('span', {
    className: 'detail-panel__section-label',
    textContent: 'Processing Info'
  });
  header.appendChild(expandIcon);
  header.appendChild(headerText);

  // Content container (collapsed by default)
  const content = createElement('div', { className: 'detail-panel__processing-content' });
  content.style.display = 'none';

  // Add processing details
  const details = createElement('div', { className: 'detail-panel__processing-details' });

  // Captured date
  const capturedDate = new Date(bookmark.createdAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  details.appendChild(createElement('div', { textContent: `Captured: ${capturedDate}` }));

  // HTML size
  const htmlSize = bookmark.html?.length || 0;
  const htmlSizeFormatted = htmlSize > 0 ? `${htmlSize.toLocaleString()} bytes` : 'N/A';
  details.appendChild(createElement('div', { textContent: `HTML: ${htmlSizeFormatted}` }));

  // Markdown size
  if (markdown) {
    const mdSize = markdown.content.length;
    details.appendChild(createElement('div', { textContent: `Markdown: ${mdSize.toLocaleString()} characters` }));
  }

  // Q&A pairs count
  const qaCount = qaPairs?.length || 0;
  details.appendChild(createElement('div', { textContent: `Q&A pairs: ${qaCount} generated` }));

  // Embeddings info (if Q&A exists)
  if (qaPairs && qaPairs.length > 0) {
    const embeddingDim = qaPairs[0].embeddingQuestion?.length || 0;
    if (embeddingDim > 0) {
      details.appendChild(createElement('div', { textContent: `Embeddings: ${embeddingDim} dimensions` }));
    }
  }

  // Status
  const statusText = bookmark.status.charAt(0).toUpperCase() + bookmark.status.slice(1);
  const statusSymbol = bookmark.status === 'complete' ? ' ✓' : '';
  details.appendChild(createElement('div', { textContent: `Status: ${statusText}${statusSymbol}` }));

  // Error message if any
  if (bookmark.errorMessage) {
    const errorDiv = createElement('div', {
      className: 'detail-panel__error',
      textContent: `Error: ${bookmark.errorMessage}`
    });
    details.appendChild(errorDiv);
  }

  content.appendChild(details);

  // Toggle functionality
  let isExpanded = false;
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    isExpanded = !isExpanded;
    content.style.display = isExpanded ? 'block' : 'none';
    expandIcon.textContent = isExpanded ? '▼' : '▶';
  });

  section.appendChild(header);
  section.appendChild(content);

  return section;
}

/**
 * Format date according to REDESIGN.md rules:
 * - < 2 weeks: Relative time (e.g., "2h ago", "3 days ago")
 * - < 12 months: Month and day (e.g., "Oct 12")
 * - >= 12 months: Full date (e.g., "2024-12-24")
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // < 2 weeks: use relative time
  if (diffDays < 14) {
    return formatTimeAgoShort(date);
  }

  // < 12 months: Month and day
  if (diffDays < 365) {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  // >= 12 months: Full date
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

/**
 * Get status symbol based on bookmark status
 */
function getStatusSymbol(status: string): string {
  switch (status) {
    case 'pending':
      return '○';
    case 'processing':
      return '◐';
    case 'complete':
      return '●';
    case 'error':
      return '✕';
    default:
      return '○';
  }
}

/**
 * Simple markdown renderer (basic implementation)
 * Based on the marked() function from explore.ts
 */
function renderMarkdown(markdown: string): string {
  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
    // Code blocks
    .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

/**
 * Inject CSS styles for the detail panel
 */
export function injectDetailPanelStyles(): void {
  const styleId = 'detail-panel-styles';

  // Check if styles already injected
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Detail Panel Styles */
    .detail-panel {
      flex: 1;
      max-width: 680px;
      padding: var(--space-6);
      background: var(--bg-secondary);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    /* Back Button */
    .detail-panel__back-btn {
      align-self: flex-start;
      padding: var(--space-2) var(--space-4);
      background: var(--btn-secondary-bg);
      border: 1px solid var(--btn-secondary-border);
      border-radius: var(--radius-md);
      font-size: var(--text-base);
      font-weight: var(--font-medium);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-base);
    }

    .detail-panel__back-btn:hover {
      background: var(--btn-secondary-hover);
    }

    /* Title */
    .detail-panel__title {
      font-size: var(--text-2xl);
      font-weight: var(--font-bold);
      color: var(--text-primary);
      margin: 0;
      line-height: var(--leading-tight);
    }

    /* Divider */
    .detail-panel__divider {
      border: none;
      border-top: 1px solid var(--border-primary);
      margin: var(--space-4) 0;
    }

    /* URL */
    .detail-panel__url {
      color: var(--accent-link);
      font-size: var(--text-base);
      word-break: break-all;
      text-decoration: none;
      transition: color var(--transition-base);
    }

    .detail-panel__url:hover {
      text-decoration: underline;
    }

    /* Meta Info */
    .detail-panel__meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-base);
      color: var(--text-secondary);
    }

    .detail-panel__time {
      color: var(--text-secondary);
    }

    .detail-panel__meta-separator {
      color: var(--text-muted);
    }

    .detail-panel__status {
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }

    /* Status Symbols */
    .detail-panel__status-symbol {
      font-size: var(--text-md);
    }

    .detail-panel__status-symbol--pending {
      color: var(--text-muted);
    }

    .detail-panel__status-symbol--processing {
      color: var(--info-text);
    }

    .detail-panel__status-symbol--complete {
      color: var(--success-text);
    }

    .detail-panel__status-symbol--error {
      color: var(--error-text);
    }

    /* Section Labels */
    .detail-panel__section-label {
      font-size: var(--text-xs);
      font-weight: var(--font-semibold);
      color: var(--text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Tags Section */
    .detail-panel__tags-section {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .detail-panel__tags-placeholder {
      padding: var(--space-3);
      background: var(--bg-tertiary);
      border: 1px dashed var(--border-primary);
      border-radius: var(--radius-md);
      color: var(--text-tertiary);
      font-size: var(--text-sm);
      font-style: italic;
    }

    /* Markdown Content */
    .detail-panel__markdown {
      font-size: var(--text-base);
      line-height: var(--leading-relaxed);
      color: var(--text-primary);
    }

    .detail-panel__markdown h1,
    .detail-panel__markdown h2,
    .detail-panel__markdown h3 {
      margin-top: var(--space-6);
      margin-bottom: var(--space-3);
      font-weight: var(--font-semibold);
      color: var(--text-primary);
    }

    .detail-panel__markdown h1 {
      font-size: var(--text-xl);
    }

    .detail-panel__markdown h2 {
      font-size: var(--text-lg);
    }

    .detail-panel__markdown h3 {
      font-size: var(--text-md);
    }

    .detail-panel__markdown p {
      margin-bottom: var(--space-4);
    }

    .detail-panel__markdown a {
      color: var(--accent-link);
      text-decoration: none;
    }

    .detail-panel__markdown a:hover {
      text-decoration: underline;
    }

    .detail-panel__markdown code {
      padding: 2px var(--space-2);
      background: var(--bg-code);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.9em;
    }

    .detail-panel__markdown pre {
      padding: var(--space-4);
      background: var(--bg-code-block);
      color: var(--text-code-block);
      border-radius: var(--radius-md);
      overflow-x: auto;
      margin: var(--space-4) 0;
    }

    .detail-panel__markdown pre code {
      padding: 0;
      background: none;
      color: inherit;
    }

    .detail-panel__no-content {
      color: var(--text-tertiary);
      font-style: italic;
    }

    /* Q&A Section */
    .detail-panel__qa-section {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .detail-panel__qa-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) 0;
    }

    .detail-panel__expand-icon {
      font-size: var(--text-sm);
      color: var(--text-tertiary);
      user-select: none;
    }

    .detail-panel__qa-content {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    .detail-panel__qa-pair {
      padding: var(--space-4);
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .detail-panel__qa-question {
      font-size: var(--text-base);
      color: var(--text-primary);
      line-height: var(--leading-normal);
    }

    .detail-panel__qa-answer {
      font-size: var(--text-base);
      color: var(--text-secondary);
      line-height: var(--leading-normal);
    }

    /* Action Buttons */
    .detail-panel__actions {
      display: flex;
      gap: var(--space-3);
      padding-top: var(--space-2);
    }

    /* Processing Info Section */
    .detail-panel__processing-info {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-top: var(--space-4);
    }

    .detail-panel__processing-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) 0;
    }

    .detail-panel__processing-content {
      padding: var(--space-4);
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
    }

    .detail-panel__processing-details {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      font-size: var(--text-sm);
      color: var(--text-secondary);
    }

    .detail-panel__error {
      color: var(--error-text);
      font-weight: var(--font-medium);
    }
  `;

  document.head.appendChild(style);
}
