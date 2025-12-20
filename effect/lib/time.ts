import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from './effect-utils';

export class TimeService extends Context.Tag('TimeService')<
  TimeService,
  {
    now(): Effect.Effect<Date, never>;
    formatTimeAgo(date: Date): Effect.Effect<string, never>;
  }
>() {}

export const TimeServiceLive: Layer.Layer<TimeService, never> = makeLayer(
  TimeService,
  {
    now: () => Effect.sync(() => new Date()),

    formatTimeAgo: (date: Date) =>
      Effect.sync(() => {
        const now = new Date();
        const diff = now.getTime() - new Date(date).getTime();
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'Just now';
        if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
        return new Date(date).toLocaleDateString();
      }),
  }
);

export const now = (): Effect.Effect<Date, never, TimeService> =>
  Effect.gen(function* () {
    const timeService = yield* TimeService;
    return yield* timeService.now();
  });

export const formatTimeAgo = (
  date: Date
): Effect.Effect<string, never, TimeService> =>
  Effect.gen(function* () {
    const timeService = yield* TimeService;
    return yield* timeService.formatTimeAgo(date);
  });

export function formatTimeAgoPure(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(date).toLocaleDateString();
}

export const TimeServiceTest = (
  fixedNow: Date
): Layer.Layer<TimeService, never> =>
  makeLayer(
    TimeService,
    {
      now: () => Effect.sync(() => new Date(fixedNow)),

      formatTimeAgo: (date: Date) =>
        Effect.sync(() => {
          const diff = fixedNow.getTime() - new Date(date).getTime();
          const seconds = Math.floor(diff / 1000);
          const minutes = Math.floor(seconds / 60);
          const hours = Math.floor(minutes / 60);
          const days = Math.floor(hours / 24);

          if (seconds < 60) return 'Just now';
          if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
          if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
          if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
          return new Date(date).toLocaleDateString();
        }),
    }
  );
