import type {
  MitPortfolioState,
  MitPortfolioResponse,
  MitPosition,
  MitSettings,
  MitState,
  TradeConfirmRequest,
  TradeEnterRequest,
  TradeExitRequest,
} from "../../mit-types.js";
import { makeId } from "../../utils.js";
import { sizePosition } from "./position-sizer.js";

export function makeDefaultPortfolioState(): MitPortfolioState {
  return {
    settings: {
      capital: 200000,
      allocPct: 0.05,
      stopPct: 0.06,
      pauseCashPct: 0.03,
      maxDeployedPct: 0.95,
      maxHorizonDays: 90,
      trailingActivationPct: 0.75,
    },
    cash: 200000,
    positions: [],
    closedTrades: [],
    equityCurve: [],
    peakEquity: 200000,
    maxDrawdownPct: 0,
    paused: false,
    lastPipelineRun: null,
  };
}

export class MitPortfolioService {
  updateSettings(state: MitState, input: Partial<MitSettings>): MitPortfolioState {
    const previousCapital = state.portfolio.settings.capital;
    state.portfolio.settings = { ...state.portfolio.settings, ...input };
    if (input.capital !== undefined && input.capital !== previousCapital) {
      state.portfolio.cash += input.capital - previousCapital;
    }
    return state.portfolio;
  }

  enterTrade(state: MitState, input: TradeEnterRequest): { ok: boolean; reason?: string } {
    const portfolio = state.portfolio;
    const sizing = sizePosition(
      portfolio.settings,
      portfolio,
      input.entryPrice,
      input.stopLoss,
      input.customAllocPct,
      input.qty,
    );
    if (!sizing.approved) {
      return { ok: false, reason: sizing.rejectionReason ?? "Rejected" };
    }
    const now = new Date().toISOString();
    const cost = sizing.units * input.entryPrice;
    const position: MitPosition = {
      id: makeId("mit-pos"),
      ticker: input.ticker.toUpperCase(),
      feed: input.feed,
      entryPrice: input.entryPrice,
      entryDate: input.entryDate ?? now.slice(0, 10),
      qty: sizing.units,
      allocatedAmount: sizing.allocatedAmount,
      stopLoss: input.stopLoss,
      firstTarget: input.firstTarget,
      status: "open",
      trailingActive: false,
      trailingStop: null,
      maxPriceSinceEntry: input.entryPrice,
      minPriceSinceEntry: input.entryPrice,
      currentPrice: input.entryPrice,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      pnlLockState: "estimated",
      pnlLockedAt: null,
      activeSellIndicators: [],
      dismissedIndicators: [],
      confirmedEntry: true,
      notes: input.notes ?? "",
      createdAt: now,
      updatedAt: now,
    };

    portfolio.positions.push(position);
    portfolio.cash = round2(portfolio.cash - cost);
    return { ok: true };
  }

