import type { Store } from "../store.js";
import type { StreamEventRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

type StreamEventInput = Omit<StreamEventRecord, "id" | "publishedAt" | "sequence">;

export class StreamBusService {
  constructor(private readonly store: Store) {}

  async publish(input: StreamEventInput): Promise<StreamEventRecord> {
    return this.store.transaction((state) => {
      const event: StreamEventRecord = {
        id: makeId("stream"),
        type: input.type,
        payload: input.payload,
        sequence: state.streamSequence + 1,
        publishedAt: nowIso(),
      };
      state.streamSequence = event.sequence;
      state.streamEvents.push(event);
      if (state.streamEvents.length > 5000) {
        state.streamEvents = state.streamEvents.slice(-5000);
      }
      return event;
    });
  }

  async replay(fromSequence: number, limit: number = 200): Promise<StreamEventRecord[]> {
    const state = await this.store.read();
    return [...state.streamEvents]
      .filter((event) => event.sequence > fromSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);
  }

  async health(): Promise<{
    latestSequence: number;
    eventsLastMinute: number;
    eventsLastFiveMinutes: number;
    latestPublishedAt: string | null;
    estimatedLagMs: number | null;
  }> {
    const state = await this.store.read();
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const fiveMinutesAgo = now - 5 * 60_000;
    let eventsLastMinute = 0;
    let eventsLastFiveMinutes = 0;
    for (const event of state.streamEvents) {
      const at = Date.parse(event.publishedAt);
      if (!Number.isFinite(at)) {
        continue;
      }
      if (at >= oneMinuteAgo) {
        eventsLastMinute += 1;
      }
      if (at >= fiveMinutesAgo) {
        eventsLastFiveMinutes += 1;
      }
    }
    const latest = state.streamEvents[state.streamEvents.length - 1] ?? null;
    return {
      latestSequence: state.streamSequence,
      eventsLastMinute,
      eventsLastFiveMinutes,
      latestPublishedAt: latest?.publishedAt ?? null,
      estimatedLagMs: latest ? Math.max(0, now - Date.parse(latest.publishedAt)) : null,
    };
  }
}
