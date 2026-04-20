import { assertEquals, assertMatch } from 'jsr:@std/assert';
import { generateId, now, preserveHtml } from '../utils/common.ts';

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

Deno.test('preserveHtml: larger incoming replaces existing', () => {
  const r = preserveHtml('<html>big</html>', '<p>small</p>');
  assertEquals(r.value, '<html>big</html>');
  assertEquals(r.changed, true);
});

Deno.test('preserveHtml: empty incoming does not clobber existing', () => {
  const r = preserveHtml('', '<html>existing</html>');
  assertEquals(r.value, '<html>existing</html>');
  assertEquals(r.changed, false);
});

Deno.test('preserveHtml: null/undefined incoming preserves existing', () => {
  assertEquals(preserveHtml(null, '<p>keep</p>').value, '<p>keep</p>');
  assertEquals(preserveHtml(undefined, '<p>keep</p>').value, '<p>keep</p>');
  assertEquals(preserveHtml(null, '<p>keep</p>').changed, false);
});

Deno.test('preserveHtml: shorter incoming preserves existing', () => {
  const r = preserveHtml('<p>x</p>', '<html><body>lots of content</body></html>');
  assertEquals(r.value, '<html><body>lots of content</body></html>');
  assertEquals(r.changed, false);
});

Deno.test('preserveHtml: identical length but different content replaces (last-write-wins on same-size)', () => {
  const r = preserveHtml('<b>xxx</b>', '<b>yyy</b>');
  assertEquals(r.value, '<b>xxx</b>');
  assertEquals(r.changed, true);
});

Deno.test('preserveHtml: identical content is not a change', () => {
  const r = preserveHtml('<p>same</p>', '<p>same</p>');
  assertEquals(r.value, '<p>same</p>');
  assertEquals(r.changed, false);
});

Deno.test('preserveHtml: empty on both sides is a no-op', () => {
  const r = preserveHtml('', '');
  assertEquals(r.value, '');
  assertEquals(r.changed, false);
});

Deno.test('preserveHtml: first capture (empty existing) accepted', () => {
  const r = preserveHtml('<html>first</html>', '');
  assertEquals(r.value, '<html>first</html>');
  assertEquals(r.changed, true);
});
