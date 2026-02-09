import { db } from '../db/schema';
import { createElement, getElement } from '../ui/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWebWithAuth } from '../web/init-web';
import { createHealthIndicator } from '../ui/health-indicator';

if (__IS_WEB__) {
  void initWebWithAuth();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));

let healthCleanup: (() => void) | null = null;

window.addEventListener('beforeunload', () => {
  healthCleanup?.();
});

const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  healthCleanup = createHealthIndicator(healthIndicatorContainer);
}

async function loadStats(): Promise<void> {
  const statsGrid = getElement('statsGrid');

  try {
    const [
      totalBookmarks,
      markdownBookmarkIds,
      qaBookmarkIds,
      totalQAPairs,
      summaryBookmarkIds,
    ] = await Promise.all([
      db.bookmarks.count(),
      db.markdown.orderBy('bookmarkId').uniqueKeys(),
      db.questionsAnswers.orderBy('bookmarkId').uniqueKeys(),
      db.questionsAnswers.count(),
      db.summaries.orderBy('bookmarkId').uniqueKeys(),
    ]);

    const stats = [
      { label: 'Total Bookmarks', value: totalBookmarks },
      { label: 'With Markdown', value: markdownBookmarkIds.length },
      { label: 'With Q&A Pairs', value: qaBookmarkIds.length },
      { label: 'Total Q&A Pairs', value: totalQAPairs },
      { label: 'With Summary', value: summaryBookmarkIds.length },
    ];

    statsGrid.textContent = '';
    for (const stat of stats) {
      const card = createElement('div', { className: 'stat-card' }, [
        createElement('div', { className: 'stat-card__value', textContent: String(stat.value) }),
        createElement('div', { className: 'stat-card__label', textContent: stat.label }),
      ]);
      statsGrid.appendChild(card);
    }
  } catch (error) {
    console.error('Error loading stats:', error);
    statsGrid.textContent = '';
    statsGrid.appendChild(createElement('div', { className: 'empty', textContent: 'Error loading statistics' }));
  }
}

void loadStats();
