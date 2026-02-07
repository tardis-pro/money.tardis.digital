import type { Store } from "../store.js";

export interface LearningLoopReport {
  validatedFeedback: number;
  precisionUseful: number;
  precisionNoise: number;
  suggestedAction: string;
  modelVersion: string;
}

export class LearningLoopService {
  constructor(private readonly store: Store) {}

  async runRecalibration(): Promise<LearningLoopReport> {
    const state = await this.store.read();
    const validated = state.feedback.filter((item) => item.reviewState === "validated");

    const useful = validated.filter((item) => item.label === "useful").length;
    const noise = validated.filter((item) => item.label === "noise").length;
    const total = Math.max(1, validated.length);

    const precisionUseful = useful / total;
    const precisionNoise = noise / total;
    const suggestedAction =
      precisionNoise > 0.35
        ? "Tighten alert threshold and downgrade noisy source tiers"
        : "Maintain threshold and retrain calibration using validated labels";

    return {
      validatedFeedback: validated.length,
      precisionUseful,
      precisionNoise,
      suggestedAction,
      modelVersion: "predictor-v1",
    };
  }
}
