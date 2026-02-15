import type { Queue, QueueMessage, QueueConsumer } from './interface.ts';

interface QueueItem {
  message: QueueMessage;
  retryCount: number;
}

export class DenoQueue implements Queue {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private consumer: QueueConsumer | null = null;
  private deadLetterQueue: QueueItem[] = [];

  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;

  setConsumer(consumer: QueueConsumer): void {
    this.consumer = consumer;
  }

  async sendBatch(messages: QueueMessage[]): Promise<void> {
    for (const message of messages) {
      await this.send(message);
    }
  }

  async send(message: QueueMessage): Promise<void> {
    const exists = this.queue.some(
      (item) => item.message.bookmarkId === message.bookmarkId && item.message.action === message.action
    );

    if (!exists) {
      this.queue.push({ message, retryCount: 0 });
      this.processNext();
    }
  }

  getDeadLetterQueue(): QueueMessage[] {
    return this.deadLetterQueue.map((item) => item.message);
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || !this.consumer) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;

    try {
      await this.consumer.process(item.message);
    } catch (error) {
      if (item.retryCount < DenoQueue.MAX_RETRIES) {
        const delay = DenoQueue.BASE_DELAY_MS * Math.pow(2, item.retryCount);
        console.warn(
          `Failed to process message for bookmark ${item.message.bookmarkId}, ` +
          `retrying in ${delay}ms (attempt ${item.retryCount + 1}/${DenoQueue.MAX_RETRIES}):`,
          error
        );
        setTimeout(() => {
          this.queue.push({ message: item.message, retryCount: item.retryCount + 1 });
          this.processNext();
        }, delay);
      } else {
        console.error(
          `Failed to process message for bookmark ${item.message.bookmarkId} ` +
          `after ${DenoQueue.MAX_RETRIES} retries, moving to dead-letter queue:`,
          error
        );
        this.deadLetterQueue.push(item);
      }
    }

    this.isProcessing = false;

    if (this.queue.length > 0) {
      setTimeout(() => this.processNext(), 100);
    }
  }
}
