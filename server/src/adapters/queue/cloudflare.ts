import type { Queue, QueueMessage } from './interface.ts';

// Cloudflare Queue binding type
export interface CloudflareQueueBinding {
  send(message: unknown): Promise<void>;
  sendBatch(messages: { body: unknown }[]): Promise<void>;
}

export class CloudflareQueue implements Queue {
  private queue: CloudflareQueueBinding;

  constructor(queue: CloudflareQueueBinding) {
    this.queue = queue;
  }

  async send(message: QueueMessage): Promise<void> {
    await this.queue.send(message);
  }

  async sendBatch(messages: QueueMessage[]): Promise<void> {
    await this.queue.sendBatch(messages.map((body) => ({ body })));
  }
}
