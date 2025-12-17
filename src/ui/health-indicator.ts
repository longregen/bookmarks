import { config } from '../lib/config-registry';
import { openExtensionPage } from '../lib/tabs';
import { getHealthStatus, type HealthState } from '../lib/health-status';

function getHealthIndicatorStyle(state: HealthState): { symbol: string; color: string; className: string } {
  switch (state) {
    case 'healthy':
      return { symbol: '●', color: '#22c55e', className: 'healthy' };
    case 'processing':
      return { symbol: '◐', color: '#3b82f6', className: 'processing' };
    case 'idle':
      return { symbol: '○', color: '#9ca3af', className: 'idle' };
    case 'error':
      return { symbol: '✕', color: '#ef4444', className: 'error' };
  }
}

export function createHealthIndicator(container: HTMLElement): () => void {
  const indicator = document.createElement('div');
  indicator.className = 'health-indicator';

  const dot = document.createElement('span');
  dot.className = 'health-indicator-dot';

  indicator.appendChild(dot);
  container.appendChild(indicator);

  const tooltip = document.createElement('div');
  tooltip.className = 'health-indicator-tooltip';
  container.style.position = 'relative';
  container.appendChild(tooltip);

  indicator.addEventListener('mouseenter', () => {
    tooltip.style.opacity = '1';
  });

  indicator.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });

  let currentHealthState: HealthState = 'idle';

  indicator.addEventListener('click', () => {
    if (currentHealthState === 'error') {
      void openExtensionPage('src/jobs/jobs.html?status=failed');
    } else {
      void openExtensionPage('src/jobs/jobs.html');
    }
  });

  async function updateIndicator(): Promise<void> {
    const health = await getHealthStatus();
    const style = getHealthIndicatorStyle(health.state);

    currentHealthState = health.state;

    dot.textContent = style.symbol;
    dot.style.color = style.color;

    indicator.className = `health-indicator ${style.className}`;

    indicator.style.cursor = 'pointer';

    tooltip.textContent = health.message;
  }

  void updateIndicator();

  const intervalId = setInterval(updateIndicator, config.HEALTH_REFRESH_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    container.removeChild(indicator);
    container.removeChild(tooltip);
  };
}
