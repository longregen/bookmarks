import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { QAGenerationError } from '../lib/errors';

/**
 * Service for generating question-answer pairs from content
 */
export class QAService extends Context.Tag('QAService')<
  QAService,
  {
    readonly generatePairs: (
      markdownContent: string
    ) => Effect.Effect<
      Array<{ question: string; answer: string }>,
      QAGenerationError,
      never
    >;
  }
>() {}
