/**
 * Shared Header Navigation Component
 *
 * Creates a unified header navigation for all pages (Library, Search, Stumble, Settings)
 * following the redesign specifications from REDESIGN.md.
 */

import { createElement } from '../lib/dom.js';

export interface HeaderNavOptions {
  activePage: 'library' | 'search' | 'stumble' | 'settings';
  onHealthClick?: () => void;
}

/**
 * Create the header navigation component
 *
 * Layout:
 * - Left: Navigation tabs (Library, Search, Stumble, Settings)
 * - Right: Health indicator (optional) + Brand text
 * - Height: 56px, Padding: 16px (var(--space-4))
 * - Active tab indicated with underline
 */
export function createHeaderNav(options: HeaderNavOptions): HTMLElement {
  const { activePage, onHealthClick } = options;

  // Create header container
  const header = createElement('header', {
    className: 'header-nav',
    style: {
      height: '56px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0 var(--space-4)',
      background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-primary)',
      flexShrink: '0'
    }
  });

  // Navigation tabs (left side)
  const nav = createNavTabs(activePage);

  // Right side container (health indicator + brand)
  const rightSide = createRightSide(onHealthClick);

  header.appendChild(nav);
  header.appendChild(rightSide);

  return header;
}

/**
 * Create navigation tabs for the left side
 */
function createNavTabs(activePage: string): HTMLElement {
  const nav = createElement('nav', {
    className: 'header-nav__tabs',
    style: {
      display: 'flex',
      gap: 'var(--space-1)',
      alignItems: 'center'
    }
  });

  const tabs = [
    { id: 'library', label: 'Library', url: 'src/library/library.html' },
    { id: 'search', label: 'Search', url: 'src/search/search.html' },
    { id: 'stumble', label: 'Stumble', url: 'src/stumble/stumble.html' },
    { id: 'settings', label: 'Settings', url: 'src/options/options.html' }
  ];

  tabs.forEach(tab => {
    const isActive = tab.id === activePage;
    const tabLink = createNavTab(tab.label, tab.url, isActive);
    nav.appendChild(tabLink);
  });

  return nav;
}

/**
 * Create a single navigation tab
 */
function createNavTab(label: string, relativeUrl: string, isActive: boolean): HTMLElement {
  const tabContainer = createElement('div', {
    className: 'header-nav__tab-wrapper',
    style: {
      position: 'relative'
    }
  });

  const tabLink = createElement('a', {
    href: chrome.runtime.getURL(relativeUrl),
    className: `header-nav__tab ${isActive ? 'active' : ''}`,
    textContent: label,
    style: {
      display: 'inline-block',
      padding: 'var(--space-3) var(--space-4)',
      fontSize: 'var(--text-base)',
      fontWeight: 'var(--font-medium)',
      color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
      textDecoration: 'none',
      transition: 'color var(--transition-base)',
      cursor: 'pointer',
      position: 'relative'
    }
  });

  // Add hover effect
  tabLink.addEventListener('mouseenter', () => {
    if (!isActive) {
      tabLink.style.color = 'var(--text-secondary)';
    }
  });

  tabLink.addEventListener('mouseleave', () => {
    if (!isActive) {
      tabLink.style.color = 'var(--text-tertiary)';
    }
  });

  tabContainer.appendChild(tabLink);

  // Add active underline
  if (isActive) {
    const underline = createElement('div', {
      className: 'header-nav__tab-underline',
      style: {
        position: 'absolute',
        bottom: '0',
        left: 'var(--space-4)',
        right: 'var(--space-4)',
        height: '2px',
        background: 'var(--accent-primary)',
        borderRadius: '2px 2px 0 0'
      }
    });
    tabContainer.appendChild(underline);
  }

  return tabContainer;
}

/**
 * Create the right side (health indicator + brand)
 */
function createRightSide(onHealthClick?: () => void): HTMLElement {
  const rightContainer = createElement('div', {
    className: 'header-nav__right',
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)'
    }
  });

  // Health indicator (placeholder for now)
  if (onHealthClick) {
    const healthIndicator = createHealthIndicator(onHealthClick);
    rightContainer.appendChild(healthIndicator);
  }

  // Brand text
  const brand = createElement('div', {
    className: 'header-nav__brand',
    textContent: 'Bookmarks by Localforge',
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      fontWeight: 'var(--font-medium)',
      whiteSpace: 'nowrap'
    }
  });

  rightContainer.appendChild(brand);

  return rightContainer;
}

/**
 * Create health indicator button
 *
 * Health States (future implementation):
 * - ● Green: All systems healthy, no pending jobs
 * - ◐ Blue pulse: Processing in progress
 * - ○ Gray: Idle, nothing processing
 * - ✕ Red: Errors need attention
 */
function createHealthIndicator(onClick: () => void): HTMLElement {
  const indicator = createElement('button', {
    className: 'header-nav__health',
    textContent: '○',
    title: 'System Health',
    style: {
      border: 'none',
      background: 'transparent',
      fontSize: 'var(--text-md)',
      color: 'var(--text-tertiary)',
      cursor: 'pointer',
      padding: 'var(--space-2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-md)',
      transition: 'all var(--transition-base)'
    }
  });

  // Add hover effect
  indicator.addEventListener('mouseenter', () => {
    indicator.style.background = 'var(--bg-hover)';
  });

  indicator.addEventListener('mouseleave', () => {
    indicator.style.background = 'transparent';
  });

  indicator.addEventListener('click', onClick);

  return indicator;
}

/**
 * Helper to inject header nav styles
 * Call this once in your page initialization
 */
export function injectHeaderNavStyles(): void {
  const styleId = 'header-nav-styles';

  // Don't inject twice
  if (document.getElementById(styleId)) {
    return;
  }

  const style = createElement('style', {
    attributes: { id: styleId }
  });

  style.textContent = `
    /* Header Navigation Styles */
    .header-nav {
      box-sizing: border-box;
    }

    .header-nav *,
    .header-nav *::before,
    .header-nav *::after {
      box-sizing: border-box;
    }

    /* Tab wrapper for positioning underline */
    .header-nav__tab-wrapper {
      display: inline-block;
    }

    /* Focus states for accessibility */
    .header-nav__tab:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }

    .header-nav__health:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    /* Responsive adjustments */
    @media (max-width: 600px) {
      .header-nav__brand {
        display: none;
      }

      .header-nav__tab {
        padding: var(--space-2) var(--space-3) !important;
        font-size: var(--text-sm) !important;
      }
    }
  `;

  document.head.appendChild(style);
}
