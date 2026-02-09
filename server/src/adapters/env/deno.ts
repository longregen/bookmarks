import type { Env } from './interface.ts';

export class DenoEnv implements Env {
  get(key: string): string | undefined {
    return Deno.env.get(key);
  }

  getRequired(key: string): string {
    const value = Deno.env.get(key);
    if (value === undefined) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }
}
