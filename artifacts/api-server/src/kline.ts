import iconv from "iconv-lite";

export interface KLineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchBinanceKLines(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<KLineCandle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}USDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance K-line error: ${res.status}`);
  const data = (await res.json()) as unknown[][];
  return data.map((k) => ({
    time: k[0] as number,
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

const SINA_SCALE_MAP: Record<string, number> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "1d": 1440,
  "1w": 10080,
};

export async function fetchSinaKLines(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<KLineCandle[]> {
  const scale = SINA_SCALE_MAP[interval] ?? 60;
  const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${limit}`;
  const res = await fetch(url, {
    headers: { Referer: "http://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Sina K-line error: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const text = iconv.decode(Buffer.from(buffer), "gbk");
  const data = JSON.parse(text) as Array<{
    day: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
  return data.map((k) => ({
    time: new Date(k.day).getTime(),
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    volume: parseFloat(k.volume),
  }));
}
