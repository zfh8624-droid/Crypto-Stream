export type MAType = "SMA" | "EMA" | "WMA";

export function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calcEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

export function calcWMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const denom = (period * (period + 1)) / 2;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += slice[i] * (i + 1);
  }
  return sum / denom;
}

export function calcMA(
  closes: number[],
  period: number,
  type: MAType
): number | null {
  switch (type) {
    case "SMA":
      return calcSMA(closes, period);
    case "EMA":
      return calcEMA(closes, period);
    case "WMA":
      return calcWMA(closes, period);
    default:
      return calcSMA(closes, period);
  }
}
