import { db, monitorsTable } from "@workspace/db";
import type { Monitor } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger.js";
import { fetchBinanceKLines, fetchSinaKLines } from "./kline.js";

// MA计算函数
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

// 钉钉发送函数
async function sendDingTalk(content: string, webhookUrl: string) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content } }),
  });
  if (!res.ok) throw new Error(`DingTalk API error: ${res.status}`);
  const data = (await res.json()) as { errcode: number; errmsg: string };
  if (data.errcode !== 0) throw new Error(`钉钉返回错误：${data.errmsg}（errcode=${data.errcode}）`);
  return data;
}

interface Condition {
  id: string;
  left: "price" | "ma1" | "ma2" | "ma3";
  op: ">" | "<" | "=";
  right: "price" | "ma1" | "ma2" | "ma3";
}

function getSideVal(
  side: "price" | "ma1" | "ma2" | "ma3",
  price: number | null,
  ma1: number | null,
  ma2: number | null,
  ma3: number | null
): number | null {
  switch (side) {
    case "price": return price;
    case "ma1": return ma1;
    case "ma2": return ma2;
    case "ma3": return ma3;
  }
}

function evalCond(
  c: Condition,
  price: number | null,
  ma1: number | null,
  ma2: number | null,
  ma3: number | null
): boolean {
  const l = getSideVal(c.left, price, ma1, ma2, ma3);
  const r = getSideVal(c.right, price, ma1, ma2, ma3);
  if (l == null || r == null) return false;
  switch (c.op) {
    case ">": return l > r;
    case "<": return l < r;
    case "=": {
      const denom = Math.max(Math.abs(l), Math.abs(r), 1e-10);
      return Math.abs(l - r) / denom < 1e-4;
    }
  }
}

function fmtVal(v: number | null, withCurrency: boolean = false, isCNY: boolean = false): string {
  if (v == null) return "-";
  if (v === 0) {
    if (!withCurrency) return "0";
    return isCNY ? "￥0" : "$0";
  }
  const formatted = v < 1 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2);
  if (!withCurrency) return formatted;
  return isCNY ? `￥${formatted}` : `$${formatted}`;
}

