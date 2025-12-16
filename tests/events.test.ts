import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcastEvent, addEventListener, type EventData } from '../src/lib/events';

describe('Event System', () => {
  let receivedEvents: EventData[] = [];
  let removeListener: (() => void) | null = null;

  beforeEach(() => {
    receivedEvents = [];
    removeListener = null;
  });

  afterEach(() => {
    if (removeListener) {
      removeListener();
      removeListener = null;
    }
  });

  describe('addEventListener', () => {
    it('should receive broadcast events', async () => {
      removeListener = addEventListener((event) => {
        receivedEvents.push(event);
      });

      await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: '123', status: 'complete' });

      // Wait a bit for the event to be processed
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('BOOKMARK_UPDATED');
      expect(receivedEvents[0].payload).toEqual({ bookmarkId: '123', status: 'complete' });
    });

    it('should receive multiple events', async () => {
      removeListener = addEventListener((event) => {
        receivedEvents.push(event);
      });

      await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: '1' });
      await broadcastEvent('JOB_UPDATED', { jobId: '2' });
      await broadcastEvent('SYNC_STATUS_UPDATED', { isSyncing: true });

      // Wait a bit for events to be processed
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents[0].type).toBe('BOOKMARK_UPDATED');
      expect(receivedEvents[1].type).toBe('JOB_UPDATED');
      expect(receivedEvents[2].type).toBe('SYNC_STATUS_UPDATED');
    });

    it('should not receive events after removeListener is called', async () => {
      removeListener = addEventListener((event) => {
        receivedEvents.push(event);
      });

      await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: '1' });

      // Wait for event
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);

      // Remove listener
      removeListener();
      removeListener = null;

      // Broadcast another event
      await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: '2' });

      // Wait again
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still only have 1 event (the first one)
      expect(receivedEvents).toHaveLength(1);
    });

    it('should support multiple listeners', async () => {
      const receivedEvents1: EventData[] = [];
      const receivedEvents2: EventData[] = [];

      const remove1 = addEventListener((event) => {
        receivedEvents1.push(event);
      });

      const remove2 = addEventListener((event) => {
        receivedEvents2.push(event);
      });

      await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: '123' });

      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents1).toHaveLength(1);
      expect(receivedEvents2).toHaveLength(1);

      remove1();
      remove2();
    });
  });

  describe('broadcastEvent', () => {
    it('should create events with timestamps', async () => {
      removeListener = addEventListener((event) => {
        receivedEvents.push(event);
      });

      const beforeTimestamp = Date.now();
      await broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: '123' });
      const afterTimestamp = Date.now();

      // Wait for event
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(receivedEvents[0].timestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should broadcast events with no payload', async () => {
      removeListener = addEventListener((event) => {
        receivedEvents.push(event);
      });

      await broadcastEvent('PROCESSING_COMPLETE');

      // Wait for event
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('PROCESSING_COMPLETE');
      expect(receivedEvents[0].payload).toBeUndefined();
    });

    it('should not throw errors when no listeners exist', async () => {
      // This should not throw
      await expect(
        broadcastEvent('BOOKMARK_UPDATED', { bookmarkId: '123' })
      ).resolves.toBeUndefined();
    });
  });

  describe('Event Types', () => {
    it('should support BOOKMARK_UPDATED events', async () => {
      removeListener = addEventListener((event) => {
        if (event.type === 'BOOKMARK_UPDATED') {
          receivedEvents.push(event);
        }
      });

      await broadcastEvent('BOOKMARK_UPDATED', {
        bookmarkId: 'test-123',
        status: 'complete'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].payload.bookmarkId).toBe('test-123');
      expect(receivedEvents[0].payload.status).toBe('complete');
    });

    it('should support JOB_UPDATED events', async () => {
      removeListener = addEventListener((event) => {
        if (event.type === 'JOB_UPDATED') {
          receivedEvents.push(event);
        }
      });

      await broadcastEvent('JOB_UPDATED', {
        jobId: 'job-456',
        status: 'completed'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].payload.jobId).toBe('job-456');
    });

    it('should support SYNC_STATUS_UPDATED events', async () => {
      removeListener = addEventListener((event) => {
        if (event.type === 'SYNC_STATUS_UPDATED') {
          receivedEvents.push(event);
        }
      });

      await broadcastEvent('SYNC_STATUS_UPDATED', {
        isSyncing: true,
        lastSyncTime: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].payload.isSyncing).toBe(true);
    });

    it('should support PROCESSING_COMPLETE events', async () => {
      removeListener = addEventListener((event) => {
        if (event.type === 'PROCESSING_COMPLETE') {
          receivedEvents.push(event);
        }
      });

      await broadcastEvent('PROCESSING_COMPLETE');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
    });

    it('should support TAG_UPDATED events', async () => {
      removeListener = addEventListener((event) => {
        if (event.type === 'TAG_UPDATED') {
          receivedEvents.push(event);
        }
      });

      await broadcastEvent('TAG_UPDATED', {
        bookmarkId: 'bookmark-123',
        tagName: 'javascript',
        action: 'added'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].payload.bookmarkId).toBe('bookmark-123');
      expect(receivedEvents[0].payload.tagName).toBe('javascript');
      expect(receivedEvents[0].payload.action).toBe('added');
    });

    it('should support TAG_UPDATED events for tag removal', async () => {
      removeListener = addEventListener((event) => {
        if (event.type === 'TAG_UPDATED') {
          receivedEvents.push(event);
        }
      });

      await broadcastEvent('TAG_UPDATED', {
        bookmarkId: 'bookmark-456',
        tagName: 'tutorial',
        action: 'removed'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].payload.bookmarkId).toBe('bookmark-456');
      expect(receivedEvents[0].payload.tagName).toBe('tutorial');
      expect(receivedEvents[0].payload.action).toBe('removed');
    });
  });
});
