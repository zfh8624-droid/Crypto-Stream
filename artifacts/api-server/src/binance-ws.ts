import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { logger } from "./lib/logger";

interface BinanceKline {
  s: string; // symbol
  k: {
    t: number; // 开始时间
    T: number; // 结束时间
    s: string; // symbol
    i: string; // 间隔
    f: number; // first trade ID
    L: number; // last trade ID
    o: string; // 开盘价
    c: string; // 收盘价
    h: string; // 最高价
    l: string; // 最低价
    v: string; // 成交量
    n: number; // 成交笔数
    x: boolean; // 是否闭合
    q: string; // 成交额
    V: string; // 主动买入成交量
    Q: string; // 主动买入成交额
    B: string; // 忽略
  };
}

interface BinanceTicker {
  s: string;
  c: string;
  P: string;
  v: string;
}

interface ClientMessage {
  type: "subscribe" | "unsubscribe";
  symbols?: string[];
}

const subscriptionMap = new Map<WebSocket, Set<string>>();
let binanceWs: WebSocket | null = null;
const latestData = new Map<string, BinanceTicker>();

function getSubscribedSymbols(): string[] {
  const symbols = new Set<string>();
  for (const subs of subscriptionMap.values()) {
    for (const symbol of subs) symbols.add(symbol);
  }
  return Array.from(symbols);
}

function getBinanceWsUrl(symbols: string[]): string {
  const streams = symbols
    .map((s) => `${s.toLowerCase()}usdt@kline_1d`)
    .join("/");
  
  return `wss://data-stream.binance.vision/stream?streams=${streams}`;
}

function connectToBinance(symbols: string[]) {
  if (symbols.length === 0) {
    if (binanceWs) {
      binanceWs.close();
      binanceWs = null;
    }
    return;
  }

  const url = getBinanceWsUrl(symbols);
  logger.info({ url, symbols }, "Connecting to Binance K-line WS");

  if (binanceWs) {
    binanceWs.close();
  }

  binanceWs = new WebSocket(url);

  binanceWs.onopen = () => {
    logger.info("Binance K-line WS connected");
  };

  binanceWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data.toString());
      if (data.stream && data.data) {
        const klineMsg = data.data as BinanceKline;
        const symbol = klineMsg.s.replace("USDT", "");
        
        // 转换为ticker格式，保持和之前兼容
        const openPrice = parseFloat(klineMsg.k.o);
        const closePrice = parseFloat(klineMsg.k.c);
        const changePct = ((closePrice - openPrice) / openPrice) * 100;
        
        const ticker: BinanceTicker = {
          s: klineMsg.s,
          c: klineMsg.k.c,
          P: changePct.toFixed(2), // 使用开盘价和收盘价计算涨跌幅
          v: klineMsg.k.v,
        };
        
        latestData.set(ticker.s, ticker);
        
        // 推送给所有订阅的客户端
        for (const [ws, subs] of subscriptionMap.entries()) {
          if (ws.readyState !== WebSocket.OPEN) continue;
          if (subs.has(symbol)) {
            ws.send(JSON.stringify(ticker));
          }
        }
      }
    } catch (err) {
      logger.error({ err, rawData: event.data.toString() }, "Error parsing Binance message");
    }
  };

  binanceWs.onerror = (err) => {
    logger.error({ err }, "Binance WS error");
  };

  binanceWs.onclose = () => {
    logger.warn("Binance WS closed, reconnecting in 5s");
    binanceWs = null;
    setTimeout(() => {
      const allSymbols = getSubscribedSymbols();
      if (allSymbols.length > 0) {
        connectToBinance(allSymbols);
      }
    }, 5000);
  };
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export function setupBinanceWS(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      const extWs = ws as WebSocket & { isAlive?: boolean };
      if (extWs.isAlive === false) {
        extWs.terminate();
        return;
      }
      extWs.isAlive = false;
      extWs.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeatTimer));

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    if (url === "/api/binance" || url.startsWith("/api/binance?")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    const extWs = ws as WebSocket & { isAlive?: boolean };
    extWs.isAlive = true;
    extWs.on("pong", () => { extWs.isAlive = true; });

    subscriptionMap.set(ws, new Set());
    logger.info("Binance WS client connected");

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (msg.type === "subscribe" && Array.isArray(msg.symbols)) {
          const subs = subscriptionMap.get(ws) ?? new Set<string>();
          for (const symbol of msg.symbols) subs.add(symbol);
          subscriptionMap.set(ws, subs);
          
          const cached: BinanceTicker[] = [];
          for (const symbol of msg.symbols) {
            const fullSymbol = `${symbol.toUpperCase()}USDT`;
            const t = latestData.get(fullSymbol);
            if (t) cached.push(t);
          }
          for (const t of cached) {
            ws.send(JSON.stringify(t));
          }
          
          connectToBinance(getSubscribedSymbols());
        } else if (msg.type === "unsubscribe" && Array.isArray(msg.symbols)) {
          const subs = subscriptionMap.get(ws);
          if (subs) {
            for (const symbol of msg.symbols) subs.delete(symbol);
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", () => {
      subscriptionMap.delete(ws);
      logger.info("Binance WS client disconnected");
      
      // 如果没有订阅者了，断开Binance连接
      if (subscriptionMap.size === 0 && binanceWs) {
        binanceWs.close();
        binanceWs = null;
      }
    });

    ws.on("error", (err) => {
      logger.error({ err }, "Binance WS error");
    });
  });

  logger.info("Binance WebSocket ready at /api/binance");
}
