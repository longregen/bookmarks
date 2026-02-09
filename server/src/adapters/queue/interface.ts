export interface QueueMessage {
  bookmarkId: string;
  userId: string;
  action: 'process' | 'reprocess';
}

export interface Queue {
  send(message: QueueMessage): Promise<void>;
}

export interface QueueConsumer {
  process(message: QueueMessage): Promise<void>;
}
