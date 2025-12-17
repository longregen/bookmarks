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

  const sectionsNodeList = document.querySelectorAll<HTMLElement>('.settings-section');
  if (sectionsNodeList.length === 0) return;

  const sections = Array.from(sectionsNodeList);

  // Track which sections are currently intersecting the top area
  const intersectingSections = new Set<HTMLElement>();

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        const section = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          intersectingSections.add(section);
        } else {
          intersectingSections.delete(section);
        }
      });

      // Find the first intersecting section in DOM order (topmost visible section)
      let activeSection: HTMLElement | null = null;
      for (const section of sections) {
        if (intersectingSections.has(section)) {
          activeSection = section;
          break;
        }
      }

      // If no section is intersecting, default to the first section
      if (!activeSection && sections.length > 0) {
        activeSection = sections[0];
      }

      if (activeSection) {
        setActiveNavItem(activeSection.id);
      }
    },
    {
      root: scrollContainer,
      threshold: 0,
      // Negative top margin creates an offset 50px below the container top
      // This matches the original logic's "containerTop + 50" threshold
      rootMargin: '-50px 0px 0px 0px'
    }
  );

  sections.forEach(section => observer.observe(section));

  scrollCleanup = () => {
    observer.disconnect();
  };
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
