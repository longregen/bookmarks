import { getPlatformAdapter } from './platform';
import { getSettings } from './settings';
import { config } from './config-registry';

interface QAPair {
  question: string;
  answer: string;
}

interface EmbeddingData {
  embedding: number[];
  index: number;
  object: string;
}

interface EmbeddingsResponse {
  data: EmbeddingData[];
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

const QA_SYSTEM_PROMPT = `You are a helpful assistant that generates question-answer pairs for semantic search retrieval.

Given a document, generate 5-10 diverse Q&A pairs that:
1. Cover the main topics and key facts in the document
2. Include both factual questions ("What is X?") and conceptual questions ("How does X work?")
3. Would help someone find this document when searching with related queries
4. Have concise but complete answers (1-3 sentences each)

Respond with JSON only, no other text. Format:
{"pairs": [{"question": "...", "answer": "..."}, ...]}`;

export async function generateQAPairs(markdownContent: string): Promise<QAPair[]> {
  const settings = await getPlatformAdapter().getSettings();

  if (!settings.apiKey) {
    throw new Error('API key not configured. Please set your API key in the extension options.');
  }

  // Truncate content to avoid exceeding context window
  const truncatedContent = markdownContent.slice(0, config.API_CONTENT_MAX_CHARS);

  const response = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.chatModel,
      messages: [
        { role: 'system', content: QA_SYSTEM_PROMPT },
        { role: 'user', content: truncatedContent },
      ],
      response_format: { type: 'json_object' },
      temperature: config.API_CHAT_TEMPERATURE,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Chat API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from chat API');
  }

  const parsed = JSON.parse(content);
  return parsed.pairs || [];
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const settings = await getPlatformAdapter().getSettings();

  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Embeddings API] Starting embedding generation', {
      inputCount: texts.length,
      inputLengths: texts.map(t => t.length),
      model: settings.embeddingModel,
      apiBaseUrl: settings.apiBaseUrl,
    });
  }

  if (!settings.apiKey) {
    throw new Error('API key not configured.');
  }

  const response = await fetch(`${settings.apiBaseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.embeddingModel,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    if (__DEBUG_EMBEDDINGS__) {
      console.error('[Embeddings API] API error response', {
        status: response.status,
        error,
      });
    }
    throw new Error(`Embeddings API error: ${response.status} - ${error}`);
  }

  const data: EmbeddingsResponse = await response.json();

  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Embeddings API] Raw API response', {
      hasData: !!data.data,
      dataLength: data.data?.length,
      model: data.model,
      usage: data.usage,
    });
  }

  // Sort by index to ensure correct order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((item) => item.embedding);

  if (__DEBUG_EMBEDDINGS__) {
    // Debug: Validate embeddings
    console.log('[Embeddings API] Extracted embeddings', {
      count: embeddings.length,
      dimensions: embeddings.map((e: number[] | undefined) => e?.length ?? 'undefined'),
      allSameDimension: embeddings.every((e: number[] | undefined) => e?.length === embeddings[0]?.length),
      firstEmbeddingSample: embeddings[0]?.slice(0, 5),
    });

    // Validate each embedding
    embeddings.forEach((embedding: number[] | undefined, index: number) => {
      if (!embedding) {
        console.error(`[Embeddings API] Embedding at index ${index} is undefined`);
      } else if (!Array.isArray(embedding)) {
        console.error(`[Embeddings API] Embedding at index ${index} is not an array:`, typeof embedding);
      } else if (embedding.length === 0) {
        console.error(`[Embeddings API] Embedding at index ${index} is empty`);
      }
    });
  }

  return embeddings;
}
