import { z } from "zod";
import mitUniverseRaw from "../../config/mit-universe.json" with { type: "json" };
import type { MitUniverseEntry } from "../../mit-types.js";

const MitUniverseEntrySchema = z.object({
  ticker: z.string().min(1),
  name: z.string().min(1),
  exchange: z.enum(["NSE", "BSE"]),
  sector: z.string().min(1),
  subSector: z.string().min(1),
  marketCapTier: z.enum(["large", "mid", "small"]),
  nifty50: z.boolean(),
  nifty500: z.boolean(),
});

const MitUniverseSchema = z.array(MitUniverseEntrySchema);

function loadUniverse(): MitUniverseEntry[] {
  const parsed = MitUniverseSchema.safeParse(mitUniverseRaw);
  if (!parsed.success) {
    // Fail fast at startup — a malformed universe file means every downstream
    // sector lookup, analyst agent, and hero pick would silently misbehave.
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `mit-universe.json failed validation (${parsed.error.issues.length} issue(s)): ${issues}`
    );
  }
  return parsed.data;
}

export const MIT_UNIVERSE: readonly MitUniverseEntry[] = Object.freeze(loadUniverse());
