import type { Database, PreparedStatement, BindValue } from '../adapters/database/interface.ts';
import type { Queue, QueueMessage } from '../adapters/queue/interface.ts';
import type { Env } from '../adapters/env/interface.ts';
import type { AppDependencies } from '../app.ts';

type QueryResult = Record<string, unknown>;

export class MockPreparedStatement<T extends object = Record<string, unknown>> implements PreparedStatement<T> {
  private boundParams: BindValue[] = [];

  constructor(
    private sql: string,
    private db: MockDatabase
  ) {}

  bind(...params: BindValue[]): PreparedStatement<T> {
    this.boundParams = params;
    return this;
  }

  async first(): Promise<T | null> {
    return this.db.executeFirst<T>(this.sql, this.boundParams);
  }

  async all(): Promise<T[]> {
    return this.db.executeAll<T>(this.sql, this.boundParams);
  }

  async run(): Promise<{ changes: number }> {
    return this.db.executeRun(this.sql, this.boundParams);
  }
}

export class MockDatabase implements Database {
  private data: Map<string, QueryResult[]> = new Map();
  private queryHandlers: Map<string, (params: BindValue[]) => QueryResult | QueryResult[] | null> = new Map();
  public executedQueries: { sql: string; params: BindValue[] }[] = [];

  prepare<T extends object = Record<string, unknown>>(sql: string): PreparedStatement<T> {
    return new MockPreparedStatement<T>(sql, this);
  }

  async exec(_sql: string): Promise<void> {}

  async batch(statements: PreparedStatement[]): Promise<void> {
    for (const stmt of statements) {
      await stmt.run();
    }
  }

  setQueryHandler(pattern: string, handler: (params: BindValue[]) => QueryResult | QueryResult[] | null): void {
    this.queryHandlers.set(pattern, handler);
  }

  setData(table: string, rows: QueryResult[]): void {
    this.data.set(table, rows);
  }

  executeFirst<T>(sql: string, params: BindValue[]): T | null {
    this.executedQueries.push({ sql, params });

    for (const [pattern, handler] of this.queryHandlers) {
      if (sql.includes(pattern)) {
        const result = handler(params);
        if (Array.isArray(result)) return result[0] as T || null;
        return result as T | null;
      }
    }

    return null;
  }

  executeAll<T>(sql: string, params: BindValue[]): T[] {
    this.executedQueries.push({ sql, params });

    for (const [pattern, handler] of this.queryHandlers) {
      if (sql.includes(pattern)) {
        const result = handler(params);
        if (Array.isArray(result)) return result as T[];
        return result ? [result] as T[] : [];
      }
    }

    return [];
  }

  executeRun(sql: string, params: BindValue[]): { changes: number } {
    this.executedQueries.push({ sql, params });
    return { changes: 1 };
  }

  reset(): void {
    this.executedQueries = [];
    this.queryHandlers.clear();
    this.data.clear();
  }
}

export class MockQueue implements Queue {
  public sentMessages: QueueMessage[] = [];

  async send(message: QueueMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  reset(): void {
    this.sentMessages = [];
  }
}

export class MockEnv implements Env {
  private values: Map<string, string> = new Map();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.values.set(key, value);
      }
    }
  }

  get(key: string): string | undefined {
    return this.values.get(key);
  }

  getRequired(key: string): string {
    const value = this.values.get(key);
    if (!value) throw new Error(`Missing required env var: ${key}`);
    return value;
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }
}

export function createMockDeps(envValues?: Record<string, string>): {
  deps: AppDependencies;
  db: MockDatabase;
  queue: MockQueue;
  env: MockEnv;
} {
  const db = new MockDatabase();
  const queue = new MockQueue();
  const env = new MockEnv(envValues);

  return {
    deps: { db, queue, env },
    db,
    queue,
    env,
  };
}
