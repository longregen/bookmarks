import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Ref from 'effect/Ref';
import {
  MessagingService,
  MessagingError,
  sendMessage,
  addMessageListener,
  broadcastEvent as broadcastMessageEvent,
  type MessageOfType,
  type MessageResponse,
  type MessageType,
} from '../effect/lib/messages';
import {
  EventService,
  EventBroadcastError,
  type EventData,
  type EventType,
  type EventPayloads,
} from '../effect/lib/events';

// ============================================================================
// Test Mock Layer for MessagingService
// ============================================================================

interface MockMessageState {
  sentMessages: Array<{ type: MessageType; message: unknown }>;
  handlers: Map<MessageType, (message: unknown) => Effect.Effect<unknown, MessagingError>>;
  shouldFail: boolean;
  failureReason: 'runtime_error' | 'no_response' | 'handler_error';
}

const makeMockMessagingService = Effect.gen(function* () {
  const state = yield* Ref.make<MockMessageState>({
    sentMessages: [],
    handlers: new Map(),
    shouldFail: false,
    failureReason: 'runtime_error',
  });

  return {
    sendMessage: <T extends MessageType>(message: MessageOfType<T>) =>
      Effect.gen(function* () {
        const currentState = yield* Ref.get(state);

        // Record the message
        yield* Ref.update(state, (s) => ({
          ...s,
          sentMessages: [...s.sentMessages, { type: message.type, message }],
        }));

        // Check if we should simulate a failure
        if (currentState.shouldFail) {
          return yield* Effect.fail(
            new MessagingError({
              messageType: message.type,
              reason: currentState.failureReason,
              details: `Mock failure: ${currentState.failureReason}`,
            })
          );
        }

        // Find registered handler
        const handler = currentState.handlers.get(message.type);
        if (handler) {
          return yield* handler(message) as Effect.Effect<MessageResponse<T>, MessagingError>;
        }

        // Return mock responses based on message type
        const mockResponse = getMockResponse<T>(message.type);
        return mockResponse;
      }),

    addMessageListener: <T extends MessageType>(
      messageType: T,
      handler: (message: MessageOfType<T>) => Effect.Effect<MessageResponse<T>, MessagingError>
    ) =>
      Effect.gen(function* () {
        yield* Ref.update(state, (s) => ({
          ...s,
          handlers: new Map(s.handlers).set(messageType, handler as (message: unknown) => Effect.Effect<unknown, MessagingError>),
        }));

        // Return cleanup function
        return () => {
          Effect.runSync(
            Ref.update(state, (s) => {
              const newHandlers = new Map(s.handlers);
              newHandlers.delete(messageType);
              return { ...s, handlers: newHandlers };
            })
          );
        };
      }),

    broadcastEvent: (event: EventData) =>
      Effect.gen(function* () {
        const currentState = yield* Ref.get(state);

        // Record the event broadcast
        yield* Ref.update(state, (s) => ({
          ...s,
          sentMessages: [...s.sentMessages, { type: 'event:broadcast' as MessageType, message: event }],
        }));

        if (currentState.shouldFail) {
          return yield* Effect.fail(
            new MessagingError({
              messageType: 'event:broadcast',
              reason: currentState.failureReason,
              details: `Mock failure: ${currentState.failureReason}`,
            })
          );
        }
      }),

    // Test helpers
    getSentMessages: () => Ref.get(state).pipe(Effect.map((s) => s.sentMessages)),
    clearMessages: () => Ref.update(state, (s) => ({ ...s, sentMessages: [] })),
    setFailure: (shouldFail: boolean, reason: 'runtime_error' | 'no_response' | 'handler_error' = 'runtime_error') =>
      Ref.update(state, (s) => ({ ...s, shouldFail, failureReason: reason })),
  };
});

