/**
 * Embedding Codec - Efficient encoding/decoding for embedding vectors
 *
 * Embeddings are arrays of floats in the range [-1, 1]. Instead of storing
 * them as JSON arrays of numbers (which is very verbose), we:
 *
 * 1. Quantize each float to a 16-bit signed integer (-32767 to 32767)
 * 2. Pack the integers into a binary buffer
 * 3. Base64 encode the result
 *
 * This reduces storage by roughly 75% compared to JSON arrays:
 * - JSON: ~20 bytes per float (e.g., "-0.12345678901234")
 * - Encoded: 2 bytes per float + base64 overhead (~2.67 bytes final)
 *
 * Precision: 16 bits gives ~4.5 decimal digits, which is more than enough
 * for embedding similarity calculations (typically 6-8 bits suffice).
 */

// Maximum value for 16-bit quantization (we use 32767 to keep symmetry around 0)
const QUANTIZE_SCALE = 32767;

/**
 * Encode an embedding array (floats in [-1, 1]) to a base64 string
 */
export function encodeEmbedding(embedding: number[]): string {
  // Create a buffer for 16-bit integers (2 bytes each)
  const buffer = new ArrayBuffer(embedding.length * 2);
  const view = new Int16Array(buffer);

  for (let i = 0; i < embedding.length; i++) {
    // Clamp to [-1, 1] and quantize to 16-bit signed integer
    const clamped = Math.max(-1, Math.min(1, embedding[i]));
    view[i] = Math.round(clamped * QUANTIZE_SCALE);
  }

  // Convert to base64
  return arrayBufferToBase64(buffer);
}

/**
 * Decode a base64 string back to an embedding array
 */
export function decodeEmbedding(encoded: string): number[] {
  const buffer = base64ToArrayBuffer(encoded);
  const view = new Int16Array(buffer);
  const embedding: number[] = new Array(view.length);

  for (let i = 0; i < view.length; i++) {
    // Convert back to float in [-1, 1]
    embedding[i] = view[i] / QUANTIZE_SCALE;
  }

  return embedding;
}

/**
 * Calculate the maximum error introduced by the encoding
 * This is useful for testing - the max error should be ~1/32767 ≈ 0.0000305
 */
export function maxQuantizationError(): number {
  return 1 / QUANTIZE_SCALE;
}

/**
 * Calculate size reduction ratio compared to JSON encoding
 */
export function compressionRatio(embedding: number[]): {
  jsonSize: number;
  encodedSize: number;
  ratio: number;
} {
  const jsonSize = JSON.stringify(embedding).length;
  const encodedSize = encodeEmbedding(embedding).length;
  return {
    jsonSize,
    encodedSize,
    ratio: jsonSize / encodedSize,
  };
}

/**
 * Check if a string looks like an encoded embedding (base64)
 */
export function isEncodedEmbedding(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Base64 strings are alphanumeric with + / and = padding
  // Minimum length for a non-trivial embedding (at least a few values)
  return value.length >= 4 && /^[A-Za-z0-9+/]+=*$/.test(value);
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
