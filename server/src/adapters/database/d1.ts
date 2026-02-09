import type { Database, PreparedStatement, BindValue } from './interface.ts';

// D1Database type from Cloudflare Workers
interface D1Result<T> {
  results: T[];
  success: boolean;
  meta: { changes: number; duration: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}

export interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1Result<unknown>>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

class D1Statement<T extends object = Record<string, unknown>> implements PreparedStatement<T> {
  private stmt: D1PreparedStatement;

  constructor(stmt: D1PreparedStatement) {
    this.stmt = stmt;
  }

  bind(...params: BindValue[]): PreparedStatement<T> {
    this.stmt = this.stmt.bind(...params);
    return this;
  }

  async first(): Promise<T | null> {
    return await this.stmt.first<T>();
  }

  async all(): Promise<T[]> {
    const result = await this.stmt.all<T>();
    return result.results;
  }

  async run(): Promise<{ changes: number }> {
    const result = await this.stmt.run();
    return { changes: result.meta.changes };
  }
}

export class D1Database implements Database {
  private db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.db = db;
  }

  prepare<T extends object = Record<string, unknown>>(sql: string): PreparedStatement<T> {
    return new D1Statement<T>(this.db.prepare(sql));
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async batch(statements: PreparedStatement[]): Promise<void> {
    // Execute statements sequentially since we can't easily extract the underlying D1 statements
    for (const stmt of statements) {
      await stmt.run();
    }
  }
}
