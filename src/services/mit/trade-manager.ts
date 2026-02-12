import type { MitState, TradeConfirmRequest, TradeEnterRequest, TradeExitRequest } from "../../mit-types.js";
import { MitPortfolioService } from "./portfolio-service.js";

export class MitTradeManager {
  private readonly portfolioService = new MitPortfolioService();

  enter(state: MitState, request: TradeEnterRequest): { ok: boolean; reason?: string } {
    return this.portfolioService.enterTrade(state, request);
  }

  exit(state: MitState, request: TradeExitRequest): { ok: boolean; reason?: string } {
    return this.portfolioService.exitTrade(state, request);
  }

  confirm(state: MitState, request: TradeConfirmRequest): { ok: boolean; reason?: string } {
    return this.portfolioService.confirmEntry(state, request);
  }
}
