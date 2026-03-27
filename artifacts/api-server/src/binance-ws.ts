import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { logger } from "./lib/logger";

interface BinanceTicker {
  s: string;
  c: string;
  P: string;
  v: string;
}

interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "set_ws_url";
  symbols?: string[];
  wsUrl?: string;
}

const clientSubscriptions = new Map<WebSocket, Set<string>>();
let binanceWs: WebSocket | null = null;
const latestTickers = new Map<string, BinanceTicker>();
let currentBinanceWsBaseUrl = "wss://stream.binance.com:9443";
let lastConnectedSymbols: string[] = [];
let binanceLastMsgAt: number = Date.now();
let binanceHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
const BINANCE_HEARTBEAT_MS = 60000;

function getBinanceWsUrl(symbols: string[], baseUrl: string): string {
  const streams = symbols
    .map((s) => `${s.toLowerCase()}usdt@ticker`)
    .join("/");
  
  // 确保URL格式正确 - 多路复用格式需要/stream路径
  // Binance标准格式：wss://stream.binance.com:9443/stream?streams=stream1/stream2
  let base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/stream?streams=${streams}`;
}

function clearBinanceHeartbeat() {
  if (binanceHeartbeatTimer) {
    clearInterval(binanceHeartbeatTimer);
    binanceHeartbeatTimer = null;
  }
}

function disconnectBinance() {
  clearBinanceHeartbeat();
  if (binanceWs) {
    binanceWs.close();
    binanceWs = null;
    lastConnectedSymbols = [];
    logger.info("Disconnected from Binance WS");
  }
}

function connectToBinance(symbols: string[]) {
  if (symbols.length === 0) {
    disconnectBinance();
    lastConnectedSymbols = [];
    return;
  }

  // 检查symbol列表是否真的变化了
  const sortedSymbols = [...symbols].sort();
  const sortedLastConnected = [...lastConnectedSymbols].sort();
  const symbolsChanged = JSON.stringify(sortedSymbols) !== JSON.stringify(sortedLastConnected);
  
  if (!symbolsChanged && binanceWs && binanceWs.readyState === WebSocket.OPEN) {
    // symbol列表没变且连接正常，不需要重连
    return;
  }

  const url = getBinanceWsUrl(symbols, currentBinanceWsBaseUrl);
  logger.info({ url, symbols, baseUrl: currentBinanceWsBaseUrl }, "Connecting to Binance WS");

  disconnectBinance();

  lastConnectedSymbols = [...symbols];
  binanceWs = new WebSocket(url);

  binanceWs.onopen = () => {
    logger.info("Binance WS connected");
    binanceLastMsgAt = Date.now();
    
    clearBinanceHeartbeat();
    binanceHeartbeatTimer = setInterval(() => {
      if (!binanceWs || binanceWs.readyState !== WebSocket.OPEN) {
        clearBinanceHeartbeat();
        return;
      }
      const idle = Date.now() - binanceLastMsgAt;
      if (idle > BINANCE_HEARTBEAT_MS) {
        logger.warn({ idle }, "Binance WS idle timeout, reconnecting…");
        binanceWs.close();
      }
    }, Math.max(BINANCE_HEARTBEAT_MS / 2, 5000));
  };

  binanceWs.onmessage = (event) => {
    binanceLastMsgAt = Date.now();
    try {
      const data = JSON.parse(event.data.toString());
      if (data.stream && data.data) {
        const ticker = data.data as BinanceTicker;
        latestTickers.set(ticker.s, ticker);
        broadcastTicker(ticker);
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
      const allSymbols = getAllSubscribedSymbols();
      if (allSymbols.length > 0) {
        connectToBinance(allSymbols);
      }
    }, 5000);
  };
}

function getAllSubscribedSymbols(): string[] {
  const symbols = new Set<string>();
  for (const subs of clientSubscriptions.values()) {
    for (const sym of subs) symbols.add(sym);
  }
  return Array.from(symbols);
}

function broadcastTicker(ticker: BinanceTicker) {
  const symbol = ticker.s.replace("USDT", "");
  for (const [ws, subs] of clientSubscriptions.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (subs.has(symbol)) {
      ws.send(JSON.stringify(ticker));
    }
  }
}

function reconnectBinanceIfNeeded() {
  const allSymbols = getAllSubscribedSymbols();
  if (allSymbols.length === 0) {
    disconnectBinance();
    return;
  }
  connectToBinance(allSymbols);
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

    clientSubscriptions.set(ws, new Set());
    logger.info("Binance WS client connected");

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (msg.type === "subscribe" && Array.isArray(msg.symbols)) {
          const subs = clientSubscriptions.get(ws) ?? new Set<string>();
          for (const sym of msg.symbols) subs.add(sym);
          clientSubscriptions.set(ws, subs);

          const cached: BinanceTicker[] = [];
          for (const sym of msg.symbols) {
            const fullSymbol = `${sym.toUpperCase()}USDT`;
            const t = latestTickers.get(fullSymbol);
            if (t) cached.push(t);
          }
          for (const t of cached) {
            ws.send(JSON.stringify(t));
          }

          reconnectBinanceIfNeeded();
        } else if (msg.type === "unsubscribe" && Array.isArray(msg.symbols)) {
          const subs = clientSubscriptions.get(ws);
          if (subs) {
            for (const sym of msg.symbols) subs.delete(sym);
          }
          reconnectBinanceIfNeeded();
        } else if (msg.type === "set_ws_url" && msg.wsUrl) {
          currentBinanceWsBaseUrl = msg.wsUrl;
          logger.info({ wsUrl: msg.wsUrl }, "Binance WS base URL updated");
          const allSymbols = getAllSubscribedSymbols();
          if (allSymbols.length > 0) {
            connectToBinance(allSymbols);
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", () => {
      clientSubscriptions.delete(ws);
      logger.info("Binance WS client disconnected");
      reconnectBinanceIfNeeded();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "Binance WS error");
    });
  });

  logger.info("Binance WebSocket ready at /api/binance");
}
