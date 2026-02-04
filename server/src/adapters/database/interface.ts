export type BindValue = null | number | string | bigint | Uint8Array;

export interface PreparedStatement<T extends object = Record<string, unknown>> {
  bind(...params: BindValue[]): PreparedStatement<T>;
  first(): Promise<T | null>;
  all(): Promise<T[]>;
  run(): Promise<{ changes: number }>;
}

export interface Database {
  prepare<T extends object = Record<string, unknown>>(sql: string): PreparedStatement<T>;
  exec(sql: string): Promise<void>;
  batch(statements: PreparedStatement[]): Promise<void>;
}