class MonitorScheduler {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private checkIntervalMs = 60000) {}

  async start() {
    if (this.isRunning) {
      logger.warn("Monitor scheduler is already running");
      return;
    }

    this.isRunning = true;
    logger.info("Starting monitor scheduler");

    this.interval = setInterval(() => this.checkMonitors(), this.checkIntervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info("Monitor scheduler stopped");
  }

  async checkMonitors() {
    try {
      logger.debug("Checking monitors...");

      const enabledMonitors = await db.select().from(monitorsTable).where(eq(monitorsTable.enabled, true));

      logger.debug(`Found ${enabledMonitors.length} enabled monitors`);

      for (const monitor of enabledMonitors) {
        try {
          await this.processMonitor(monitor);
        } catch (monitorError) {
          logger.error(`Error processing monitor ${monitor.symbol}:`, monitorError);
        }
      }
    } catch (error) {
      logger.error("Error checking monitors:", error);
      if (error instanceof Error) {
        logger.error("Error stack:", error.stack);
      }
    }
  }

  private async processMonitor(monitor: Monitor) {
    try {
      logger.debug(`Processing monitor: ${monitor.symbol}`);

      const maxPeriod = Math.max(monitor.ma1Period, monitor.ma2Period, monitor.ma3Period);
      const limit = maxPeriod + 50;

      // 获取K线数据
      let closes: number[];
      if (monitor.assetType === "crypto") {
        const candles = await fetchBinanceKLines(monitor.symbol, monitor.interval, limit);
        closes = candles.map((c) => c.close);
      } else {
        const candles = await fetchSinaKLines(monitor.symbol, monitor.interval, limit);
        closes = candles.map((c) => c.close);
      }

      if (closes.length === 0) {
        logger.warn(`No K-line data for ${monitor.symbol}`);
        return;
      }

      // 计算MA
      const ma1 = calcMA(closes, monitor.ma1Period, monitor.maType as MAType);
      const ma2 = calcMA(closes, monitor.ma2Period, monitor.maType as MAType);
      const ma3 = calcMA(closes, monitor.ma3Period, monitor.maType as MAType);
      const price = closes[closes.length - 1];

      // 解析条件
      let conditions: Condition[];
      try {
        conditions = typeof monitor.conditions === "string" 
          ? JSON.parse(monitor.conditions) 
          : monitor.conditions as any;
      } catch {
        conditions = [];
      }

      // 评估条件
      const condResults = conditions.map((c) => evalCond(c, price, ma1, ma2, ma3));
      const isGolden = condResults.length > 0 && condResults.every(Boolean);

      // 检测交叉
      const ma1GtMa2 = ma1 != null && ma2 != null && ma1 > ma2;
      const prevMa1GtMa2 = monitor.prevMa1GtMa2;

      // 检测信号方向的交叉
      let hasSignalCross = false;
      let hasResetCross = false;

      if (prevMa1GtMa2 != null && ma1 != null && ma2 != null) {
        if (monitor.signalType === "golden") {
          // 金叉：MA1从下往上穿过MA2
          hasSignalCross = !prevMa1GtMa2 && ma1GtMa2;
          // 重置交叉：MA1从上往下穿过MA2
          hasResetCross = prevMa1GtMa2 && !ma1GtMa2;
        } else {
          // 死叉：MA1从上往下穿过MA2
          hasSignalCross = prevMa1GtMa2 && !ma1GtMa2;
          // 重置交叉：MA1从下往上穿过MA2
          hasResetCross = !prevMa1GtMa2 && ma1GtMa2;
        }
      }

      let newHasSentSignal = monitor.hasSentSignal;
      let newTrendStatus = monitor.trendStatus;

      // 判断趋势状态
      if (ma1 != null && ma2 != null) {
        newTrendStatus = ma1GtMa2 ? "bullish" : "bearish";
      }

      // 如果发生了重置交叉，重置信号发送状态
      if (hasResetCross) {
        newHasSentSignal = false;
      }

      // 只有在发生信号交叉、所有条件满足，且还没有发送过信号时，才发送新信号
      const isNewSignal = hasSignalCross && isGolden && !newHasSentSignal;

      if (isNewSignal && monitor.dingtalkWebhook) {
        const signalLabel = monitor.signalType === "golden" ? "金叉" : "死叉";
        const now = new Date();
        const timeStr = now.toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        });

        const isCNY = monitor.assetType === "ashare";
        const msg =
          `🔔 ${signalLabel}信号！\n` +
          `触发时间：${timeStr}\n` +
          `标的：${monitor.displayName}（${monitor.symbol}）\n` +
          `周期：${monitor.interval}  均线类型：${monitor.maType}\n` +
          `当前价：${fmtVal(price, true, isCNY)}\n` +
          `MA${monitor.ma1Period}（短）：${fmtVal(ma1, true, isCNY)}\n` +
          `MA${monitor.ma2Period}（中）：${fmtVal(ma2, true, isCNY)}\n` +
          `MA${monitor.ma3Period}（长）：${fmtVal(ma3, true, isCNY)}\n` +
          conditions
            .map((c) => {
              const sideLabels: Record<string, string> = {
                price: "当前价",
                ma1: `MA${monitor.ma1Period}`,
                ma2: `MA${monitor.ma2Period}`,
                ma3: `MA${monitor.ma3Period}`,
              };
              return `${sideLabels[c.left]} ${c.op} ${sideLabels[c.right]}`;
            })
            .join("，");

        try {
          await sendDingTalk(msg, monitor.dingtalkWebhook);
          newHasSentSignal = true;
          logger.info(`Signal sent for ${monitor.symbol}: ${signalLabel}`);
        } catch (err) {
          logger.error(`Failed to send DingTalk for ${monitor.symbol}:`, err);
        }
      }

      // 更新数据库
      await db
        .update(monitorsTable)
        .set({
          lastCheckAt: new Date(),
          updatedAt: new Date(),
          hasSentSignal: newHasSentSignal,
          prevMa1GtMa2: ma1GtMa2,
          trendStatus: newTrendStatus,
          lastSignalAt: isNewSignal ? new Date() : monitor.lastSignalAt,
        })
        .where(eq(monitorsTable.id, monitor.id));

    } catch (error) {
      logger.error(`Error processing monitor ${monitor.symbol}:`, error);
    }
  }
}

export const monitorScheduler = new MonitorScheduler();
