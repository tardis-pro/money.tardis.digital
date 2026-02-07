import type { ImpactAssessment, Prediction } from "../types.js";
import { clamp } from "../utils.js";

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export class PredictionService {
  predict(impact: ImpactAssessment): Prediction {
    const directionBias =
      impact.direction === "positive" ? 0.8 : impact.direction === "negative" ? -0.8 : 0;
    const horizonWeight = impact.horizon === "intraday" ? 0.5 : impact.horizon === "1D" ? 0.7 : 0.9;
    const base = directionBias + impact.magnitude * 1.3 + impact.confidence * 1.1 - 1;
    const probabilityUp = clamp(logistic(base * horizonWeight), 0.01, 0.99);
    const probabilityDown = clamp(1 - probabilityUp, 0.01, 0.99);
    const calibratedConfidence = clamp((impact.confidence + Math.abs(probabilityUp - 0.5) * 1.2) / 2, 0, 1);

    return {
      probabilityUp,
      probabilityDown,
      calibratedConfidence,
      modelVersion: "predictor-v1",
    };
  }
}
