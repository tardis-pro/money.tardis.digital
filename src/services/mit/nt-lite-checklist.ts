import type {
  FundamentalSnapshot,
  MitChecklistItem,
  NTLiteChecklistResult,
} from "../../mit-types.js";
import { computeOpmSlope, countPositiveYears } from "./screener-adapter.js";

export interface ChecklistOptions {
  sector?: string | null;
  peerMedianPE?: number | null;
  promoterHolding1yAgoPct?: number | null;
}

const CHECKLIST_ITEMS: MitChecklistItem[] = [
  "rising-revenue-eps",
  "strong-fcf",
  "roce-above-15",
  "manageable-leverage",
  "improving-opm",
  "promoter-stable",
  "clean-audit",
  "valuation-sane",
];

export function evaluateNtLiteChecklist(
  snapshot: FundamentalSnapshot,
  options: ChecklistOptions = {},
): NTLiteChecklistResult {
  const sector = (options.sector ?? "").toLowerCase();
  const risingRevenueEps = evaluateRisingRevenueEps(snapshot);
  const strongFcf = evaluateStrongFcf(snapshot);
  const roceOrRoe = evaluateRoceRoe(snapshot, sector);
  const leverage = evaluateLeverage(snapshot, sector);
  const opm = evaluateOpm(snapshot);
  const promoter = evaluatePromoter(snapshot, options.promoterHolding1yAgoPct);
  const audit = evaluateAudit(snapshot);
  const valuation = evaluateValuation(snapshot, options.peerMedianPE ?? null);

  const items: NTLiteChecklistResult["items"] = {
    "rising-revenue-eps": risingRevenueEps,
    "strong-fcf": strongFcf,
    "roce-above-15": roceOrRoe,
    "manageable-leverage": leverage,
    "improving-opm": opm,
    "promoter-stable": promoter,
    "clean-audit": audit,
    "valuation-sane": valuation,
  };

  const passCount = CHECKLIST_ITEMS.reduce((sum, key) => sum + (items[key]?.pass ? 1 : 0), 0);
  return {
    ticker: snapshot.ticker,
    evaluatedAt: new Date().toISOString(),
    items,
    passCount,
    totalItems: 8,
    grade: toGrade(passCount),
  };
}

function evaluateRisingRevenueEps(snapshot: FundamentalSnapshot): { pass: boolean; value: string; detail: string } {
  const r3 = snapshot.revenueCAGR_3y;
  const e3 = snapshot.epsCAGR_3y;
  const r5 = snapshot.revenueCAGR_5y;
  const e5 = snapshot.epsCAGR_5y;

  const yoyRevenueUp = isYoYUp(snapshot.revenueHistory);
  const pass3 = r3 !== null && e3 !== null && r3 > 5 && e3 > 5;
  const pass5 = r5 !== null && e5 !== null && r5 > 5 && e5 > 5;
  const pass = (pass3 || pass5) && yoyRevenueUp;

  return {
    pass,
    value: `Rev 3y:${fmtPct(r3)} EPS 3y:${fmtPct(e3)} Rev 5y:${fmtPct(r5)} EPS 5y:${fmtPct(e5)}`,
    detail: pass
      ? pass3
        ? "Revenue and EPS growth exceed 5% over 3 years with positive latest YoY revenue"
        : "5-year growth is strong but recent trend is slower; latest YoY revenue is positive"
      : yoyRevenueUp
        ? "Growth thresholds are not met"
        : "Latest revenue year is not above previous year",
  };
}

function evaluateStrongFcf(snapshot: FundamentalSnapshot): { pass: boolean; value: string; detail: string } {
  const lastFive = snapshot.fcfHistory.slice(-5);
  const stats = countPositiveYears(lastFive);
  const pass = stats.total >= 5 && stats.positive >= 4 && stats.avgValue > 0;
  return {
    pass,
    value: `${stats.positive}/${stats.total} positive years, avg ${fmtNum(stats.avgValue)} Cr`,
    detail: pass
      ? "FCF is positive in at least 4 of last 5 years with positive average"
      : "FCF consistency requirement is not satisfied",
  };
}

function evaluateRoceRoe(snapshot: FundamentalSnapshot, sector: string): { pass: boolean; value: string; detail: string } {
  const isBfsi = sector.includes("bfsi") || sector.includes("bank") || sector.includes("nbfc") || sector.includes("insurance");
  const roce = snapshot.roce;
  const roe = snapshot.roe;

  const pass = isBfsi
    ? roe !== null && roe > 15
    : (roce !== null && roce > 15) || (roce === null && roe !== null && roe > 15);

  return {
    pass,
    value: `ROCE:${fmtPct(roce)} ROE:${fmtPct(roe)}`,
    detail: isBfsi
      ? "BFSI sector uses ROE threshold > 15%"
      : "Passes if ROCE > 15% or fallback ROE > 15% when ROCE is unavailable",
  };
}

