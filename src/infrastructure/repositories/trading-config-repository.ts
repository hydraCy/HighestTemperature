export type TradingRunConfig = {
  totalCapital: number;
  maxSingleTradePercent: number;
};

export function getTradingRunConfig(): TradingRunConfig {
  return {
    totalCapital: Number(process.env.TOTAL_CAPITAL ?? '10000'),
    maxSingleTradePercent: Number(process.env.MAX_SINGLE_TRADE_PERCENT ?? '0.1')
  };
}
