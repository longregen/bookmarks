export interface Env {
  get(key: string): string | undefined;
  getRequired(key: string): string;
}
