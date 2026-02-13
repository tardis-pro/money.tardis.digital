import type { FundamentalSnapshot } from "../../mit-types.js";

export interface GovernanceFilterResult {
  pass: boolean;
  reasons: string[];
}

export interface LiquidityCheckResult {
  pass: boolean;
  turnoverCr: number;
  reason: string | null;
}

const MIN_TURNOVER_CR = 5;
const MIN_PRICE = 50;
const MAX_DEBT_EQUITY = 1.0;
const MIN_ROCE_ROE = 15;

export function checkLiquidity(price: number, avgVolume: number): LiquidityCheckResult {
  const turnover = price * avgVolume;
  const turnoverCr = turnover / 10_000_000;

  if (turnoverCr < MIN_TURNOVER_CR) {
    return {
      pass: false,
      turnoverCr,
      reason: `Daily turnover ₹${turnoverCr.toFixed(1)}Cr below ₹${MIN_TURNOVER_CR}Cr threshold`,
    };
  }

  return {
    pass: true,
    turnoverCr,
    reason: null,
  };
}

export function checkPennyStock(price: number): boolean {
  return price < MIN_PRICE;
}

export function evaluateHardGovernanceFilters(snapshot: FundamentalSnapshot): GovernanceFilterResult {
  const reasons: string[] = [];

  const roce = snapshot.roce;
  const roe = snapshot.roe;
  if ((roce ?? Number.NEGATIVE_INFINITY) < MIN_ROCE_ROE && (roe ?? Number.NEGATIVE_INFINITY) < MIN_ROCE_ROE) {
    reasons.push("ROCE/ROE below threshold");
  }

  if (snapshot.debtToEquity !== null && snapshot.debtToEquity > MAX_DEBT_EQUITY) {
    reasons.push(`Debt/Equity above ${MAX_DEBT_EQUITY}`);
  }

  if (snapshot.interestCoverage !== null && snapshot.interestCoverage < 3) {
    reasons.push("Interest coverage below 3");
  }

  if (snapshot.promoterPledgePct !== null && snapshot.promoterPledgePct > 5) {
    reasons.push("Promoter pledge above 5%");
  }

  if (snapshot.auditorRemarks !== "clean") {
    reasons.push("Auditor remarks not clean");
  }

  const lastThreeFcf = snapshot.fcfHistory.slice(-3);
  const negativeFcf = lastThreeFcf.filter((item) => item.value < 0).length;
  if (lastThreeFcf.length >= 3 && negativeFcf >= 2) {
    reasons.push("FCF negative in at least 2 of last 3 years");
  }

  return { pass: reasons.length === 0, reasons };
}
