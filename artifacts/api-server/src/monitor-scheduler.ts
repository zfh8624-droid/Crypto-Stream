import { db, monitorsTable } from "@workspace/db";
import type { Monitor } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger.js";
import { fetchBinanceKLines, fetchSinaKLines } from "./kline.js";

// 判断A股是否在休市时间
function isAShareMarketClosed(): boolean {
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  
  const day = beijingTime.getDay(); // 0=周日, 1-6=周一到周六
  const hours = beijingTime.getHours();
  const minutes = beijingTime.getMinutes();
  
  // 周六周日休市
  if (day === 0 || day === 6) {
    return true;
  }
  
  const currentTime = hours * 60 + minutes;
  
  // 上午9:30-11:30交易
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;
  
  // 下午13:00-15:00交易
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;
  
  // 在交易时间内
  const isTradingTime = 
    (currentTime >= morningStart && currentTime <= morningEnd) ||
    (currentTime >= afternoonStart && currentTime <= afternoonEnd);
  
  // 不在交易时间就是休市
  return !isTradingTime;
}

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

// RSI计算函数
export function calcRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// KDJ计算函数
export function calcKDJ(highs: number[], lows: number[], closes: number[]): { k: number | null; d: number | null; j: number | null } {
  const period = 9;
  if (highs.length < period || lows.length < period || closes.length < period) {
    return { k: null, d: null, j: null };
  }
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const recentCloses = closes.slice(-period);
  const low = Math.min(...recentLows);
  const high = Math.max(...recentHighs);
  const close = recentCloses[recentCloses.length - 1];
  let rsv = 50;
  if (high !== low) {
    rsv = ((close - low) / (high - low)) * 100;
  }
  const k = (2 / 3) * 50 + (1 / 3) * rsv;
  const d = (2 / 3) * 50 + (1 / 3) * k;
  const j = 3 * k - 2 * d;
  return { k, d, j };
}

