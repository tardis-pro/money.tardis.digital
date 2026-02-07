import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface TrainModelInput {
  trainCsvPath: string;
  testCsvPath?: string | undefined;
  target?: string | undefined;
}

export interface TrainModelResult {
  modelPath: string;
  predictionsPath: string | null;
  metrics: {
    train: { count: number; mse: number; rmse: number; mae: number };
    validation: { count: number; mse: number; rmse: number; mae: number };
  };
}

export class ModelTrainingService {
  private readonly pythonExecutable: string;
  private readonly scriptPath: string;
  private readonly modelsDir: string;

  constructor() {
    this.pythonExecutable = process.env.MODEL_TRAIN_PYTHON ?? "python3";
    this.scriptPath = process.env.MODEL_TRAIN_SCRIPT ?? path.join(process.cwd(), "scripts/train_model.py");
    this.modelsDir = process.env.MODELS_DIR ?? path.join(process.cwd(), "data/models");
  }

  async train(input: TrainModelInput): Promise<TrainModelResult> {
    await mkdir(this.modelsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const modelPath = path.join(this.modelsDir, `model-${stamp}.json`);
    const predictionsPath = input.testCsvPath ? path.join(this.modelsDir, `predictions-${stamp}.csv`) : null;

    const args = [
      this.scriptPath,
      "--train",
      input.trainCsvPath,
      "--model-out",
      modelPath,
      "--target",
      input.target ?? "market_forward_excess_returns",
    ];
    if (input.testCsvPath && predictionsPath) {
      args.push("--test", input.testCsvPath, "--predictions-out", predictionsPath);
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.pythonExecutable, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Training script failed with code ${code}: ${stderr}`));
      });
    });

    const model = JSON.parse(await readFile(modelPath, "utf8")) as {
      metrics: TrainModelResult["metrics"];
    };

    return {
      modelPath,
      predictionsPath,
      metrics: model.metrics,
    };
  }
}
