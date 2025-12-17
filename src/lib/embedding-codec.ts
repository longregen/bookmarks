const QUANTIZE_SCALE = 32767;

export function encodeEmbedding(embedding: number[]): string {
  const buffer = new ArrayBuffer(embedding.length * 2);
  const view = new Int16Array(buffer);

  for (let i = 0; i < embedding.length; i++) {
    const clamped = Math.max(-1, Math.min(1, embedding[i]));
    view[i] = Math.round(clamped * QUANTIZE_SCALE);
  }

  return arrayBufferToBase64(buffer);
}

export function decodeEmbedding(encoded: string): number[] {
  const buffer = base64ToArrayBuffer(encoded);
  const view = new Int16Array(buffer);
  const embedding = new Array<number>(view.length);

  for (let i = 0; i < view.length; i++) {
    embedding[i] = view[i] / QUANTIZE_SCALE;
  }

  return embedding;
}

export function maxQuantizationError(): number {
  return 1 / QUANTIZE_SCALE;
}

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

export function isEncodedEmbedding(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.length >= 4 && /^[A-Za-z0-9+/]+=*$/.test(value);
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
