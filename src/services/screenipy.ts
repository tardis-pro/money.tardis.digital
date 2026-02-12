import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ScreeniPyRunInput {
  tickerOption: string;
  executeOption: string;
}

export interface ScreeniPyRow {
  stock: string;
  ltp: string;
  volume: string;
  rsi: string;
  trend: string;
  pattern: string;
  ema20: string;
  ema50: string;
  sma20: string;
  sma50: string;
  macd: string;
  macdSignal: string;
  cci20: string;
  atr14: string;
  [key: string]: string;
}

function parseCsv(content: string): ScreeniPyRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return [];
  }
  const firstLine = lines[0];
  if (!firstLine) {
    return [];
  }
  const headers = firstLine.split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      row[headers[index] ?? `col_${index}`] = (values[index] ?? "").trim();
    }
    return {
      stock: row.Stock ?? row.stock ?? "",
      ltp: row.LTP ?? row.ltp ?? "",
      volume: row.Volume ?? row.volume ?? "",
      rsi: row.RSI ?? row.rsi ?? "",
      trend: row.Trend ?? row.trend ?? "",
      pattern: row.Pattern ?? row.pattern ?? "",
      ema20: row.EMA20 ?? row.ema20 ?? "",
      ema50: row.EMA50 ?? row.ema50 ?? "",
      sma20: row.SMA20 ?? row.sma20 ?? "",
      sma50: row.SMA50 ?? row.sma50 ?? "",
      macd: row.MACD ?? row.macd ?? "",
      macdSignal: row.MACDSignal ?? row.macdsignal ?? "",
      cci20: row.CCI20 ?? row.cci20 ?? "",
      atr14: row.ATR14 ?? row.atr14 ?? "",
      ...row,
    };
  });
}

export class ScreeniPyService {
  private readonly pythonExecutable: string;
  private readonly scriptPath: string;

  constructor() {
    this.pythonExecutable = process.env.SCREENIPY_PYTHON ?? "python3";
    this.scriptPath = process.env.SCREENIPY_SCRIPT_PATH ?? "src/screenipy.py";
  }

  async run(input: ScreeniPyRunInput): Promise<ScreeniPyRow[]> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "screenipy-"));
    const outFile = path.join(tempDir, "screenipy-output.csv");

    try {
      const args = [
        this.scriptPath,
        input.tickerOption,
        input.executeOption,
        "--output",
        outFile,
      ];

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
          reject(new Error(`Screeni-py exited with code ${code}: ${stderr}`));
        });
      });

      const csv = await readFile(outFile, "utf8");
      return parseCsv(csv);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
