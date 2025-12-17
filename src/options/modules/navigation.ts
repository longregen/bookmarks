const navItems = document.querySelectorAll<HTMLAnchorElement>('.nav-item');
const sections = document.querySelectorAll<HTMLElement>('.settings-section');

let scrollObserver: IntersectionObserver | null = null;

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
      const scrollContainer = document.querySelector('.middle');
      if (section && scrollContainer) {
        // Use scrollTo on container directly to avoid scrollIntoView
        // scrolling both the container AND the document body
        scrollContainer.scrollTo({
          top: section.offsetTop,
          behavior: 'smooth'
        });
      }
    }
  });
});

function setupScrollObserver(): void {
  // Clean up existing observer to prevent memory leaks
  if (scrollObserver) {
    scrollObserver.disconnect();
  }

  const scrollContainer = document.querySelector('.middle');
  const observerOptions: IntersectionObserverInit = {
    root: scrollContainer,
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0
  };

  scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const sectionId = entry.target.id;
        setActiveNavItem(sectionId);
      }
    });
  }, observerOptions);

  sections.forEach(section => {
    scrollObserver?.observe(section);
  });
}

function handleResponsiveObserver(): void {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  if (isDesktop) {
    setupScrollObserver();
  } else if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }
}

handleResponsiveObserver();

window.addEventListener('resize', handleResponsiveObserver);

export function initNavigationModule(): void {
  // Hide bulk import nav item for web platform (CORS prevents fetching external URLs)
  if (__IS_WEB__) {
    const bulkImportNavItem = document.querySelector<HTMLAnchorElement>('.nav-item[data-section="bulk-import"]');
    if (bulkImportNavItem) {
      bulkImportNavItem.style.display = 'none';
    }
  }
}
