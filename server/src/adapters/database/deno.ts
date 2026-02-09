import { Database as SqliteDatabase } from '@db/sqlite';
import type { Database, PreparedStatement, BindValue } from './interface.ts';

class DenoStatement<T extends object = Record<string, unknown>> implements PreparedStatement<T> {
  private db: SqliteDatabase;
  private sql: string;
  private params: BindValue[] = [];

  constructor(db: SqliteDatabase, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  bind(...params: BindValue[]): PreparedStatement<T> {
    this.params = params;
    return this;
  }

  async first(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const result = stmt.get<T>(...this.params);
    return result ?? null;
  }

  async all(): Promise<T[]> {
    const stmt = this.db.prepare(this.sql);
    return stmt.all<T>(...this.params);
  }

  async run(): Promise<{ changes: number }> {
    const stmt = this.db.prepare(this.sql);
    stmt.run(...this.params);
    return { changes: this.db.changes };
  }
}

export class DenoDatabase implements Database {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  prepare<T extends object = Record<string, unknown>>(sql: string): PreparedStatement<T> {
    return new DenoStatement<T>(this.db, sql);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async batch(statements: PreparedStatement[]): Promise<void> {
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const stmt of statements) {
        await stmt.run();
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
