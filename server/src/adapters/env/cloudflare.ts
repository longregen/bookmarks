import type { Env } from './interface.ts';

// Map of environment variable keys to their corresponding WorkerEnv keys
const ENV_KEY_MAP: Record<string, string> = {
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  OPENAI_API_BASE: 'OPENAI_API_BASE',
  RP_ID: 'RP_ID',
  RP_NAME: 'RP_NAME',
  ORIGIN: 'ORIGIN',
  CORS_ORIGIN: 'CORS_ORIGIN',
  CHAT_MODEL: 'CHAT_MODEL',
  EMBEDDING_MODEL: 'EMBEDDING_MODEL',
};

export interface WorkerEnvBindings {
  OPENAI_API_KEY?: string;
  OPENAI_API_BASE?: string;
  RP_ID?: string;
  RP_NAME?: string;
  ORIGIN?: string;
  CORS_ORIGIN?: string;
  CHAT_MODEL?: string;
  EMBEDDING_MODEL?: string;
  [key: string]: unknown;
}

export class CloudflareEnv implements Env {
  private bindings: WorkerEnvBindings;

  constructor(bindings: WorkerEnvBindings) {
    this.bindings = bindings;
  }

  get(key: string): string | undefined {
    const mappedKey = ENV_KEY_MAP[key] || key;
    const value = this.bindings[mappedKey];
    return typeof value === 'string' ? value : undefined;
  }

  getRequired(key: string): string {
    const value = this.get(key);
    if (value === undefined) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }
}
