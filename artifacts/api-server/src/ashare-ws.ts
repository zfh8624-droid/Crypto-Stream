import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { logger } from "./lib/logger";

export interface AShareQuote {
  code: string;
  name: string;
  price: number;
  open: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  change: number;
  changePct: number;
  time: string;
}

function parseSimaQuote(code: string, raw: string): AShareQuote | null {
  const parts = raw.split(",");
  if (parts.length < 32) return null;
  const name = parts[0];
  if (!name) return null;
  const open = parseFloat(parts[1]);
  const prevClose = parseFloat(parts[2]);
  const price = parseFloat(parts[3]);
  const high = parseFloat(parts[4]);
  const low = parseFloat(parts[5]);
  const volume = parseInt(parts[8], 10);
  const amount = parseFloat(parts[9]);
  const change = price - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  return {
    code,
    name,
    price,
    open,
    prevClose,
    high,
    low,
    volume,
    amount,
    change,
    changePct,
    time: `${parts[30]} ${parts[31]}`,
  };
}

const subscriptionMap = new Map<WebSocket, Set<string>>();
let pollingTimer: ReturnType<typeof setInterval> | null = null;
const latestData = new Map<string, AShareQuote>();

function getSubscribedCodes(): string[] {
  const codes = new Set<string>();
  for (const subs of subscriptionMap.values()) {
    for (const code of subs) codes.add(code);
  }
  return Array.from(codes);
}

async function pollSina(codes: string[]) {
  if (codes.length === 0) return;
  const list = codes.join(",");
  try {
    const res = await fetch(`http://hq.sinajs.cn/list=${list}`, {
      headers: {
        Referer: "http://finance.sina.com.cn/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Sina API returned non-OK status");
      return;
    }
    const text = await res.text();
    const lines = text.trim().split("\n");
    const updates: AShareQuote[] = [];
    for (const line of lines) {
      const match = line.match(/var hq_str_([^=]+)="([^"]*)"/);
      if (!match) continue;
      const code = match[1];
      const raw = match[2];
      if (!raw) continue;
      const quote = parseSimaQuote(code, raw);
      if (!quote) continue;
      latestData.set(code, quote);
      updates.push(quote);
    }
    if (updates.length === 0) return;
    const updatesByCode = new Map(updates.map((q) => [q.code, q]));
    for (const [ws, subs] of subscriptionMap.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const relevant: AShareQuote[] = [];
      for (const code of subs) {
        const q = updatesByCode.get(code);
        if (q) relevant.push(q);
      }
      if (relevant.length > 0) {
        ws.send(JSON.stringify({ type: "quotes", data: relevant }));
      }
    }
  } catch (err) {
    logger.error({ err }, "Error polling Sina quote API");
  }
}

function startPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    const codes = getSubscribedCodes();
    if (codes.length > 0) pollSina(codes);
  }, 2000);
  logger.info("A-share polling started (2s interval)");
}

function stopPolling() {
  if (pollingTimer && subscriptionMap.size === 0) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    logger.info("A-share polling stopped (no subscribers)");
  }
}

export function setupAShareWS(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    if (url === "/api/ashare" || url.startsWith("/api/ashare?")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    subscriptionMap.set(ws, new Set());
    startPolling();
    logger.info("A-share WS client connected");

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          codes?: string[];
        };
        if (msg.type === "subscribe" && Array.isArray(msg.codes)) {
          const subs = subscriptionMap.get(ws) ?? new Set<string>();
          for (const code of msg.codes) subs.add(code);
          subscriptionMap.set(ws, subs);
          const cached: AShareQuote[] = [];
          for (const code of msg.codes) {
            const q = latestData.get(code);
            if (q) cached.push(q);
          }
          if (cached.length > 0) {
            ws.send(JSON.stringify({ type: "quotes", data: cached }));
          }
          pollSina(getSubscribedCodes());
        } else if (msg.type === "unsubscribe" && Array.isArray(msg.codes)) {
          const subs = subscriptionMap.get(ws);
          if (subs) {
            for (const code of msg.codes) subs.delete(code);
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", () => {
      subscriptionMap.delete(ws);
      stopPolling();
      logger.info("A-share WS client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "A-share WS error");
    });
  });

  logger.info("A-Share WebSocket ready at /api/ashare");
}
