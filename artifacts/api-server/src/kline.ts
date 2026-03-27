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

async function fetchTencentDailyKLines(symbol: string, limit: number): Promise<KLineCandle[]> {
  // 使用腾讯财经日K线接口
  // 格式转换: sh600000 -> sh600000, sz000001 -> sz000001
  
  // 先用东方财富的接口试试，更稳定
  const code = symbol.replace(/^(sh|sz)/, "");
  const market = symbol.startsWith("sh") ? "1" : "0"; // 1=上海, 0=深圳
  
  // 东方财富日K线接口
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=0&end=20500101&_=${Date.now()}`;
  
  const res = await fetch(url, {
    headers: { 
      Referer: "https://quote.eastmoney.com/", 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" 
    },
  });
  
  if (!res.ok) throw new Error(`Eastmoney daily K-line error: ${res.status}`);
  
  const text = await res.text();
  
  try {
    const json = JSON.parse(text);
    if (!json.data || !json.data.klines || !Array.isArray(json.data.klines)) {
      throw new Error("东方财富日K线数据为空");
    }
    
    const klines = json.data.klines.slice(-Math.min(limit, 500));
    
    return klines.map((line: string) => {
      // 东方财富格式: "日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率"
      const parts = line.split(",");
      const date = new Date(parts[0].replace(/-/g, "/"));
      
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
    throw new Error(`解析东方财富日K线数据失败: ${text.substring(0, 150)}`);
  }
}

export async function fetchSinaKLines(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<KLineCandle[]> {
  // 对于日K线，使用腾讯财经接口
  if (interval === "1d") {
    return await fetchTencentDailyKLines(symbol, limit);
  }
  
  const scale = SINA_SCALE_MAP[interval] ?? 60;
  const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${limit}`;
  
  const res = await fetch(url, {
    headers: { Referer: "http://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
  });
  
  if (!res.ok) throw new Error(`Sina K-line error: ${res.status}`);
  
  const buffer = await res.arrayBuffer();
  const text = iconv.decode(Buffer.from(buffer), "gbk");
  
  if (!text || text.trim() === "" || text.trim() === "[]") {
    throw new Error(`新浪${interval}K线数据为空，请尝试其他周期`);
  }
  
  try {
    const data = JSON.parse(text) as Array<{
      day: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    }>;
    
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`新浪${interval}K线数据格式错误`);
    }
    
    return data.map((k) => ({
      time: new Date(k.day).getTime(),
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
    }));
  } catch (parseErr) {
    throw new Error(`解析新浪${interval}K线数据失败: ${text.substring(0, 100)}`);
  }
}
