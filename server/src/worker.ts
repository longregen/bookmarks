import { createApp } from './app.ts';
import { D1Database, type D1DatabaseBinding } from './adapters/database/d1.ts';
import { CloudflareQueue, type CloudflareQueueBinding } from './adapters/queue/cloudflare.ts';
import { CloudflareEnv, type WorkerEnvBindings } from './adapters/env/cloudflare.ts';
import { processBookmark } from './services/processor.app.ts';
import type { QueueMessage } from './adapters/queue/interface.ts';

export interface WorkerEnv extends WorkerEnvBindings {
  DB: D1DatabaseBinding;
  BOOKMARK_QUEUE: CloudflareQueueBinding;
}

export interface MessageBatch<T> {
  messages: { body: T; ack(): void; retry(): void }[];
  queue: string;
  ackAll(): void;
  retryAll(): void;
}

// ExecutionContext type for Cloudflare Workers
interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  async fetch(request: Request, workerEnv: WorkerEnv, _ctx: WorkerExecutionContext): Promise<Response> {
    const db = new D1Database(workerEnv.DB);
    const queue = new CloudflareQueue(workerEnv.BOOKMARK_QUEUE);
    const env = new CloudflareEnv(workerEnv);

    const app = createApp({ db, queue, env });

    return app.fetch(request);
  },

  async queue(batch: MessageBatch<QueueMessage>, workerEnv: WorkerEnv): Promise<void> {
    const db = new D1Database(workerEnv.DB);
    const queue = new CloudflareQueue(workerEnv.BOOKMARK_QUEUE);
    const env = new CloudflareEnv(workerEnv);

    const deps = { db, queue, env };

    for (const message of batch.messages) {
      try {
        await processBookmark(deps, message.body.bookmarkId);
        message.ack();
      } catch (error) {
        console.error(`Failed to process bookmark ${message.body.bookmarkId}:`, error);
        message.retry();
      }
    }
  },
};
