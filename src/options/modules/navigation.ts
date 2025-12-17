const navItems = document.querySelectorAll<HTMLAnchorElement>('.nav-item');

let scrollCleanup: (() => void) | null = null;

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
        const sectionRect = section.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop + sectionRect.top - containerRect.top - 24;
        scrollContainer.scrollTo({
          top: scrollTop,
          behavior: 'smooth'
        });
      }
    }
  });
});

function setupScrollTracking(): void {
  if (scrollCleanup) {
    scrollCleanup();
    scrollCleanup = null;
  }

  const scrollContainer = document.querySelector('.middle');
  if (!scrollContainer) return;

  const handleScroll = (): void => {
    // Query sections fresh each time in case DOM changed
    const sections = document.querySelectorAll<HTMLElement>('.settings-section');
    if (sections.length === 0) return;

    const containerTop = scrollContainer.getBoundingClientRect().top;

    // Find the section whose top is closest to (but not below) the container top
    let activeSection: HTMLElement | null = null;

    for (const section of sections) {
      const sectionTop = section.getBoundingClientRect().top;
      // Section is at or above the container top (with some margin)
      if (sectionTop <= containerTop + 50) {
        activeSection = section;
      } else {
        // First section below the threshold - stop here
        // If we haven't found any yet, use this one (we're at the top)
        if (!activeSection) {
          activeSection = section;
        }
        break;
      }
    }

    if (activeSection) {
      setActiveNavItem(activeSection.id);
    }
  };

  scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Initial check

  scrollCleanup = () => scrollContainer.removeEventListener('scroll', handleScroll);
}

function handleResponsiveTracking(): void {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  if (isDesktop) {
    setupScrollTracking();
  } else if (scrollCleanup) {
    scrollCleanup();
    scrollCleanup = null;
  }
}

handleResponsiveTracking();

window.addEventListener('resize', handleResponsiveTracking);

export function initNavigationModule(): void {
  // Hide bulk import nav item for web platform (CORS prevents fetching external URLs)
  if (__IS_WEB__) {
    const bulkImportNavItem = document.querySelector<HTMLAnchorElement>('.nav-item[data-section="bulk-import"]');
    if (bulkImportNavItem) {
      bulkImportNavItem.style.display = 'none';
    }
  }
}