// 成交量比计算函数
export function calcVolumeRatio(volumes: number[], period: number): number | null {
  if (volumes.length < period + 1) return null;
  const avgVolume = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  const currentVolume = volumes[volumes.length - 1];
  if (avgVolume === 0) return null;
  return currentVolume / avgVolume;
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

type ConditionType = "ma" | "rsi" | "kdj" | "volume";

interface MACondition {
  id: string;
  type: "ma";
  left: "price" | "ma1" | "ma2" | "ma3";
  op: ">" | "<" | "=";
  right: "price" | "ma1" | "ma2" | "ma3";
}

interface RSICondition {
  id: string;
  type: "rsi";
  period: number;
  op: ">" | "<" | "=";
  value: number;
}

interface KDJCondition {
  id: string;
  type: "kdj";
  line: "k" | "d" | "j";
  op: ">" | "<" | "=";
  value: number;
}

interface VolumeCondition {
  id: string;
  type: "volume";
  period: number;
  op: ">" | "<" | "=";
  ratio: number;
}

type Condition = MACondition | RSICondition | KDJCondition | VolumeCondition;

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
  ma3: number | null,
  rsiVal: number | null,
  kdjVals: { k: number | null; d: number | null; j: number | null },
  volumeRatioVal: number | null
): boolean {
  switch (c.type) {
    case "ma": {
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
    case "rsi": {
      if (rsiVal == null) return false;
      switch (c.op) {
        case ">": return rsiVal > c.value;
        case "<": return rsiVal < c.value;
        case "=": {
          const denom = Math.max(Math.abs(rsiVal), Math.abs(c.value), 1e-10);
          return Math.abs(rsiVal - c.value) / denom < 1e-4;
        }
      }
    }
    case "kdj": {
      const val = kdjVals[c.line];
      if (val == null) return false;
      switch (c.op) {
        case ">": return val > c.value;
        case "<": return val < c.value;
        case "=": {
          const denom = Math.max(Math.abs(val), Math.abs(c.value), 1e-10);
          return Math.abs(val - c.value) / denom < 1e-4;
        }
      }
    }
    case "volume": {
      if (volumeRatioVal == null) return false;
      switch (c.op) {
        case ">": return volumeRatioVal > c.ratio;
        case "<": return volumeRatioVal < c.ratio;
        case "=": {
          const denom = Math.max(Math.abs(volumeRatioVal), Math.abs(c.ratio), 1e-10);
          return Math.abs(volumeRatioVal - c.ratio) / denom < 1e-4;
        }
      }
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
      let closes: number[], highs: number[], lows: number[], volumes: number[];
      if (monitor.assetType === "crypto") {
        const candles = await fetchBinanceKLines(monitor.symbol, monitor.interval, limit);
        closes = candles.map((c) => c.close);
        highs = candles.map((c) => c.high);
        lows = candles.map((c) => c.low);
        volumes = candles.map((c) => c.volume);
      } else {
        const candles = await fetchSinaKLines(monitor.symbol, monitor.interval, limit);
        closes = candles.map((c) => c.close);
        highs = candles.map((c) => c.high);
        lows = candles.map((c) => c.low);
        volumes = candles.map((c) => c.volume);
      }

      if (closes.length === 0) {
        logger.warn(`No K-line data for ${monitor.symbol}`);
        return;
      }

      // 计算MA
      const ma1 = calcMA(closes, monitor.ma1Period, monitor.maType as MAType);
      const ma2 = calcMA(closes, monitor.ma2Period, monitor.maType as MAType);
      const ma3 = calcMA(closes, monitor.ma3Period, monitor.maType as MAType);
      const ma10 = calcMA(closes, 10, "SMA");
      const price = closes[closes.length - 1];
      const prevClose = closes.length >= 2 ? closes[closes.length - 2] : null;

      // 解析条件
      let conditions: Condition[];
      try {
        const rawConditions = typeof monitor.conditions === "string" 
          ? JSON.parse(monitor.conditions) 
          : monitor.conditions as any;
        // 兼容旧的 conditions（没有 type 字段的）
        conditions = rawConditions.map((c: any) => {
          if (c.type) return c;
          return { id: c.id, type: "ma", left: c.left, op: c.op, right: c.right };
        });
      } catch {
        conditions = [];
      }

      // 计算新指标
      const maxRSIPeriod = conditions.reduce((max, c) => c.type === "rsi" ? Math.max(max, c.period) : max, 0);
      const rsiVal = maxRSIPeriod > 0 ? calcRSI(closes, maxRSIPeriod) : null;
      
      const kdjVals = calcKDJ(highs, lows, closes);
      
      const maxVolumePeriod = conditions.reduce((max, c) => c.type === "volume" ? Math.max(max, c.period) : max, 0);
      const volumeRatioVal = maxVolumePeriod > 0 ? calcVolumeRatio(volumes, maxVolumePeriod) : null;

      // 评估条件
      const condResults = conditions.map((c) => evalCond(c, price, ma1, ma2, ma3, rsiVal, kdjVals, volumeRatioVal));
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
        // 如果是A股且在休市时间，不发送钉钉消息
        if (monitor.assetType === "ashare" && isAShareMarketClosed()) {
          logger.debug(`A股休市期间，跳过发送钉钉消息: ${monitor.symbol}`);
        } else {
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
            `条件：${conditions
              .map((c) => {
                switch (c.type) {
                  case "ma":
                    const sideLabels: Record<string, string> = {
                      price: "当前价",
                      ma1: `MA${monitor.ma1Period}`,
                      ma2: `MA${monitor.ma2Period}`,
                      ma3: `MA${monitor.ma3Period}`,
                    };
                    return `${sideLabels[c.left]} ${c.op} ${sideLabels[c.right]}`;
                  case "rsi":
                    return `RSI${c.period} ${c.op} ${c.value}`;
                  case "kdj":
                    return `KDJ${c.line.toUpperCase()} ${c.op} ${c.value}`;
                  case "volume":
                    return `成交量${c.period}日均量 ${c.op} ${c.ratio}倍`;
                }
              })
              .join("，")}`;

          try {
            await sendDingTalk(msg, monitor.dingtalkWebhook);
            newHasSentSignal = true;
            logger.info(`Signal sent for ${monitor.symbol}: ${signalLabel}`);
          } catch (err) {
            logger.error(`Failed to send DingTalk for ${monitor.symbol}:`, err);
          }
        }
      }

      // ========== 离场信号检测 ==========
      let shouldSendExitSignal = false;
      let newHasSentExitSignal = monitor.hasSentExitSignal;
      let newPrevClosePrice = monitor.prevClosePrice;

      // 只要启用离场监控就代表已进场，检测离场信号
      if (monitor.enableExitMonitor && !monitor.hasSentExitSignal) {
        // 检查是否是A股且在休市时间
        const skipDueToClosed = monitor.assetType === "ashare" && isAShareMarketClosed();

        if (!skipDueToClosed && monitor.exitMarketMode) {
          if (monitor.exitMarketMode === "bullish") {
            // 牛市模式：价格 <= MA10 触发离场
            if (ma10 != null && price <= ma10) {
              shouldSendExitSignal = true;
              logger.debug(`牛市离场信号触发: ${monitor.symbol} price=${price} <= MA10=${ma10}`);
            }
          } else if (monitor.exitMarketMode === "bearish") {
            // 熊市模式：当天收盘价 <= 上一天收盘价触发离场
            // 保存前一天收盘价
            newPrevClosePrice = price;
            
            if (monitor.prevClosePrice != null && price <= monitor.prevClosePrice) {
              shouldSendExitSignal = true;
              logger.debug(`熊市离场信号触发: ${monitor.symbol} price=${price} <= prevClose=${monitor.prevClosePrice}`);
            }
          }
        }
      }

      // 发送离场信号
      if (shouldSendExitSignal && monitor.dingtalkWebhook) {
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
        const marketModeLabel = monitor.exitMarketMode === "bullish" ? "牛市" : "熊市";
        
        const msg =
          `🚨 离场信号！\n` +
          `触发时间：${timeStr}\n` +
          `标的：${monitor.displayName}（${monitor.symbol}）\n` +
          `市场模式：${marketModeLabel}\n` +
          `当前价：${fmtVal(price, true, isCNY)}\n` +
          (monitor.exitMarketMode === "bullish" && ma10 != null ? `MA10：${fmtVal(ma10, true, isCNY)}\n` : "") +
          (monitor.exitMarketMode === "bearish" && monitor.prevClosePrice != null ? `上一日收盘价：${fmtVal(monitor.prevClosePrice, true, isCNY)}\n` : "") +
          `建议考虑离场！`;

        try {
          await sendDingTalk(msg, monitor.dingtalkWebhook);
          newHasSentExitSignal = true;
          logger.info(`Exit signal sent for ${monitor.symbol}`);
        } catch (err) {
          logger.error(`Failed to send exit DingTalk for ${monitor.symbol}:`, err);
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
          hasSentExitSignal: newHasSentExitSignal,
          prevClosePrice: newPrevClosePrice,
        })
        .where(eq(monitorsTable.id, monitor.id));

    } catch (error) {
      logger.error(`Error processing monitor ${monitor.symbol}:`, error);
    }
  }
}

export const monitorScheduler = new MonitorScheduler();
