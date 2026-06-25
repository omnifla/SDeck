import type { BusEventMap, EventBus } from "../types";

type Handler<T> = (payload: T) => void;

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<Handler<unknown>>>();

  function getSet(event: string): Set<Handler<unknown>> {
    if (!listeners.has(event)) listeners.set(event, new Set());
    return listeners.get(event)!;
  }

  return {
    emit<K extends keyof BusEventMap>(event: K, payload: BusEventMap[K]) {
      const handlers = listeners.get(event as string);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[bus] handler error on "${event}":`, err);
        }
      }
    },

    on<K extends keyof BusEventMap>(
      event: K,
      handler: Handler<BusEventMap[K]>,
    ) {
      getSet(event as string).add(handler as Handler<unknown>);
      // Returns an unsubscribe function
      return () => this.off(event, handler);
    },

    off<K extends keyof BusEventMap>(
      event: K,
      handler: Handler<BusEventMap[K]>,
    ) {
      listeners.get(event as string)?.delete(handler as Handler<unknown>);
    },
  };
}
