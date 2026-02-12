import type { FundamentalSnapshot } from "../../mit-types.js";

export interface GovernanceFilterResult {
  pass: boolean;
  reasons: string[];
}

export function evaluateHardGovernanceFilters(snapshot: FundamentalSnapshot): GovernanceFilterResult {
  const reasons: string[] = [];

  const roce = snapshot.roce;
  const roe = snapshot.roe;
  if ((roce ?? Number.NEGATIVE_INFINITY) < 15 && (roe ?? Number.NEGATIVE_INFINITY) < 15) {
    reasons.push("ROCE/ROE below threshold");
  }

  if (snapshot.debtToEquity !== null && snapshot.debtToEquity > 0.5) {
    reasons.push("Debt/Equity above 0.5");
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
