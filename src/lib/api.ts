import { getPlatformAdapter } from './platform';
import { config } from './config-registry';
import { getErrorMessage } from './errors';
import { createDebugLog, debugOnly } from './debug';

const debugLog = createDebugLog('Embeddings API');

export interface QAPair {
  question: string;
  answer: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
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

interface ApiSettings {
  apiKey: string;
  apiBaseUrl: string;
}

export async function makeApiRequest<T>(
  endpoint: string,
  body: object,
  settings: ApiSettings
): Promise<T> {
  if (!settings.apiKey) {
    throw new Error('API key not configured. Please set your API key in the extension options.');
  }

  const response = await fetch(`${settings.apiBaseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  return await response.json() as T;
}

export async function generateQAPairs(markdownContent: string): Promise<QAPair[]> {
  const settings = await getPlatformAdapter().getSettings();
  const truncatedContent = markdownContent.slice(0, config.API_CONTENT_MAX_CHARS);

  const data = await makeApiRequest<ChatCompletionResponse>('/chat/completions', {
    model: settings.chatModel,
    messages: [
      { role: 'system', content: config.QA_SYSTEM_PROMPT },
      { role: 'user', content: truncatedContent },
    ],
    response_format: { type: 'json_object' },
    ...(config.API_CHAT_USE_TEMPERATURE && { temperature: config.API_CHAT_TEMPERATURE }),
  }, settings);

  const content = data.choices.at(0)?.message.content;
  if (content === undefined) {
    throw new Error('Empty response from chat API');
  }

  try {
    const parsed = JSON.parse(content) as { pairs?: QAPair[] };
    return parsed.pairs ?? [];
  } catch (error) {
    throw new Error(`Failed to parse Q&A pairs from API response: ${getErrorMessage(error)}`);
  }
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const settings = await getPlatformAdapter().getSettings();
  debugLog('Starting embedding generation', {
    inputCount: texts.length,
    inputLengths: texts.map(t => t.length),
    model: settings.embeddingModel,
    apiBaseUrl: settings.apiBaseUrl,
  });

  let data: EmbeddingsResponse;
  try {
    data = await makeApiRequest<EmbeddingsResponse>('/embeddings', {
      model: settings.embeddingModel,
      input: texts,
    }, settings);
  } catch (error) {
    debugLog('API error response', error);
    throw error;
  }

  debugLog('Raw API response', {
    dataLength: data.data.length,
    model: data.model,
    usage: data.usage,
  });

  const sorted = data.data.sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((item) => item.embedding);

  debugOnly(() => {
    debugLog('Extracted embeddings', {
      count: embeddings.length,
      dimensions: embeddings.map((e) => e.length),
      allSameDimension: embeddings.length > 0 && embeddings.every((e) => e.length === embeddings[0].length),
      firstEmbeddingSample: embeddings.length > 0 ? embeddings[0].slice(0, 5) : [],
    });

    embeddings.forEach((embedding, index) => {
      if (embedding.length === 0) {
        console.error(`[Embeddings API] Embedding at index ${index} is empty`);
      }
    });
  });

  return embeddings;
}
