const OPENAI_API_BASE = Deno.env.get('OPENAI_API_BASE') || 'https://api.openai.com/v1';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const EMBEDDING_MODEL = Deno.env.get('EMBEDDING_MODEL') || 'text-embedding-3-small';

interface EmbeddingResponse {
  data: { embedding: number[] }[];
  usage: { prompt_tokens: number; total_tokens: number };
}

export async function getEmbedding(text: string): Promise<Float32Array> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as EmbeddingResponse;

  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid embedding response');
  }

  return new Float32Array(data.data[0].embedding);
}

export async function getEmbeddings(texts: string[]): Promise<Float32Array[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (texts.length === 0) {
    return [];
  }

  const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as EmbeddingResponse;

  return data.data.map(item => new Float32Array(item.embedding));
}