function getMockResponse<T extends MessageType>(messageType: T): MessageResponse<T> {
  switch (messageType) {
    case 'bookmark:save_from_page':
      return { success: true, bookmarkId: 'mock-123' } as MessageResponse<T>;
    case 'import:create_from_url_list':
      return { success: true, jobId: 'job-456', totalUrls: 5 } as MessageResponse<T>;
    case 'query:current_tab_info':
      return { url: 'https://example.com', title: 'Example' } as MessageResponse<T>;
    case 'bookmark:retry':
      return { success: true } as MessageResponse<T>;
    case 'sync:trigger':
      return { success: true, action: 'no-change' } as MessageResponse<T>;
    case 'query:sync_status':
      return { lastSyncTime: null, lastSyncError: null, isSyncing: false } as MessageResponse<T>;
    case 'sync:update_settings':
      return { success: true } as MessageResponse<T>;
    case 'extract:markdown_from_html':
      return { success: true, result: { title: 'Test', content: 'Content', excerpt: 'Excerpt', byline: null } } as MessageResponse<T>;
    case 'user_request:capture_current_tab':
      return { success: true } as MessageResponse<T>;
    case 'query:current_page_dom':
      return { success: true, html: '<html></html>' } as MessageResponse<T>;
    case 'offscreen:ping':
      return { ready: true } as MessageResponse<T>;
    case 'offscreen:ready':
    case 'event:broadcast':
      return undefined as MessageResponse<T>;
    default:
      return { success: false, error: 'Unknown message type' } as MessageResponse<T>;
  }
}

const MockMessagingServiceTag = Context.GenericTag<{
  sendMessage: <T extends MessageType>(
    message: MessageOfType<T>
  ) => Effect.Effect<MessageResponse<T>, MessagingError>;
  addMessageListener: <T extends MessageType>(
    messageType: T,
    handler: (message: MessageOfType<T>) => Effect.Effect<MessageResponse<T>, MessagingError>
  ) => Effect.Effect<() => void, never>;
  broadcastEvent: (event: EventData) => Effect.Effect<void, MessagingError>;
  getSentMessages: () => Effect.Effect<Array<{ type: MessageType; message: unknown }>, never>;
  clearMessages: () => Effect.Effect<void, never>;
  setFailure: (shouldFail: boolean, reason?: 'runtime_error' | 'no_response' | 'handler_error') => Effect.Effect<void, never>;
}>('MockMessagingService');

// Create a layer that provides both tags from the same instance
const MockMessagingServiceLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const service = yield* makeMockMessagingService;
    return Layer.mergeAll(
      Layer.succeed(MessagingService, service),
      Layer.succeed(MockMessagingServiceTag, service)
    );
  })
);

// ============================================================================
// Test Mock Layer for EventService
// ============================================================================

interface MockEventState {
  broadcastedEvents: EventData[];
  listeners: Array<(event: EventData) => void>;
  shouldFail: boolean;
}

const makeMockEventService = Effect.gen(function* () {
  const state = yield* Ref.make<MockEventState>({
    broadcastedEvents: [],
    listeners: [],
    shouldFail: false,
  });

  return {
    broadcastEvent: <T extends EventType>(type: T, payload: EventPayloads[T]) =>
      Effect.gen(function* () {
        const currentState = yield* Ref.get(state);

        if (currentState.shouldFail) {
          return yield* Effect.fail(
            new EventBroadcastError({
              eventType: type,
              cause: new Error('Mock broadcast failure'),
            })
          );
        }

        const event: EventData = {
          type,
          payload,
          timestamp: Date.now(),
        };

        // Record the event
        yield* Ref.update(state, (s) => ({
          ...s,
          broadcastedEvents: [...s.broadcastedEvents, event],
        }));

        // Notify all listeners
        currentState.listeners.forEach((listener) => {
          listener(event);
        });
      }),

    addEventListener: (listener: (event: EventData) => void) =>
      Effect.gen(function* () {
        yield* Ref.update(state, (s) => ({
          ...s,
          listeners: [...s.listeners, listener],
        }));
      }),

    // Test helpers
    getBroadcastedEvents: () => Ref.get(state).pipe(Effect.map((s) => s.broadcastedEvents)),
    clearEvents: () => Ref.update(state, (s) => ({ ...s, broadcastedEvents: [] })),
    setFailure: (shouldFail: boolean) => Ref.update(state, (s) => ({ ...s, shouldFail })),
  };
});

const MockEventServiceTag = Context.GenericTag<{
  broadcastEvent: <T extends EventType>(
    type: T,
    payload: EventPayloads[T]
  ) => Effect.Effect<void, EventBroadcastError>;
  addEventListener: (listener: (event: EventData) => void) => Effect.Effect<void, never>;
  getBroadcastedEvents: () => Effect.Effect<EventData[], never>;
  clearEvents: () => Effect.Effect<void, never>;
  setFailure: (shouldFail: boolean) => Effect.Effect<void, never>;
}>('MockEventService');

