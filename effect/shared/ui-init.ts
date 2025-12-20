import { onThemeChange, applyTheme } from './theme';
import { initExtension } from '../../src/ui/init-extension';
import { initWeb } from '../web/init-web';
import { createHealthIndicator } from '../../src/ui/health-indicator';

export interface UIInitConfig {
  healthIndicatorContainer?: HTMLElement | null;
}

export interface UIInitCleanup {
  cleanup: () => void;
}

export async function initializeUI(config: UIInitConfig = {}): Promise<UIInitCleanup> {
  onThemeChange((theme) => applyTheme(theme));

  if (__IS_WEB__) {
    await initWeb();
  } else {
    await initExtension();
  }

  let healthCleanup: (() => void) | null = null;
  if (config.healthIndicatorContainer) {
    healthCleanup = createHealthIndicator(config.healthIndicatorContainer);
  }

  return {
    cleanup: () => {
      if (healthCleanup) {
        healthCleanup();
      }
    },
  };
}

export function setupThemeOnly(): void {
  onThemeChange((theme) => applyTheme(theme));
}

export async function initializePlatform(): Promise<void> {
  if (__IS_WEB__) {
    await initWeb();
  } else {
    await initExtension();
  }
}

export function setupHealthIndicator(container: HTMLElement): () => void {
  return createHealthIndicator(container);
}
