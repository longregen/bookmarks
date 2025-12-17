const navItems = document.querySelectorAll<HTMLAnchorElement>('.nav-item');
const sections = document.querySelectorAll<HTMLElement>('.settings-section');

function setActiveNavItem(sectionId: string): void {
  navItems.forEach(item => {
    if (item.dataset.section === sectionId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const sectionId = item.dataset.section;
    if (sectionId !== undefined && sectionId !== '') {
      setActiveNavItem(sectionId);
      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
});

function setupScrollObserver(): void {
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

if (window.matchMedia('(min-width: 1024px)').matches) {
  setupScrollObserver();
}

window.addEventListener('resize', () => {
  if (window.matchMedia('(min-width: 1024px)').matches) {
    setupScrollObserver();
  }
});

export function initNavigationModule(): void {
  // Hide bulk import nav item for web platform (CORS prevents fetching external URLs)
  if (__IS_WEB__) {
    const bulkImportNavItem = document.querySelector<HTMLAnchorElement>('.nav-item[data-section="bulk-import"]');
    if (bulkImportNavItem) {
      bulkImportNavItem.style.display = 'none';
    }
  }
}
