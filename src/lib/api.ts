import { getPlatformAdapter } from './platform';
import { config } from './config-registry';
import { getErrorMessage } from './errors';
import { createDebugLog, debugOnly } from './debug';

const debugLog = createDebugLog('Embeddings API');

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

function calculateBackoffDelay(retryCount: number, isRateLimited: boolean): number {
  const baseDelay = config.QUEUE_RETRY_BASE_DELAY_MS;
  const maxDelay = config.QUEUE_RETRY_MAX_DELAY_MS;
  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  const jitter = delay * 0.25 * Math.random();
  const finalDelay = delay + jitter;

  // For rate limiting (429), use 3x the normal delay
  return isRateLimited ? finalDelay * 3 : finalDelay;
}

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

  const maxRetries = config.QUEUE_MAX_RETRIES;
  const timeout = config.FETCH_TIMEOUT_MS;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${settings.apiBaseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();
          const isRateLimited = response.status === 429;

          // Don't retry on client errors (except 429)
          if (response.status >= 400 && response.status < 500 && !isRateLimited) {
            throw new Error(`API error: ${response.status} - ${error}`);
          }

          // For server errors and rate limiting, we'll retry
          if (attempt < maxRetries) {
            const backoffDelay = calculateBackoffDelay(attempt, isRateLimited);
            debugLog(`API request failed (${response.status}), retrying in ${Math.round(backoffDelay)}ms (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(backoffDelay);
            continue;
          }

          throw new Error(`API error: ${response.status} - ${error}`);
        }

        return await response.json() as T;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If it's an abort error (timeout), retry
      if (lastError.name === 'AbortError') {
        if (attempt < maxRetries) {
          const backoffDelay = calculateBackoffDelay(attempt, false);
          debugLog(`API request timed out, retrying in ${Math.round(backoffDelay)}ms (attempt ${attempt + 1}/${maxRetries})`);
          await sleep(backoffDelay);
          continue;
        }
        throw new Error(`API request timed out after ${timeout}ms`);
      }

      // If it's a network error, retry
      if (lastError.message.includes('fetch') || lastError.message.includes('network')) {
        if (attempt < maxRetries) {
          const backoffDelay = calculateBackoffDelay(attempt, false);
          debugLog(`Network error, retrying in ${Math.round(backoffDelay)}ms (attempt ${attempt + 1}/${maxRetries})`);
          await sleep(backoffDelay);
          continue;
        }
      }

      // For other errors (like client errors), throw immediately
      throw lastError;
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('API request failed after all retries');
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