// Create a layer that provides both tags from the same instance
const MockEventServiceLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const service = yield* makeMockEventService;
    return Layer.mergeAll(
      Layer.succeed(EventService, service),
      Layer.succeed(MockEventServiceTag, service)
    );
  })
);

// ============================================================================
// Integration Tests
// ============================================================================

describe('MessagingService Integration', () => {
  describe('sendMessage', () => {
    it('should send a message and receive response', async () => {
      const program = Effect.gen(function* () {
        const response = yield* sendMessage({
          type: 'bookmark:save_from_page',
          data: { url: 'https://test.com', title: 'Test', html: '<html></html>' },
        });

        expect(response.success).toBe(true);
        expect(response.bookmarkId).toBe('mock-123');
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should handle different message types correctly', async () => {
      const program = Effect.gen(function* () {
        const tabInfo = yield* sendMessage({ type: 'query:current_tab_info' });
        expect(tabInfo.url).toBe('https://example.com');

        const syncStatus = yield* sendMessage({ type: 'query:sync_status' });
        expect(syncStatus.isSyncing).toBe(false);

        const bulkImport = yield* sendMessage({
          type: 'import:create_from_url_list',
          urls: ['https://a.com', 'https://b.com'],
        });
        expect(bulkImport.success).toBe(true);
        expect(bulkImport.totalUrls).toBe(5);
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should handle messaging errors', async () => {
      const program = Effect.gen(function* () {
        const mockService = yield* MockMessagingServiceTag;

        // Set failure mode
        yield* mockService.setFailure(true, 'runtime_error');

        // Attempt to send message
        const result = yield* sendMessage({ type: 'query:current_tab_info' }).pipe(
          Effect.either
        );

        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(MessagingError);
          expect(result.left.messageType).toBe('query:current_tab_info');
          expect(result.left.reason).toBe('runtime_error');
        } else {
          throw new Error('Expected failure but got success');
        }
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should handle no_response errors', async () => {
      const program = Effect.gen(function* () {
        const mockService = yield* MockMessagingServiceTag;

        yield* mockService.setFailure(true, 'no_response');

        const result = yield* sendMessage({ type: 'bookmark:retry', data: { trigger: 'user_manual' } }).pipe(
          Effect.either
        );

        if (result._tag === 'Left') {
          expect(result.left.reason).toBe('no_response');
        } else {
          throw new Error('Expected failure but got success');
        }
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should track sent messages', async () => {
      const program = Effect.gen(function* () {
        const mockService = yield* MockMessagingServiceTag;

        yield* sendMessage({ type: 'query:current_tab_info' });
        yield* sendMessage({ type: 'sync:trigger' });

        const sentMessages = yield* mockService.getSentMessages();
        expect(sentMessages).toHaveLength(2);
        expect(sentMessages[0].type).toBe('query:current_tab_info');
        expect(sentMessages[1].type).toBe('sync:trigger');
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });
  });

  describe('addMessageListener', () => {
    it('should register a message handler and receive messages', async () => {
      const program = Effect.gen(function* () {
        const received: MessageOfType<'bookmark:retry'>[] = [];

        const cleanup = yield* addMessageListener('bookmark:retry', (msg) =>
          Effect.sync(() => {
            received.push(msg);
            return { success: true };
          })
        );

        // Send a message that should be handled
        const response = yield* sendMessage({
          type: 'bookmark:retry',
          data: { trigger: 'user_manual', bookmarkId: 'test-123' },
        });

        expect(response.success).toBe(true);
        expect(received).toHaveLength(1);
        expect(received[0].data.bookmarkId).toBe('test-123');

        cleanup();
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should support multiple handlers for different message types', async () => {
      const program = Effect.gen(function* () {
        const retryMessages: MessageOfType<'bookmark:retry'>[] = [];
        const syncMessages: MessageOfType<'sync:trigger'>[] = [];

        const cleanup1 = yield* addMessageListener('bookmark:retry', (msg) =>
          Effect.sync(() => {
            retryMessages.push(msg);
            return { success: true };
          })
        );

        const cleanup2 = yield* addMessageListener('sync:trigger', (msg) =>
          Effect.sync(() => {
            syncMessages.push(msg);
            return { success: true, action: 'uploaded' as const };
          })
        );

        yield* sendMessage({ type: 'bookmark:retry', data: { trigger: 'auto_backoff' } });
        yield* sendMessage({ type: 'sync:trigger' });

        expect(retryMessages).toHaveLength(1);
        expect(syncMessages).toHaveLength(1);

        cleanup1();
        cleanup2();
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should handle errors in message handlers', async () => {
      const program = Effect.gen(function* () {
        const cleanup = yield* addMessageListener('bookmark:retry', (_msg) =>
          Effect.fail(
            new MessagingError({
              messageType: 'bookmark:retry',
              reason: 'handler_error',
              details: 'Handler threw an error',
            })
          )
        );

        const result = yield* sendMessage({
          type: 'bookmark:retry',
          data: { trigger: 'user_manual' },
        }).pipe(Effect.either);

        if (result._tag === 'Left') {
          expect(result.left.reason).toBe('handler_error');
        } else {
          throw new Error('Expected handler error');
        }

        cleanup();
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should properly cleanup listeners', async () => {
      const program = Effect.gen(function* () {
        const received: MessageOfType<'bookmark:retry'>[] = [];

        const cleanup = yield* addMessageListener('bookmark:retry', (msg) =>
          Effect.sync(() => {
            received.push(msg);
            return { success: true };
          })
        );

        yield* sendMessage({ type: 'bookmark:retry', data: { trigger: 'user_manual' } });
        expect(received).toHaveLength(1);

        // Cleanup the listener
        cleanup();

        // This message should use the default mock response, not the handler
        const response = yield* sendMessage({ type: 'bookmark:retry', data: { trigger: 'user_manual' } });
        expect(response.success).toBe(true);
        expect(received).toHaveLength(1); // Should still be 1, not 2
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });
  });

  describe('broadcastEvent via MessagingService', () => {
    it('should broadcast events through messaging service', async () => {
      const program = Effect.gen(function* () {
        const mockService = yield* MockMessagingServiceTag;

        const event: EventData = {
          type: 'bookmark:created',
          payload: { bookmarkId: 'test-123', url: 'https://test.com' },
          timestamp: Date.now(),
        };

        yield* broadcastMessageEvent(event);

        const sentMessages = yield* mockService.getSentMessages();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0].type).toBe('event:broadcast');
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });

    it('should handle broadcast failures gracefully', async () => {
      const program = Effect.gen(function* () {
        const mockService = yield* MockMessagingServiceTag;
        yield* mockService.setFailure(true, 'runtime_error');

        const event: EventData = {
          type: 'bookmark:deleted',
          payload: { bookmarkId: 'test-456' },
          timestamp: Date.now(),
        };

        const result = yield* broadcastMessageEvent(event).pipe(Effect.either);

        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(MessagingError);
        } else {
          throw new Error('Expected broadcast to fail');
        }
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
    });
  });
});

describe('EventService Integration', () => {
  describe('broadcastEvent', () => {
    it('should broadcast typed bookmark events', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const mockService = yield* MockEventServiceTag;

        yield* eventService.broadcastEvent('bookmark:created', {
          bookmarkId: 'test-123',
          url: 'https://example.com',
        });

        const events = yield* mockService.getBroadcastedEvents();
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('bookmark:created');
        expect(events[0].payload).toEqual({
          bookmarkId: 'test-123',
          url: 'https://example.com',
        });
        expect(events[0].timestamp).toBeGreaterThan(0);
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });

    it('should broadcast multiple event types', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const mockService = yield* MockEventServiceTag;

        yield* eventService.broadcastEvent('bookmark:created', {
          bookmarkId: 'b1',
          url: 'https://a.com',
        });

        yield* eventService.broadcastEvent('tag:added', {
          bookmarkId: 'b1',
          tagName: 'javascript',
        });

        yield* eventService.broadcastEvent('job:created', {
          jobId: 'job-1',
          totalItems: 10,
        });

        yield* eventService.broadcastEvent('sync:started', {
          manual: true,
        });

        const events = yield* mockService.getBroadcastedEvents();
        expect(events).toHaveLength(4);
        expect(events[0].type).toBe('bookmark:created');
        expect(events[1].type).toBe('tag:added');
        expect(events[2].type).toBe('job:created');
        expect(events[3].type).toBe('sync:started');
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });

    it('should handle broadcast failures', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const mockService = yield* MockEventServiceTag;

        yield* mockService.setFailure(true);

        const result = yield* eventService
          .broadcastEvent('bookmark:processing_failed', {
            bookmarkId: 'b1',
            error: 'Test error',
          })
          .pipe(Effect.either);

        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(EventBroadcastError);
          expect(result.left.eventType).toBe('bookmark:processing_failed');
        } else {
          throw new Error('Expected broadcast to fail');
        }
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });
  });

  describe('addEventListener', () => {
    it('should register listeners and receive events', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const receivedEvents: EventData[] = [];

        yield* eventService.addEventListener((event) => {
          receivedEvents.push(event);
        });

        yield* eventService.broadcastEvent('bookmark:ready', {
          bookmarkId: 'test-123',
        });

        // Give async event propagation time
        yield* Effect.sleep('10 millis');

        expect(receivedEvents).toHaveLength(1);
        expect(receivedEvents[0].type).toBe('bookmark:ready');
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });

    it('should support multiple listeners', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const received1: EventData[] = [];
        const received2: EventData[] = [];

        yield* eventService.addEventListener((event) => {
          received1.push(event);
        });

        yield* eventService.addEventListener((event) => {
          received2.push(event);
        });

        yield* eventService.broadcastEvent('tag:removed', {
          bookmarkId: 'b1',
          tagName: 'outdated',
        });

        yield* Effect.sleep('10 millis');

        expect(received1).toHaveLength(1);
        expect(received2).toHaveLength(1);
        expect(received1[0].type).toBe('tag:removed');
        expect(received2[0].type).toBe('tag:removed');
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });

    it('should filter events by type in listener', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const bookmarkEvents: EventData[] = [];
        const tagEvents: EventData[] = [];

        yield* eventService.addEventListener((event) => {
          if (event.type.startsWith('bookmark:')) {
            bookmarkEvents.push(event);
          } else if (event.type.startsWith('tag:')) {
            tagEvents.push(event);
          }
        });

        yield* eventService.broadcastEvent('bookmark:created', {
          bookmarkId: 'b1',
          url: 'https://a.com',
        });

        yield* eventService.broadcastEvent('tag:added', {
          bookmarkId: 'b1',
          tagName: 'tech',
        });

        yield* eventService.broadcastEvent('bookmark:deleted', {
          bookmarkId: 'b2',
        });

        yield* Effect.sleep('10 millis');

        expect(bookmarkEvents).toHaveLength(2);
        expect(tagEvents).toHaveLength(1);
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });
  });

  describe('typed event payloads', () => {
    it('should enforce bookmark event payload types', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const mockService = yield* MockEventServiceTag;

        // bookmark:created requires bookmarkId and url
        yield* eventService.broadcastEvent('bookmark:created', {
          bookmarkId: 'b1',
          url: 'https://test.com',
        });

        // bookmark:status_changed requires bookmarkId, newStatus, optional oldStatus
        yield* eventService.broadcastEvent('bookmark:status_changed', {
          bookmarkId: 'b1',
          newStatus: 'complete',
          oldStatus: 'pending',
        });

        // bookmark:processing_failed requires bookmarkId and error
        yield* eventService.broadcastEvent('bookmark:processing_failed', {
          bookmarkId: 'b1',
          error: 'Network timeout',
        });

        const events = yield* mockService.getBroadcastedEvents();
        expect(events).toHaveLength(3);
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });

    it('should enforce job event payload types', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const mockService = yield* MockEventServiceTag;

        yield* eventService.broadcastEvent('job:created', {
          jobId: 'job-1',
          totalItems: 50,
        });

        yield* eventService.broadcastEvent('job:progress_changed', {
          jobId: 'job-1',
          completedCount: 25,
          totalCount: 50,
        });

        yield* eventService.broadcastEvent('job:completed', {
          jobId: 'job-1',
        });

        const events = yield* mockService.getBroadcastedEvents();
        expect(events).toHaveLength(3);
        expect(events[0].payload).toHaveProperty('totalItems');
        expect(events[1].payload).toHaveProperty('completedCount');
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });

    it('should enforce sync event payload types', async () => {
      const program = Effect.gen(function* () {
        const eventService = yield* EventService;
        const mockService = yield* MockEventServiceTag;

        yield* eventService.broadcastEvent('sync:started', {
          manual: false,
        });

        yield* eventService.broadcastEvent('sync:completed', {
          action: 'uploaded',
          bookmarkCount: 100,
        });

        yield* eventService.broadcastEvent('sync:failed', {
          error: 'Connection refused',
        });

        const events = yield* mockService.getBroadcastedEvents();
        expect(events).toHaveLength(3);

        const syncStarted = events[0].payload as EventPayloads['sync:started'];
        expect(syncStarted.manual).toBe(false);

        const syncCompleted = events[1].payload as EventPayloads['sync:completed'];
        expect(syncCompleted.action).toBe('uploaded');
        expect(syncCompleted.bookmarkCount).toBe(100);
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockEventServiceLayer)));
    });
  });
});

describe('Messaging & Events Integration', () => {
  it('should coordinate messaging and events together', async () => {
    const program = Effect.gen(function* () {
      const mockMessaging = yield* MockMessagingServiceTag;
      const mockEvents = yield* MockEventServiceTag;
      const eventService = yield* EventService;

      // Simulate a workflow: save bookmark -> broadcast event -> query status
      const saveResponse = yield* sendMessage({
        type: 'bookmark:save_from_page',
        data: { url: 'https://test.com', title: 'Test', html: '<html></html>' },
      });

      expect(saveResponse.success).toBe(true);

      // Broadcast bookmark created event
      yield* eventService.broadcastEvent('bookmark:created', {
        bookmarkId: saveResponse.bookmarkId!,
        url: 'https://test.com',
      });

      // Query current tab info
      const tabInfo = yield* sendMessage({ type: 'query:current_tab_info' });
      expect(tabInfo.url).toBeDefined();

      // Verify both systems recorded their actions
      const messages = yield* mockMessaging.getSentMessages();
      const events = yield* mockEvents.getBroadcastedEvents();

      expect(messages).toHaveLength(2); // save + query
      expect(events).toHaveLength(1); // bookmark:created
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(MockMessagingServiceLayer, MockEventServiceLayer)
        )
      )
    );
  });

  it('should handle event broadcast through messaging service', async () => {
    const program = Effect.gen(function* () {
      const mockMessaging = yield* MockMessagingServiceTag;

      // Broadcast event via messaging service
      const event: EventData = {
        type: 'job:progress_changed',
        payload: { jobId: 'job-1', completedCount: 50, totalCount: 100 },
        timestamp: Date.now(),
      };

      yield* broadcastMessageEvent(event);

      const messages = yield* mockMessaging.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('event:broadcast');

      const sentEvent = messages[0].message as EventData;
      expect(sentEvent.type).toBe('job:progress_changed');
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockMessagingServiceLayer)));
  });

  it('should handle complex workflow with error recovery', async () => {
    const program = Effect.gen(function* () {
      const mockMessaging = yield* MockMessagingServiceTag;
      const eventService = yield* EventService;

      // Start a job
      const importResponse = yield* sendMessage({
        type: 'import:create_from_url_list',
        urls: ['https://a.com', 'https://b.com'],
      });

      yield* eventService.broadcastEvent('job:created', {
        jobId: importResponse.jobId!,
        totalItems: importResponse.totalUrls!,
      });

      // Simulate processing with retries
      yield* mockMessaging.setFailure(true, 'runtime_error');

      const retryResult = yield* sendMessage({
        type: 'bookmark:retry',
        data: { trigger: 'auto_backoff', attemptNumber: 2 },
      }).pipe(Effect.either);

      expect(retryResult._tag).toBe('Left');

      // Recover from error
      yield* mockMessaging.setFailure(false);

      // Try again and broadcast failure event
      yield* eventService.broadcastEvent('bookmark:processing_failed', {
        bookmarkId: 'test-123',
        error: 'Max retries exceeded',
      });

      const success = yield* sendMessage({
        type: 'bookmark:retry',
        data: { trigger: 'user_manual' },
      });

      expect(success.success).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(MockMessagingServiceLayer, MockEventServiceLayer)
        )
      )
    );
  });
});
