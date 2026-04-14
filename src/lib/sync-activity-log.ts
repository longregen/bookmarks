import { addEventListener as addBookmarkEventListener, type EventData } from './events';

export interface SyncActivityEntry {
  timestamp: number;
  kind: 'started' | 'completed' | 'failed';
  action?: 'uploaded' | 'downloaded' | 'no-change';
  count?: number;
  error?: string;
}

const STORAGE_KEY = 'syncActivityLog';
const MAX_ENTRIES = 50;

let buffer: SyncActivityEntry[] = [];
let loaded = false;
let disposer: (() => void) | null = null;

async function loadFromStorage(): Promise<void> {
  if (loaded) return;
  try {
    if (typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined') {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as string | undefined;
      if (stored !== undefined && stored !== '') buffer = JSON.parse(stored) as SyncActivityEntry[];
    } else if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null && stored !== '') buffer = JSON.parse(stored) as SyncActivityEntry[];
    }
  } catch {
    buffer = [];
  }
  loaded = true;
}

async function persistToStorage(): Promise<void> {
  try {
    const payload = JSON.stringify(buffer);
    if (typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined') {
      await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, payload);
    }
  } catch {
    // best-effort
  }
}

async function recordEntry(entry: SyncActivityEntry): Promise<void> {
  await loadFromStorage();
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  await persistToStorage();
}

function handleEvent(event: EventData): void {
  if (event.type === 'sync:started') {
    void recordEntry({ timestamp: event.timestamp, kind: 'started' });
  } else if (event.type === 'sync:completed') {
    const payload = event.payload as { action: 'uploaded' | 'downloaded' | 'no-change'; bookmarkCount?: number };
    void recordEntry({
      timestamp: event.timestamp,
      kind: 'completed',
      action: payload.action,
      count: payload.bookmarkCount,
    });
  } else if (event.type === 'sync:failed') {
    const payload = event.payload as { error: string };
    void recordEntry({ timestamp: event.timestamp, kind: 'failed', error: payload.error });
  }
}

export function initSyncActivityLog(): () => void {
  if (disposer) return disposer;
  void loadFromStorage();
  disposer = addBookmarkEventListener(handleEvent);
  return disposer;
}

export async function getRecentSyncActivity(limit = 20): Promise<SyncActivityEntry[]> {
  await loadFromStorage();
  return buffer.slice(-limit).reverse();
}