  confirmEntry(state: MitState, input: TradeConfirmRequest): { ok: boolean; reason?: string } {
    const pos = state.portfolio.positions.find((p) => p.id === input.positionId);
    if (!pos) {
      return { ok: false, reason: "Position not found" };
    }
    const previousCost = pos.entryPrice * pos.qty;
    const newCost = input.entryPrice * pos.qty;
    const delta = newCost - previousCost;

    if (state.portfolio.cash - delta < 0) {
      return { ok: false, reason: "Insufficient cash to confirm entry" };
    }

    state.portfolio.cash = round2(state.portfolio.cash - delta);
    pos.allocatedAmount = round2(newCost);
    pos.entryPrice = input.entryPrice;
    pos.entryDate = input.entryDate ?? pos.entryDate;
    pos.confirmedEntry = true;
    pos.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  exitTrade(state: MitState, input: TradeExitRequest): { ok: boolean; reason?: string } {
    const portfolio = state.portfolio;
    const pos = portfolio.positions.find((p) => p.id === input.positionId);
    if (!pos) {
      return { ok: false, reason: "Position not found" };
    }
    if (pos.qty <= 0 || input.qty <= 0 || input.qty > pos.qty) {
      return { ok: false, reason: "Invalid quantity" };
    }
    const now = new Date().toISOString();
    const qty = input.qty;
    const fees = round2(input.exitPrice * qty * 0.002);
    const realizedPnl = round2((input.exitPrice - pos.entryPrice) * qty - fees);
    const realizedPnlPct = pos.entryPrice > 0 ? ((input.exitPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
    const initialRisk = pos.entryPrice - pos.stopLoss;
    const realizedRMultiple = initialRisk > 0 ? (input.exitPrice - pos.entryPrice) / initialRisk : 0;

    portfolio.closedTrades.push({
      id: makeId("mit-trade"),
      positionId: pos.id,
      ticker: pos.ticker,
      feed: pos.feed,
      entryPrice: pos.entryPrice,
      entryDate: pos.entryDate,
      exitPrice: input.exitPrice,
      exitDate: input.exitDate ?? now.slice(0, 10),
      qty,
      realizedPnl,
      realizedPnlPct,
      realizedRMultiple,
      holdDays: holdDays(pos.entryDate, input.exitDate ?? now.slice(0, 10)),
      exitReason: qty < pos.qty ? "partial" : input.reason,
      fees,
    });

    pos.qty -= qty;
    portfolio.cash = round2(portfolio.cash + input.exitPrice * qty - fees);
    if (pos.qty <= 0) {
      pos.status = input.reason === "time-exit" ? "time-exited" : input.reason === "stop-breach" ? "stopped-out" : "closed";
      portfolio.positions = portfolio.positions.filter((p) => p.id !== pos.id);
    } else {
      pos.status = "partial-exit";
      pos.updatedAt = now;
    }
    return { ok: true };
  }

  overrideStop(state: MitState, positionId: string, newStop: number): { ok: boolean; reason?: string } {
    const pos = state.portfolio.positions.find((p) => p.id === positionId);
    if (!pos) {
      return { ok: false, reason: "Position not found" };
    }
    if (!Number.isFinite(newStop) || newStop <= 0) {
      return { ok: false, reason: "Stop must be positive" };
    }
    if (newStop >= pos.currentPrice) {
      return { ok: false, reason: "Stop must be below current price" };
    }
    pos.stopLoss = newStop;
    if (pos.trailingStop !== null && newStop > pos.trailingStop) {
      pos.trailingStop = newStop;
    }
    pos.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  toResponse(portfolio: MitPortfolioState): MitPortfolioResponse {
    const deployed = portfolio.positions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);
    const equity = portfolio.cash + deployed;
    const unrealizedPnl = portfolio.positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const realizedPnlCumulative = portfolio.closedTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
    const wins = portfolio.closedTrades.filter((t) => t.realizedPnl > 0).length;
    const winRate = portfolio.closedTrades.length > 0 ? wins / portfolio.closedTrades.length : null;
    const avgR = portfolio.closedTrades.length > 0
      ? portfolio.closedTrades.reduce((sum, t) => sum + t.realizedRMultiple, 0) / portfolio.closedTrades.length
      : null;

    return {
      settings: portfolio.settings,
      cash: portfolio.cash,
      equity,
      deployed,
      deployedPct: equity > 0 ? deployed / equity : 0,
      unrealizedPnl,
      realizedPnlCumulative,
      maxDrawdownPct: portfolio.maxDrawdownPct,
      winRate,
      avgRMultiple: avgR,
      positions: portfolio.positions,
      closedTrades: portfolio.closedTrades,
      paused: portfolio.paused,
      lastPipelineRun: portfolio.lastPipelineRun,
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function holdDays(entryDate: string, exitDate: string): number {
  const start = Date.parse(entryDate);
  const end = Date.parse(exitDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    console.warn("MIT holdDays received invalid dates", { entryDate, exitDate });
    return 0;
  }
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}
