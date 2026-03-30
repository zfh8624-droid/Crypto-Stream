import iconv from "iconv-lite";

export interface KLineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Binance interval mapping
const BINANCE_INTERVAL_MAP: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

export async function fetchBinanceKLines(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<KLineCandle[]> {
  const binanceInterval = BINANCE_INTERVAL_MAP[interval] ?? "1h";
  const fsym = symbol.replace(/USDT$/i, "").toUpperCase();
  const url =
    `https://data-api.binance.vision/api/v3/klines` +
    `?symbol=${fsym}USDT&interval=${binanceInterval}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Binance K-line error: ${res.status}`);
  const klines = (await res.json()) as Array<[
    number, string, string, string, string, string, number, string, number, string, string, string
  ]>;
  return klines.map((k) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

const EASTMONEY_KLT_MAP: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "1d": 101,
  "1w": 102,
};

async function fetchEastmoneyKLines(symbol: string, interval: string, limit: number): Promise<KLineCandle[]> {
  const code = symbol.replace(/^(sh|sz)/, "");
  const market = symbol.startsWith("sh") ? "1" : "0";
  const klt = EASTMONEY_KLT_MAP[interval] ?? 101;
  
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=1&beg=0&end=20500101&_=${Date.now()}`;
  
  const res = await fetch(url, {
    headers: { 
      Referer: "https://quote.eastmoney.com/", 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" 
    },
  });
  
  if (!res.ok) throw new Error(`Eastmoney K-line error: ${res.status}`);
  
  const text = await res.text();
  
  try {
    const json = JSON.parse(text);
    if (!json.data || !json.data.klines || !Array.isArray(json.data.klines)) {
      throw new Error(`东方财富${interval}K线数据为空`);
    }
    
    const klines = json.data.klines.slice(-Math.min(limit, 500));
    
    return klines.map((line: string) => {
      const parts = line.split(",");
      let dateStr = parts[0];
      
      if (interval === "1d" || interval === "1w") {
        dateStr = dateStr.replace(/-/g, "/");
      } else {
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        const hour = dateStr.substring(8, 10);
        const minute = dateStr.substring(10, 12);
        dateStr = `${year}/${month}/${day} ${hour}:${minute}`;
      }
      
      const date = new Date(dateStr);
      
      return {
        time: date.getTime(),
        open: parseFloat(parts[1]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        close: parseFloat(parts[2]),
        volume: parseFloat(parts[5]) || 0,
      };
    });
  } catch (parseErr) {
    throw new Error(`解析东方财富${interval}K线数据失败: ${text.substring(0, 150)}`);
  }
}

export async function fetchSinaKLines(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<KLineCandle[]> {
  return await fetchEastmoneyKLines(symbol, interval, limit);
}
