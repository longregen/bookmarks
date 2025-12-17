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

function setupScrollObserver(): void {
  if (scrollObserver) {
    scrollObserver.disconnect();
  }

  const scrollContainer = document.querySelector('.middle');
  if (!scrollContainer) return;

  // Use scroll listener instead of IntersectionObserver for more reliable
  // tracking with nested scroll containers
  const handleScroll = (): void => {
    const containerRect = scrollContainer.getBoundingClientRect();
    // Target zone is 20% from top of container
    const targetY = containerRect.top + containerRect.height * 0.2;

    let activeSectionId = '';
    let closestDistance = Infinity;

    sections.forEach(section => {
      const sectionRect = section.getBoundingClientRect();
      const distance = Math.abs(sectionRect.top - targetY);
      if (sectionRect.top <= targetY && distance < closestDistance) {
        closestDistance = distance;
        activeSectionId = section.id;
      }
    });

    if (activeSectionId) {
      setActiveNavItem(activeSectionId);
    }
  };

  scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
  // Initial check
  handleScroll();

  // Store cleanup function
  scrollObserver = {
    disconnect: () => scrollContainer.removeEventListener('scroll', handleScroll)
  } as IntersectionObserver;
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
