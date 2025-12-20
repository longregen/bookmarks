import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';

export class EmbeddingCodecError extends Data.TaggedError('EmbeddingCodecError')<{
  readonly operation: 'encode' | 'decode' | 'validate';
  readonly reason: string;
  readonly cause?: unknown;
}> {}

const QUANTIZE_SCALE = 32767;

export function encodeEmbedding(
  embedding: readonly number[]
): Effect.Effect<string, EmbeddingCodecError> {
  return Effect.try({
    try: () => {
      const buffer = new ArrayBuffer(embedding.length * 2);
      const view = new Int16Array(buffer);

      for (let i = 0; i < embedding.length; i++) {
        const clamped = Math.max(-1, Math.min(1, embedding[i]));
        view[i] = Math.round(clamped * QUANTIZE_SCALE);
      }

      return arrayBufferToBase64(buffer);
    },
    catch: (error) =>
      new EmbeddingCodecError({
        operation: 'encode',
        reason: 'Failed to encode embedding',
        cause: error,
      }),
  });
}

export function decodeEmbedding(
  encoded: string
): Effect.Effect<number[], EmbeddingCodecError> {
  return Effect.try({
    try: () => {
      const buffer = base64ToArrayBuffer(encoded);
      const view = new Int16Array(buffer);
      const embedding = new Array<number>(view.length);

      for (let i = 0; i < view.length; i++) {
        embedding[i] = view[i] / QUANTIZE_SCALE;
      }

      return embedding;
    },
    catch: (error) =>
      new EmbeddingCodecError({
        operation: 'decode',
        reason: 'Failed to decode embedding - invalid base64 string',
        cause: error,
      }),
  });
}

export function isEncodedEmbedding(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.length >= 4 && /^[A-Za-z0-9+/]+=*$/.test(value);
}

export function validateEncodedEmbedding(
  value: unknown
): Effect.Effect<string, EmbeddingCodecError> {
  return Effect.sync(() => {
    if (!isEncodedEmbedding(value)) {
      throw new EmbeddingCodecError({
        operation: 'validate',
        reason: 'Value is not a valid encoded embedding',
        cause: { value },
      });
    }
    return value;
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
