import iconv from "iconv-lite";

export interface KLineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// CryptoCompare interval → (endpoint, aggregate)
const CC_INTERVAL_MAP: Record<string, { endpoint: string; aggregate: number }> = {
  "1m":  { endpoint: "histominute", aggregate: 1  },
  "5m":  { endpoint: "histominute", aggregate: 5  },
  "15m": { endpoint: "histominute", aggregate: 15 },
  "30m": { endpoint: "histominute", aggregate: 30 },
  "1h":  { endpoint: "histohour",   aggregate: 1  },
  "4h":  { endpoint: "histohour",   aggregate: 4  },
  "1d":  { endpoint: "histoday",    aggregate: 1  },
};

interface CCCandle {
  time: number; open: number; high: number;
  low: number;  close: number; volumefrom: number;
}

export async function fetchBinanceKLines(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<KLineCandle[]> {
  const map = CC_INTERVAL_MAP[interval] ?? CC_INTERVAL_MAP["1h"];
  const fsym = symbol.replace(/USDT$/i, "").toUpperCase();
  const url =
    `https://min-api.cryptocompare.com/data/v2/${map.endpoint}` +
    `?fsym=${fsym}&tsym=USDT&limit=${limit}&aggregate=${map.aggregate}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`CryptoCompare K-line error: ${res.status}`);
  const json = (await res.json()) as {
    Response: string; Message?: string;
    Data?: { Data: CCCandle[] };
  };
  if (json.Response !== "Success" || !json.Data?.Data) {
    throw new Error(`CryptoCompare error: ${json.Message ?? "unknown"}`);
  }
  return json.Data.Data.map((k) => ({
    time:   k.time * 1000,
    open:   k.open,
    high:   k.high,
    low:    k.low,
    close:  k.close,
    volume: k.volumefrom,
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
