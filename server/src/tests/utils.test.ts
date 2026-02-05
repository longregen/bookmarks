import { assertEquals, assertMatch } from 'jsr:@std/assert';
import { generateId, now } from '../utils/common.ts';

Deno.test('generateId returns valid UUID v4 format', () => {
  const id = generateId();
  assertMatch(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

Deno.test('generateId returns unique values', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(generateId());
  }
  assertEquals(ids.size, 100);
});

Deno.test('now returns ISO 8601 timestamp', () => {
  const timestamp = now();
  assertMatch(timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

Deno.test('now returns current time', () => {
  const before = Date.now();
  const timestamp = now();
  const after = Date.now();

  const parsed = new Date(timestamp).getTime();
  assertEquals(parsed >= before, true);
  assertEquals(parsed <= after, true);
});
