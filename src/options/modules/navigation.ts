const navItems = document.querySelectorAll<HTMLAnchorElement>('.nav-item');

function setActiveNavItem(sectionId: string): void {
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionId);
  });
}

navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const sectionId = item.dataset.section;
    if (sectionId !== undefined && sectionId !== '') {
      setActiveNavItem(sectionId);
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
    }
  });
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
