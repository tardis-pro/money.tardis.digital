import { z } from "zod";
import type { Store } from "../store.js";
import type { FeedbackRecord, ReviewState } from "../types.js";
import { makeId, nowIso } from "../utils.js";

export const feedbackInputSchema = z.object({
  signalId: z.string().min(1),
  label: z.enum(["useful", "noise", "wrong-mapping", "wrong-direction"]),
  notes: z.string().max(2_000).default(""),
});

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export class FeedbackService {
  constructor(private readonly store: Store) {}

  async create(input: FeedbackInput): Promise<FeedbackRecord> {
    const parsed = feedbackInputSchema.parse(input);
    return this.store.transaction((state) => {
      const signal = state.signals.find((entry) => entry.id === parsed.signalId);
      if (!signal) {
        throw new Error(`Unknown signal ${parsed.signalId}`);
      }
      const feedback: FeedbackRecord = {
        id: makeId("feedback"),
        signalId: parsed.signalId,
        label: parsed.label,
        notes: parsed.notes,
        reviewState: "pending",
        createdAt: nowIso(),
      };
      state.feedback.push(feedback);
      return feedback;
    });
  }

  async setReviewState(feedbackId: string, reviewState: ReviewState): Promise<FeedbackRecord> {
    return this.store.transaction((state) => {
      const entry = state.feedback.find((item) => item.id === feedbackId);
      if (!entry) {
        throw new Error(`Unknown feedback ${feedbackId}`);
      }
      entry.reviewState = reviewState;
      return entry;
    });
  }

  async list(): Promise<FeedbackRecord[]> {
    const state = await this.store.read();
    return state.feedback;
  }
}
