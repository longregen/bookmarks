export function getStatusModifier(status: string): string {
  const statusMap: Record<string, string> = {
    complete: 'status-dot--success',
    pending: 'status-dot--warning',
    processing: 'status-dot--info',
    error: 'status-dot--error',
  };
  return statusMap[status] || 'status-dot--warning';
}

export function sortBookmarks<T extends { createdAt: Date; title: string }>(
  bookmarks: T[],
  sortBy: string
): T[] {
  const sorted = [...bookmarks];

  if (sortBy === 'newest') {
    sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else if (sortBy === 'oldest') {
    sorted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  } else if (sortBy === 'title') {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  }

  return sorted;
}
