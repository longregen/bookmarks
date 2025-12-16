import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { initializeSettingsPanel } from './modules/settings-panel';
import { initializeWebDAVPanel } from './modules/webdav-panel';
import { initializeImportExportPanel } from './modules/import-export-panel';
import { initializeJobsPanel } from './modules/jobs-panel';
import { initializeThemePanel } from './modules/theme-panel';

// Initialize extension and theme
initExtension();
onThemeChange((theme) => applyTheme(theme));

// Initialize navigation
initializeNavigation();

// Initialize all panels
initializeThemePanel();
initializeSettingsPanel();
initializeWebDAVPanel();
initializeImportExportPanel();
initializeJobsPanel();

/**
 * Setup sidebar navigation and scroll tracking
 */
function initializeNavigation() {
  const navItems = document.querySelectorAll<HTMLAnchorElement>('.nav-item');
  const sections = document.querySelectorAll<HTMLElement>('.settings-section');

  function setActiveNavItem(sectionId: string) {
    navItems.forEach(item => {
      if (item.dataset.section === sectionId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  // Handle nav item clicks
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = item.dataset.section;
      if (sectionId) {
        setActiveNavItem(sectionId);
        const section = document.getElementById(sectionId);
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  // Track scroll position to update active nav item
  function setupScrollObserver() {
    const scrollContainer = document.querySelector('.app-layout__content');
    const observerOptions: IntersectionObserverInit = {
      root: scrollContainer,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.id;
          setActiveNavItem(sectionId);
        }
      });
    }, observerOptions);

    sections.forEach(section => {
      observer.observe(section);
    });
  }

  // Only setup scroll observer on desktop
  if (window.matchMedia('(min-width: 1024px)').matches) {
    setupScrollObserver();
  }

  // Re-setup observer on resize
  window.addEventListener('resize', () => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setupScrollObserver();
    }
  });
}