function evaluateLeverage(snapshot: FundamentalSnapshot, sector: string): { pass: boolean; value: string; detail: string } {
  const isBfsi = sector.includes("bfsi") || sector.includes("bank") || sector.includes("nbfc") || sector.includes("insurance");
  const de = snapshot.debtToEquity;
  const ic = snapshot.interestCoverage;

  const pass = isBfsi
    ? ic === null || ic > 3
    : de === null || ic === null || de < 0.5 || ic > 3;

  return {
    pass,
    value: `D/E:${fmtNum(de)} IC:${fmtNum(ic)}`,
    detail: isBfsi
      ? "BFSI leverage uses interest coverage only"
      : "Passes with low D/E, strong interest coverage, or missing leverage risk",
  };
}

function evaluateOpm(snapshot: FundamentalSnapshot): { pass: boolean; value: string; detail: string } {
  const slope = computeOpmSlope(snapshot.opmHistory.slice(-5));
  const pass = slope === null ? false : slope >= 0;
  return {
    pass,
    value: `OPM slope:${fmtNum(slope)} (${snapshot.opmHistory.length} years)`,
    detail: slope === null
      ? "Insufficient OPM history"
      : slope > 0
        ? "Operating margin trend is improving"
        : slope === 0
          ? "Operating margin trend is stable"
          : "Operating margin trend is declining",
  };
}

function evaluatePromoter(
  snapshot: FundamentalSnapshot,
  promoterHolding1yAgoPct: number | null | undefined,
): { pass: boolean; value: string; detail: string } {
  const hold = snapshot.promoterHoldingPct;
  const pledge = snapshot.promoterPledgePct;
  const stable = hold !== null && promoterHolding1yAgoPct !== null && promoterHolding1yAgoPct !== undefined
    ? hold >= promoterHolding1yAgoPct
    : true;
  const pass = stable && (pledge === null || pledge < 5);

  return {
    pass,
    value: `Promoter:${fmtPct(hold)} Pledge:${fmtPct(pledge)}`,
    detail: promoterHolding1yAgoPct === null || promoterHolding1yAgoPct === undefined
      ? "Historical promoter holding unavailable; pledge threshold applied"
      : stable
        ? "Promoter holding is stable/rising and pledge is acceptable"
        : "Promoter holding declined against prior year",
  };
}

function evaluateAudit(snapshot: FundamentalSnapshot): { pass: boolean; value: string; detail: string } {
  const remark = snapshot.auditorRemarks;
  const pass = remark === "clean" || remark === "unknown";
  return {
    pass,
    value: `Audit:${remark}`,
    detail: remark === "unknown"
      ? "Audit status unknown; treated as pass with warning"
      : pass
        ? "Audit remarks are clean"
        : "Audit remarks are adverse or qualified",
  };
}

function evaluateValuation(
  snapshot: FundamentalSnapshot,
  peerMedianPE: number | null,
): { pass: boolean; value: string; detail: string } {
  const peg = snapshot.peg;
  const pe = snapshot.pe;
  const pegPass = peg !== null && peg >= 0 && peg <= 1.2;
  const pePass = pe !== null && peerMedianPE !== null && pe < peerMedianPE;
  const pass = pegPass || pePass;

  return {
    pass,
    value: `PEG:${fmtNum(peg)} PE:${fmtNum(pe)} PeerMedianPE:${fmtNum(peerMedianPE)}`,
    detail: peg !== null && peg < 0
      ? "Negative PEG indicates declining earnings trend"
      : pass
        ? "Valuation is acceptable by PEG or peer-relative P/E"
        : "Valuation fails both PEG and peer-relative P/E checks",
  };
}

function isYoYUp(values: { fy: string; value: number }[]): boolean {
  if (values.length < 2) {
    return false;
  }
  const sorted = [...values].sort((a, b) => a.fy.localeCompare(b.fy));
  const prev = sorted[sorted.length - 2]?.value;
  const last = sorted[sorted.length - 1]?.value;
  if (prev === undefined || last === undefined) {
    return false;
  }
  return last > prev;
}

function toGrade(passCount: number): "A" | "B" | "C" | "F" {
  if (passCount >= 7) {
    return "A";
  }
  if (passCount >= 5) {
    return "B";
  }
  if (passCount >= 3) {
    return "C";
  }
  return "F";
}

function fmtPct(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)}%`;
}

function fmtNum(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}
