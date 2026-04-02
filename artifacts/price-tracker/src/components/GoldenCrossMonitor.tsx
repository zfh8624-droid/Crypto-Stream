import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { calcMA, MAType } from "@/lib/ma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSwitch } from "@/components/ui/simple-switch";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export type AssetType = "crypto" | "ashare";

type ExitMarketMode = "bullish" | "bearish";

interface BackendMonitor {
  id?: number;
  userId?: number;
  symbol: string;
  displayName: string;
  assetType: AssetType;
  enabled: boolean;
  interval: string;
  maType: MAType;
  ma1Period: number;
  ma2Period: number;
  ma3Period: number;
  conditions: Condition[];
  signalType: SignalType;
  dingtalkWebhook?: string;
  // 离场监控相关字段
  enableExitMonitor?: boolean;
  inPosition?: boolean;
  exitMarketMode?: ExitMarketMode;
  prevClosePrice?: number;
  hasSentExitSignal?: boolean;
}

export interface MonitoredSymbol {
  symbol: string;
  displayName: string;
  currentPrice: number | null;
}

type Side = "price" | "ma1" | "ma2" | "ma3";
type Op = ">" | "<" | "=";
type SignalType = "golden" | "death";

interface Condition {
  id: string;
  left: Side;
  op: Op;
  right: Side;
}

interface SymbolConfig {
  enabled: boolean;
  interval: string;
  maType: MAType;
  ma1Period: number;
  ma2Period: number;
  ma3Period: number;
  conditions: Condition[];
  signalType: SignalType;
  // 离场监控相关字段
  enableExitMonitor?: boolean;
  inPosition?: boolean;
  exitMarketMode?: ExitMarketMode;
}

type TrendStatus = "bullish" | "bearish" | "neutral";

interface SymbolRuntime {
  ma1Val: number | null;
  ma2Val: number | null;
  ma3Val: number | null;
  condResults: boolean[];
  isGolden: boolean;
  inSignal: boolean;
  lastCheck: Date | null;
  error: string | null;
  loading: boolean;
  prevMa1GtMa2: boolean | null; // 上一次MA1是否大于MA2，用于检测交叉
  hasSentSignal: boolean; // 是否已发送过信号，防止重复发送
  trendStatus: TrendStatus; // 趋势状态：多头/空头/中性
}

interface ClosesCache {
  closes: number[];
  fetchedAt: number;
  interval: string;
  maxPeriod: number;
}

const CRYPTO_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const ASHARE_INTERVALS = ["5m", "15m", "30m", "1h", "1d"];
const MA_TYPES: MAType[] = ["SMA", "EMA", "WMA"];
const SIDES: Side[] = ["price", "ma1", "ma2", "ma3"];
const OPS: Op[] = [">", "<", "="];

const SIDE_LABELS: Record<Side, string> = {
  price: "当前价",
  ma1: "MA短",
  ma2: "MA中",
  ma3: "MA长",
};

const DEFAULT_CONDITIONS: Condition[] = [
  { id: "c1", left: "price", op: ">", right: "ma3" },
  { id: "c2", left: "ma1", op: ">", right: "ma2" },
];

function getDefaultConfig(assetType: AssetType): SymbolConfig {
  if (assetType === "ashare") {
    return {
      enabled: false,
      interval: "1d",
      maType: "SMA",
      ma1Period: 5,
      ma2Period: 10,
      ma3Period: 20,
      conditions: DEFAULT_CONDITIONS,
      signalType: "golden",
      enableExitMonitor: false,
      inPosition: false,
      exitMarketMode: "bullish",
    };
  }
  return {
    enabled: false,
    interval: "4h",
    maType: "SMA",
    ma1Period: 7,
    ma2Period: 25,
    ma3Period: 60,
    conditions: DEFAULT_CONDITIONS,
    signalType: "golden",
    enableExitMonitor: false,
    inPosition: false,
    exitMarketMode: "bullish",
  };
}

const CACHE_TTL = 5 * 60 * 1000;

function storageKey(assetType: AssetType, symbol: string, isGuest: boolean = false, userId?: string) {
  let prefix: string;
  if (isGuest) {
    prefix = "guest_";
  } else if (userId) {
    prefix = `user_${userId}_`;
  } else {
    prefix = "user_";
  }
  return `${prefix}gc_v2_${assetType}_${symbol}`;
}

function runtimeStorageKey(assetType: AssetType, symbol: string, isGuest: boolean = false, userId?: string) {
  let prefix: string;
  if (isGuest) {
    prefix = "guest_";
  } else if (userId) {
    prefix = `user_${userId}_`;
  } else {
    prefix = "user_";
  }
  return `${prefix}gc_rt_${assetType}_${symbol}`;
}

interface PersistedRuntime {
  inSignal: boolean;
  lastSignalAt: number;
  hasSentSignal: boolean; // 是否已发送过信号
  trendStatus: TrendStatus; // 趋势状态
  ma1Val: number | null;
  ma2Val: number | null;
  ma3Val: number | null;
  condResults: boolean[];
  isGolden: boolean;
  prevMa1GtMa2: boolean | null;
}

function loadConfig(assetType: AssetType, symbol: string, isGuest: boolean = false, userId?: string): SymbolConfig {
  // 登录用户不从 localStorage 读取
  if (!isGuest) {
    console.log(`[loadConfig] User mode, returning default for ${assetType} ${symbol}`);
    return getDefaultConfig(assetType);
  }
  
  // 访客模式从 localStorage 读取
  try {
    const key = storageKey(assetType, symbol, isGuest, userId);
    const raw = localStorage.getItem(key);
    console.log(`[loadConfig] Loading ${key}, raw:`, raw);
    const defaultConfig = getDefaultConfig(assetType);
    if (!raw) {
      console.log(`[loadConfig] No data found, returning default for ${assetType}`);
      return { ...defaultConfig };
    }
    const p = JSON.parse(raw) as Partial<SymbolConfig>;
    
    const result = {
      ...defaultConfig,
      ...p,
      conditions: Array.isArray(p.conditions) && p.conditions.length > 0 ? p.conditions : [...DEFAULT_CONDITIONS],
    };
    console.log(`[loadConfig] Loaded result:`, result);
    return result;
  } catch (err) {
    console.error(`[loadConfig] Error:`, err);
    return getDefaultConfig(assetType);
  }
}

function saveConfig(assetType: AssetType, symbol: string, cfg: SymbolConfig, isGuest: boolean = false, userId?: string) {
  // 登录用户不保存到 localStorage
  if (!isGuest) {
    console.log(`[saveConfig] User mode, skipping localStorage save for ${assetType} ${symbol}`);
    return;
  }
  
  // 访客模式保存到 localStorage
  try {
    const key = storageKey(assetType, symbol, isGuest, userId);
    console.log(`[saveConfig] Saving ${key}:`, cfg);
    localStorage.setItem(key, JSON.stringify(cfg));
    console.log(`[saveConfig] Saved successfully`);
  } catch (err) {
    console.error(`[saveConfig] Error:`, err);
  }
}

function loadRuntime(assetType: AssetType, symbol: string, isGuest: boolean = false, userId?: string): PersistedRuntime {
  try {
    const key = runtimeStorageKey(assetType, symbol, isGuest, userId);
    const raw = localStorage.getItem(key);
    if (!raw) return { 
      inSignal: false, 
      lastSignalAt: 0, 
      hasSentSignal: false, 
      trendStatus: "neutral",
      ma1Val: null,
      ma2Val: null,
      ma3Val: null,
      condResults: [],
      isGolden: false,
      prevMa1GtMa2: null,
    };
    const loaded = JSON.parse(raw) as PersistedRuntime;
    // 向后兼容处理
    return {
      inSignal: loaded.inSignal ?? false,
      lastSignalAt: loaded.lastSignalAt ?? 0,
      hasSentSignal: loaded.hasSentSignal ?? false,
      trendStatus: loaded.trendStatus ?? "neutral",
      ma1Val: loaded.ma1Val ?? null,
      ma2Val: loaded.ma2Val ?? null,
      ma3Val: loaded.ma3Val ?? null,
      condResults: loaded.condResults ?? [],
      isGolden: loaded.isGolden ?? false,
      prevMa1GtMa2: loaded.prevMa1GtMa2 ?? null,
    };
  } catch {
    return { 
      inSignal: false, 
      lastSignalAt: 0, 
      hasSentSignal: false, 
      trendStatus: "neutral",
      ma1Val: null,
      ma2Val: null,
      ma3Val: null,
      condResults: [],
      isGolden: false,
      prevMa1GtMa2: null,
    };
  }
}

function saveRuntime(assetType: AssetType, symbol: string, rt: PersistedRuntime, isGuest: boolean = false, userId?: string) {
  try {
    const key = runtimeStorageKey(assetType, symbol, isGuest, userId);
    localStorage.setItem(key, JSON.stringify(rt));
  } catch {
    // ignore
  }
}

async function apiFetchCloses(
  symbol: string,
  interval: string,
  type: AssetType,
  limit: number
): Promise<number[]> {
  const params = new URLSearchParams({ symbol, interval, type, limit: String(limit) });
  const res = await fetch(`/api/kline/data?${params}`);
  let errText = "";
  if (!res.ok) {
    try { errText = await res.text(); } catch { }
    throw new Error(`K线请求失败 (${res.status})：${errText.slice(0, 120)}`);
  }
  const json = await res.json() as { closes?: number[] };
  if (!Array.isArray(json.closes)) throw new Error("K线响应格式错误");
  if (json.closes.length === 0) throw new Error("K线数据为空（非交易时段或代码有误）");
  return json.closes;
}

async function sendAlert(content: string, webhookUrl: string) {
  await fetch("/api/notify/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, webhookUrl }),
  });
}

function getSideVal(
  side: Side,
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

function calcMAsFromCloses(
  closes: number[],
  price: number | null,
  cfg: SymbolConfig
) {
  const withLive =
    price != null && closes.length > 0
      ? [...closes.slice(0, -1), price]
      : closes;
  return {
    ma1Val: calcMA(withLive, cfg.ma1Period, cfg.maType),
    ma2Val: calcMA(withLive, cfg.ma2Period, cfg.maType),
    ma3Val: calcMA(withLive, cfg.ma3Period, cfg.maType),
  };
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

function NumInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value;
      setText(String(value));
    }
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9]/g, "");
        setText(raw);
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= 1 && n <= 500) onChange(n);
      }}
      onBlur={() => {
        const n = parseInt(text, 10);
        if (isNaN(n) || n < 1) {
          setText(String(value));
        } else {
          const clamped = Math.min(500, n);
          setText(String(clamped));
          onChange(clamped);
        }
      }}
      className={className}
    />
  );
}

function ConditionEditor({
  cond,
  onChange,
  onRemove,
  canRemove,
}: {
  cond: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const sel = "h-7 rounded border border-input bg-background px-1.5 text-xs focus:outline-none";
  return (
    <div className="flex items-center flex-wrap">
      <select
        className={`${sel} mr-4`}
        value={cond.left}
        onChange={(e) => onChange({ ...cond, left: e.target.value as Side })}
      >
        {SIDES.map((s) => (
          <option key={s} value={s}>{SIDE_LABELS[s]}</option>
        ))}
      </select>
      <select
        className={`${sel} w-10 mr-4`}
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value as Op })}
      >
        {OPS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <select
        className={`${sel} mr-4`}
        value={cond.right}
        onChange={(e) => onChange({ ...cond, right: e.target.value as Side })}
      >
        {SIDES.map((s) => (
          <option key={s} value={s}>{SIDE_LABELS[s]}</option>
        ))}
      </select>
      {canRemove && (
        <button
          className="text-muted-foreground hover:text-red-500 transition-colors ml-6"
          onClick={onRemove}
          title="删除条件"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

interface Props {
  assetType: AssetType;
  symbols: MonitoredSymbol[];
  monitors?: any[];
}

function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // ignore
    }
    return defaultValue;
  });

  const setPersistedState: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (value) => {
      setState((prev) => {
        const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [key]
  );

  return [state, setPersistedState];
}

export function GoldenCrossMonitor({ assetType, symbols, monitors }: Props) {
  const intervals = assetType === "crypto" ? CRYPTO_INTERVALS : ASHARE_INTERVALS;
  const isCrypto = assetType === "crypto";
  const isCNY = assetType === "ashare";
  const { token, isGuest, user } = useAuth();
  const userId = user?.id;

  // 从 props 的 monitors 生成 backendMonitors
  const backendMonitors = useMemo<Record<string, BackendMonitor>>(() => {
    if (!monitors) return {};
    const monitorMap: Record<string, BackendMonitor> = {};
    for (const m of monitors) {
      if (m.assetType === assetType) {
        monitorMap[m.symbol] = m;
      }
    }
    return monitorMap;
  }, [monitors, assetType]);

  const loadingMonitors = false; // 不再需要加载状态，因为 monitors 来自 props

  // 移除：登录用户不使用 localStorage

  const [configs, setConfigs] = useState<Record<string, SymbolConfig>>(() => {
    // 初始化时，访客模式用localStorage，用户模式先留空等后端数据
    const initial: Record<string, SymbolConfig> = {};
    if (isGuest) {
      for (const sym of symbols) {
        initial[sym.symbol] = loadConfig(assetType, sym.symbol);
      }
    }
    return initial;
  });
  const [runtimes, setRuntimes] = useState<Record<string, SymbolRuntime>>(() => {
    const initial: Record<string, SymbolRuntime> = {};
    for (const sym of symbols) {
      const persistedRt = loadRuntime(assetType, sym.symbol);
      initial[sym.symbol] = {
        ma1Val: persistedRt.ma1Val,
        ma2Val: persistedRt.ma2Val,
        ma3Val: persistedRt.ma3Val,
        condResults: persistedRt.condResults,
        isGolden: persistedRt.isGolden,
        inSignal: persistedRt.inSignal,
        lastCheck: null,
        error: null,
        loading: false,
        prevMa1GtMa2: persistedRt.prevMa1GtMa2,
        hasSentSignal: persistedRt.hasSentSignal,
        trendStatus: persistedRt.trendStatus,
      };
    }
    return initial;
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [dingtalkWebhook, setDingtalkWebhook] = usePersistedState<string>(
    "dingtalk_webhook",
    "https://oapi.dingtalk.com/robot/send?access_token=a5214afa0698ca62e74ad87dc1053ac151fb04caee08ae044d053bca883dce97"
  );

  const closesCache = useRef<Record<string, ClosesCache>>({});
  const refreshTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const configsRef = useRef(configs);
  configsRef.current = configs;
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  // 用户模式下：合并后端监控 + 当前实时价格符号
  const displaySymbols = useMemo(() => {
    try {
      if (isGuest) {
        // 访客模式：只显示有实时价格的
        return symbols.filter((s) => s.currentPrice != null);
      } else {
        // 用户模式：显示所有后端监控 + 当前实时价格符号（去重）
        const symbolMap = new Map<string, MonitoredSymbol>();
        
        // 先添加所有后端监控（安全检查）
        if (backendMonitors && typeof backendMonitors === 'object') {
          Object.values(backendMonitors).forEach(m => {
            if (m && m.symbol && m.displayName) {
              symbolMap.set(m.symbol, {
                symbol: m.symbol,
                displayName: m.displayName,
                currentPrice: null, // 后端监控可能没有实时价格
              });
            }
          });
        }
        
        // 再添加当前有实时价格的符号（覆盖可能缺失的 displayName）
        if (symbols && Array.isArray(symbols)) {
          symbols.filter(s => s && s.currentPrice != null).forEach(s => {
            symbolMap.set(s.symbol, s);
          });
        }
        
        return Array.from(symbolMap.values());
      }
    } catch (err) {
      console.error('[displaySymbols] Error:', err);
      // 出错时回退到只显示有实时价格的
      return symbols.filter((s) => s.currentPrice != null);
    }
  }, [symbols, backendMonitors, isGuest]);

  // 用户模式下，后端数据加载完成后应用到configs
  useEffect(() => {
    console.log('[config effect] Called, isGuest:', isGuest);
    console.log('[config effect] symbols:', symbols);
    console.log('[config effect] backendMonitors:', backendMonitors);
    if (isGuest) return;
    
    const initial: Record<string, SymbolConfig> = {};
    
    // 先处理所有后端监控
    for (const [symbol, monitor] of Object.entries(backendMonitors)) {
      console.log('[config effect] Using backend data for', symbol);
      initial[symbol] = {
        enabled: monitor.enabled,
        interval: monitor.interval,
        maType: monitor.maType,
        ma1Period: monitor.ma1Period,
        ma2Period: monitor.ma2Period,
        ma3Period: monitor.ma3Period,
        conditions: monitor.conditions,
        signalType: monitor.signalType,
        enableExitMonitor: monitor.enableExitMonitor ?? false,
        inPosition: monitor.inPosition ?? false,
        exitMarketMode: monitor.exitMarketMode ?? "bullish",
      };
    }
    
    // 再处理当前有实时价格的符号（用户模式下用默认配置，不从localStorage读）
    for (const sym of symbols) {
      if (!initial[sym.symbol]) {
        console.log('[config effect] Using default config for', sym.symbol);
        initial[sym.symbol] = getDefaultConfig(assetType);
      }
    }
    
    console.log('[config effect] Setting configs:', initial);
    setConfigs(initial);
  }, [symbols.map(s => s.symbol).join(","), assetType, isGuest, userId, backendMonitors]);

  // 当有新symbol时，加载对应的配置和运行时（处理所有 displaySymbols）
  useEffect(() => {
    setConfigs((prev) => {
      const updated = { ...prev };
      for (const sym of displaySymbols) {
        if (!updated[sym.symbol]) {
          updated[sym.symbol] = isGuest ? loadConfig(assetType, sym.symbol, isGuest, userId) : getDefaultConfig(assetType);
        }
      }
      return updated;
    });

    setRuntimes((prev) => {
      const updated = { ...prev };
      for (const sym of displaySymbols) {
        if (!updated[sym.symbol]) {
          const persistedRt = loadRuntime(assetType, sym.symbol, isGuest, userId);
          updated[sym.symbol] = {
            ma1Val: persistedRt.ma1Val,
            ma2Val: persistedRt.ma2Val,
            ma3Val: persistedRt.ma3Val,
            condResults: persistedRt.condResults,
            isGolden: persistedRt.isGolden,
            inSignal: persistedRt.inSignal,
            lastCheck: null,
            error: null,
            loading: false,
            prevMa1GtMa2: persistedRt.prevMa1GtMa2,
            hasSentSignal: persistedRt.hasSentSignal,
            trendStatus: persistedRt.trendStatus,
          };
        }
      }
      return updated;
    });
  }, [displaySymbols.map((s) => s.symbol).join(","), assetType, isGuest, userId]);

  const getConfig = useCallback(
    (symbol: string): SymbolConfig => configs[symbol] ?? (isGuest ? loadConfig(assetType, symbol, isGuest, userId) : getDefaultConfig(assetType)),
    [configs, assetType, isGuest, userId]
  );

  const updateRuntimeFromCloses = useCallback(
    (sym: MonitoredSymbol, cfg: SymbolConfig) => {
      const cached = closesCache.current[sym.symbol];
      if (!cached || cached.closes.length === 0) return;

      const { ma1Val, ma2Val, ma3Val } = calcMAsFromCloses(cached.closes, sym.currentPrice, cfg);
      const condResults = cfg.conditions.map((c) =>
        evalCond(c, sym.currentPrice, ma1Val, ma2Val, ma3Val)
      );
      const isGolden = condResults.length > 0 && condResults.every(Boolean);

      setRuntimes((prev) => {
        const prevRt = prev[sym.symbol];
        const persistedRt = loadRuntime(assetType, sym.symbol);
        
        // 检测MA1和MA2的交叉
        const ma1GtMa2 = ma1Val != null && ma2Val != null && ma1Val > ma2Val;
        const prevMa1GtMa2 = prevRt?.prevMa1GtMa2 ?? persistedRt.prevMa1GtMa2;
        const hasSentSignal = prevRt?.hasSentSignal ?? persistedRt.hasSentSignal;
        
        // 检测是否发生了真正的交叉
        let hasSignalCross = false; // 信号方向的交叉（金叉或死叉）
        let hasResetCross = false; // 重置方向的交叉（反向交叉）
        
        if (prevMa1GtMa2 != null && ma1Val != null && ma2Val != null) {
          if (cfg.signalType === "golden") {
            // 金叉：MA1从下往上穿过MA2（prevMa1GtMa2=false, 当前=true）
            hasSignalCross = !prevMa1GtMa2 && ma1GtMa2;
            // 重置交叉：MA1从上往下穿过MA2（prevMa1GtMa2=true, 当前=false）- 死叉
            hasResetCross = prevMa1GtMa2 && !ma1GtMa2;
          } else {
            // 死叉：MA1从上往下穿过MA2（prevMa1GtMa2=true, 当前=false）
            hasSignalCross = prevMa1GtMa2 && !ma1GtMa2;
            // 重置交叉：MA1从下往上穿过MA2（prevMa1GtMa2=false, 当前=true）- 金叉
            hasResetCross = !prevMa1GtMa2 && ma1GtMa2;
          }
        }

        let newHasSentSignal = hasSentSignal;
        let newTrendStatus: TrendStatus = prevRt?.trendStatus ?? persistedRt.trendStatus;
        
        // 根据MA1和MA2的关系判断趋势状态
        if (ma1Val != null && ma2Val != null) {
          if (ma1GtMa2) {
            newTrendStatus = "bullish"; // 多头趋势
          } else {
            newTrendStatus = "bearish"; // 空头趋势
          }
        }
        
        // 如果发生了重置交叉，重置信号发送状态
        if (hasResetCross) {
          newHasSentSignal = false;
        }
        
        // 只有在发生信号交叉、所有条件满足，且还没有发送过信号时，才发送新信号
        const isNewSignal = hasSignalCross && isGolden && !newHasSentSignal;

        const runtimeData: PersistedRuntime = {
          inSignal: isGolden,
          lastSignalAt: isNewSignal ? Date.now() : persistedRt.lastSignalAt,
          hasSentSignal: newHasSentSignal,
          trendStatus: newTrendStatus,
          ma1Val,
          ma2Val,
          ma3Val,
          condResults,
          isGolden,
          prevMa1GtMa2: ma1GtMa2,
        };

        if (isNewSignal) {
          const signalLabel = cfg.signalType === "golden" ? "金叉" : "死叉";
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
          const msg =
            `🔔 ${signalLabel}信号！\n` +
            `触发时间：${timeStr}\n` +
            `标的：${sym.displayName}（${sym.symbol}）\n` +
            `周期：${cfg.interval}  均线类型：${cfg.maType}\n` +
            `当前价：${fmtVal(sym.currentPrice, true, isCNY)}\n` +
            `MA${cfg.ma1Period}（短）：${fmtVal(ma1Val, true, isCNY)}\n` +
            `MA${cfg.ma2Period}（中）：${fmtVal(ma2Val, true, isCNY)}\n` +
            `MA${cfg.ma3Period}（长）：${fmtVal(ma3Val, true, isCNY)}\n` +
            cfg.conditions
              .map((c) => `${SIDE_LABELS[c.left]} ${c.op} ${SIDE_LABELS[c.right]}`)
              .join("，");
          sendAlert(msg, dingtalkWebhook).catch((e) => console.error("钉钉推送失败", e));
          newHasSentSignal = true;
          runtimeData.hasSentSignal = true;
          saveRuntime(assetType, sym.symbol, runtimeData);
        } else {
          // 每次都保存状态，刷新页面后数据不丢失
          saveRuntime(assetType, sym.symbol, runtimeData);
        }

        return {
          ...prev,
          [sym.symbol]: {
            ma1Val: ma1Val ?? persistedRt.ma1Val,
            ma2Val: ma2Val ?? persistedRt.ma2Val,
            ma3Val: ma3Val ?? persistedRt.ma3Val,
            condResults: condResults.length > 0 ? condResults : persistedRt.condResults,
            isGolden: isGolden,
            inSignal: isGolden,
            lastCheck: new Date(),
            error: null,
            loading: false,
            prevMa1GtMa2: ma1GtMa2, // 保存当前MA1和MA2的关系
            hasSentSignal: newHasSentSignal, // 保存是否已发送信号的状态
            trendStatus: newTrendStatus, // 趋势状态
          },
        };
      });
    },
    [assetType, dingtalkWebhook, isCrypto, isCNY]
  );

  const fetchAndActivate = useCallback(
    async (sym: MonitoredSymbol, cfg: SymbolConfig) => {
      if (sym.currentPrice == null) return;

      const maxPeriod = Math.max(cfg.ma1Period, cfg.ma2Period, cfg.ma3Period);

      setRuntimes((prev) => {
        const persistedRt = loadRuntime(assetType, sym.symbol);
        return {
          ...prev,
          [sym.symbol]: {
            ...(prev[sym.symbol] ?? {
              ma1Val: persistedRt.ma1Val,
              ma2Val: persistedRt.ma2Val,
              ma3Val: persistedRt.ma3Val,
              condResults: persistedRt.condResults,
              isGolden: persistedRt.isGolden,
              inSignal: persistedRt.inSignal,
              lastCheck: null,
              prevMa1GtMa2: persistedRt.prevMa1GtMa2,
              hasSentSignal: persistedRt.hasSentSignal,
              trendStatus: persistedRt.trendStatus,
            }),
            loading: true,
            error: null,
          } as SymbolRuntime,
        };
      });

      try {
        const closes = await apiFetchCloses(sym.symbol, cfg.interval, assetType, maxPeriod + 50);
        closesCache.current[sym.symbol] = {
          closes,
          fetchedAt: Date.now(),
          interval: cfg.interval,
          maxPeriod,
        };
        updateRuntimeFromCloses(sym, cfg);
      } catch (err) {
        setRuntimes((prev) => {
          const persistedRt = loadRuntime(assetType, sym.symbol);
          return {
            ...prev,
            [sym.symbol]: {
              ...(prev[sym.symbol] ?? {
                ma1Val: persistedRt.ma1Val,
                ma2Val: persistedRt.ma2Val,
                ma3Val: persistedRt.ma3Val,
                condResults: persistedRt.condResults,
                isGolden: persistedRt.isGolden,
                inSignal: persistedRt.inSignal,
                lastCheck: null,
                prevMa1GtMa2: persistedRt.prevMa1GtMa2,
                hasSentSignal: persistedRt.hasSentSignal,
                trendStatus: persistedRt.trendStatus,
              }),
              loading: false,
              error: String(err),
            } as SymbolRuntime,
          };
        });
      }
    },
    [assetType, updateRuntimeFromCloses]
  );

  const startRefreshTimer = useCallback(
    (sym: MonitoredSymbol, cfg: SymbolConfig) => {
      if (refreshTimers.current[sym.symbol]) return;
      refreshTimers.current[sym.symbol] = setInterval(() => {
        const currentCfg = configsRef.current[sym.symbol];
        if (currentCfg?.enabled) {
          fetchAndActivate(
            symbolsRef.current.find((s) => s.symbol === sym.symbol) ?? sym,
            currentCfg
          );
        }
      }, CACHE_TTL);
    },
    [fetchAndActivate]
  );

  const stopRefreshTimer = useCallback((symbol: string) => {
    if (refreshTimers.current[symbol]) {
      clearInterval(refreshTimers.current[symbol]);
      delete refreshTimers.current[symbol];
    }
  }, []);

  useEffect(() => {
    return () => { Object.values(refreshTimers.current).forEach(clearInterval); };
  }, []);

  const prevConfigKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    for (const sym of symbols) {
      const cfg = configs[sym.symbol];
      if (!cfg) continue;

      const maxPeriod = Math.max(cfg.ma1Period, cfg.ma2Period, cfg.ma3Period);
      const cacheKey = `${cfg.interval}_${cfg.maType}_${maxPeriod}`;
      const cached = closesCache.current[sym.symbol];
      const prevKey = prevConfigKeys.current[sym.symbol] ?? "";

      if (cfg.enabled) {
        const needFetch =
          !cached ||
          cached.interval !== cfg.interval ||
          cached.maxPeriod < maxPeriod ||
          Date.now() - cached.fetchedAt > CACHE_TTL ||
          cacheKey !== prevKey;

        if (needFetch) {
          prevConfigKeys.current[sym.symbol] = cacheKey;
          fetchAndActivate(sym, cfg);
          startRefreshTimer(sym, cfg);
        }
      } else {
        stopRefreshTimer(sym.symbol);
      }
    }
  }, [
    symbols.map((s) => s.symbol).join(","),
    Object.entries(configs)
      .map(([k, v]) => `${k}:${v.enabled}:${v.interval}:${v.maType}:${v.ma1Period}:${v.ma2Period}:${v.ma3Period}`)
      .sort()
      .join("|"),
    fetchAndActivate,
    startRefreshTimer,
    stopRefreshTimer,
  ]);

  // 刷新页面后，确保已启用的监控能自动获取数据
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const sym of symbols) {
        const cfg = configs[sym.symbol];
        if (cfg?.enabled && sym.currentPrice != null) {
          const cached = closesCache.current[sym.symbol];
          if (!cached) {
            fetchAndActivate(sym, cfg);
          } else {
            // 如果有缓存数据，直接更新运行时状态
            updateRuntimeFromCloses(sym, cfg);
          }
        }
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    symbols.map((s) => `${s.symbol}:${s.currentPrice}`).join(","),
    Object.entries(configs)
      .map(([k, v]) => `${k}:${v.enabled}`)
      .sort()
      .join("|"),
    fetchAndActivate,
    updateRuntimeFromCloses,
  ]);

  const priceKey = symbols.map((s) => `${s.symbol}:${s.currentPrice ?? "x"}`).join(",");
  const prevPriceKey = useRef("");
  useEffect(() => {
    if (priceKey === prevPriceKey.current) return;
    prevPriceKey.current = priceKey;
    for (const sym of symbols) {
      const cfg = configsRef.current[sym.symbol];
      if (!cfg?.enabled || sym.currentPrice == null) continue;
      if (!closesCache.current[sym.symbol]) continue;
      updateRuntimeFromCloses(sym, cfg);
    }
  }, [priceKey, updateRuntimeFromCloses]);

  const updateConfig = useCallback(
    (symbol: string, patch: Partial<SymbolConfig>) => {
      console.log(`[updateConfig] Called for ${symbol}, patch:`, patch);
      
      setConfigs((prev) => {
        const current = prev[symbol] ?? (isGuest ? loadConfig(assetType, symbol, isGuest, userId) : getDefaultConfig(assetType));
        const updated = { ...current, ...patch };
        
        // 访客模式保存到 localStorage
        if (isGuest) {
          saveConfig(assetType, symbol, updated, isGuest, userId);
        }

        if (patch.interval && patch.interval !== current.interval) {
          delete closesCache.current[symbol];
        }
        if (patch.ma1Period != null || patch.ma2Period != null || patch.ma3Period != null) {
          const newMax = Math.max(
            patch.ma1Period ?? current.ma1Period,
            patch.ma2Period ?? current.ma2Period,
            patch.ma3Period ?? current.ma3Period
          );
          const cached = closesCache.current[symbol];
          if (cached && newMax > cached.maxPeriod) delete closesCache.current[symbol];
        }

        // 用户模式下，只保存到后端
        if (!isGuest && token) {
          (async () => {
            try {
              // 找到这个 symbol 的 displayName
              const monitoredSymbol = displaySymbols.find(s => s.symbol === symbol);
              const displayName = monitoredSymbol?.displayName || symbol;
              
              const monitorData = {
                symbol,
                displayName,
                assetType,
                enabled: updated.enabled,
                interval: updated.interval,
                maType: updated.maType,
                ma1Period: updated.ma1Period,
                ma2Period: updated.ma2Period,
                ma3Period: updated.ma3Period,
                conditions: updated.conditions,
                signalType: updated.signalType,
                dingtalkWebhook: dingtalkWebhook,
                enableExitMonitor: updated.enableExitMonitor ?? false,
                inPosition: updated.inPosition ?? false,
                exitMarketMode: updated.exitMarketMode ?? "bullish",
              };

              console.log(`[updateConfig] Saving to backend:`, monitorData);
              
              const res = await fetch("/api/monitors", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify(monitorData),
              });

              if (res.ok) {
                console.log(`[updateConfig] Saved to backend successfully`);
                // 不重新加载后端监控，保持本地状态（避免刚更新就被覆盖）
              } else {
                console.error(`[updateConfig] Failed to save to backend:`, res.status);
              }
            } catch (err) {
              console.error(`[updateConfig] Error saving to backend:`, err);
            }
          })();
        }

        return { ...prev, [symbol]: updated };
      });
    },
    [assetType, isGuest, token, userId, displaySymbols, dingtalkWebhook]
  );

  const handleToggle = useCallback(
    (symbol: string, enabled: boolean) => updateConfig(symbol, { enabled }),
    [updateConfig]
  );

  const handleTestSend = async () => {
    console.log(`[handleTestSend] dingtalkWebhook value:`, dingtalkWebhook);
    setTestStatus("sending");
    setTestMsg("");
    try {
      const res = await fetch("/api/notify/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: dingtalkWebhook }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) { setTestStatus("ok"); setTestMsg("发送成功！"); }
      else { setTestStatus("err"); setTestMsg(data.error ?? "发送失败"); }
    } catch (e) {
      setTestStatus("err");
      setTestMsg(String(e));
    }
    setTimeout(() => setTestStatus("idle"), 4000);
  };

  return (
    <div className="rounded-2xl glass-card border-0 p-6 space-y-8">
      <div className="space-y-3 p-5 rounded-2xl glass-card border-0 mb-8">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-bold text-foreground flex items-center gap-2">
            <span>🤖</span>
            钉钉机器人配置
          </div>
          <div className="flex items-center gap-3">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={handleTestSend} 
              disabled={testStatus === "sending"}
              className="border-2 border-teal-500/60 text-teal-600 hover:bg-teal-500/10"
            >
              {testStatus === "sending" ? "发送中..." : "📡 测试钉钉"}
            </Button>
            {testStatus !== "idle" && (
              <span className={`text-xs font-medium ${testStatus === "ok" ? "text-green-600" : "text-red-500"}`}>
                {testMsg}
              </span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Webhook 地址</Label>
          <div className="flex gap-2">
            <Input
              value={dingtalkWebhook}
              onChange={(e) => setDingtalkWebhook(e.target.value)}
              placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
              className="flex-1 text-xs font-mono bg-white/5 dark:bg-black/5 border-2 border-teal-500/40 dark:border-teal-400/40"
            />
            {!isGuest && token && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const response = await fetch('/api/monitors/batch/update-webhook', {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                      },
                      body: JSON.stringify({ webhookUrl: dingtalkWebhook }),
                    });
                    
                    if (response.ok) {
                      const data = await response.json();
                      alert(`成功更新 ${data.updatedCount} 个监控的钉钉地址`);
                    } else {
                      const error = await response.json();
                      alert(`更新失败: ${error.error}`);
                    }
                  } catch (error) {
                    alert('更新失败，请检查网络连接');
                  }
                }}
                className="border-2 border-teal-500/60 text-teal-600 hover:bg-teal-500/10"
              >
                确认修改
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-lg font-bold text-foreground">信号监控</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            每个标的独立配置，指标实时更新，配置刷新后自动恢复
          </div>
        </div>
      </div>

      <div className="mt-6" />

      {displaySymbols.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">暂无追踪标的，请先在上方添加代码</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
          {displaySymbols.map((sym) => {
            const cfg = getConfig(sym.symbol);
            const rt = runtimes[sym.symbol];
            const isExpanded = expanded[sym.symbol] ?? false;

            return (
              <div
                key={sym.symbol}
                className={`rounded-2xl border-0 p-4 space-y-3 transition-all duration-300 glass-card price-card-hover ${
                  cfg.enabled && rt?.isGolden
                    ? "ring-2 ring-teal-400/50"
                    : ""
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{sym.displayName}</div>
                      <div className="text-xs text-muted-foreground">{sym.symbol}</div>
                    </div>
                    <SimpleSwitch
                      checked={cfg.enabled}
                      onCheckedChange={(v) => handleToggle(sym.symbol, v)}
                    />
                  </div>
                  {cfg.enabled && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      {rt?.loading && (
                        <span className="text-xs text-muted-foreground animate-pulse">加载</span>
                      )}
                      {!rt?.loading && rt?.trendStatus && (
                        <Badge 
                          className={`text-[10px] px-1.5 py-0.5 ${
                            rt.trendStatus === 'bullish' 
                              ? 'bg-green-500 text-white' 
                              : rt.trendStatus === 'bearish' 
                                ? 'bg-red-500 text-white' 
                                : 'bg-gray-500 text-white'
                          }`}
                        >
                          {rt.trendStatus === 'bullish' ? '🐂 多头趋势' : rt.trendStatus === 'bearish' ? '🐻 空头趋势' : '➖ 中性'}
                        </Badge>
                      )}
                      {!rt?.loading && rt?.isGolden && (
                        <Badge className="bg-teal-500 text-white text-[10px] px-1.5 py-0.5">✨ 已触发过信号</Badge>
                      )}
                      {!rt?.loading && rt?.hasSentSignal && !rt?.isGolden && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">已触发过信号</Badge>
                      )}
                      {!rt?.loading && rt && !rt.hasSentSignal && !rt.isGolden && rt.lastCheck && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">未触发</Badge>
                      )}
                    </div>
                  )}
                </div>

                {cfg.enabled && rt && !rt.error && (
                  <div className="space-y-1 text-xs">
                    <Separator />
                    <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
                      <span className="text-muted-foreground">当前价</span>
                      <span className="font-mono">{fmtVal(sym.currentPrice, true, isCNY)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma1Period}</span>
                      <span className="font-mono">{fmtVal(rt.ma1Val, true, isCNY)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma2Period}</span>
                      <span className="font-mono">{fmtVal(rt.ma2Val, true, isCNY)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma3Period}</span>
                      <span className="font-mono">{fmtVal(rt.ma3Val, true, isCNY)}</span>
                    </div>
                    {rt.condResults && rt.condResults.length > 0 && (
                      <div className="space-y-0.5 pt-0.5">
                        {cfg.conditions.map((c, i) => {
                          const ok = rt.condResults[i] ?? false;
                          return (
                            <div key={c.id} className="flex items-center gap-1.5">
                              <span className={ok ? "text-green-500" : "text-red-400"}>
                                {ok ? "✅" : "❌"}
                              </span>
                              <span className="text-muted-foreground">
                                {SIDE_LABELS[c.left]} {c.op} {SIDE_LABELS[c.right]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {rt.lastCheck && (
                      <div className="text-muted-foreground">
                        {rt.lastCheck.toLocaleTimeString("zh-CN")} · {cfg.interval} · {cfg.maType}
                      </div>
                    )}
                  </div>
                )}

                {cfg.enabled && rt?.error && (
                  <div className="text-xs text-red-500 break-all">{rt.error}</div>
                )}

                <div>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [sym.symbol]: !isExpanded }))
                    }
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    参数配置
                  </button>

                  {isExpanded && (
                    <div className="mt-2 space-y-3">
                      <Separator />

                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">K线周期</Label>
                          <select
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                            value={cfg.interval}
                            onChange={(e) => updateConfig(sym.symbol, { interval: e.target.value })}
                          >
                            {intervals.map((i) => <option key={i} value={i}>{i}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">均线类型</Label>
                          <select
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                            value={cfg.maType}
                            onChange={(e) => updateConfig(sym.symbol, { maType: e.target.value as MAType })}
                          >
                            {MA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">信号类型</Label>
                          <select
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                            value={cfg.signalType}
                            onChange={(e) => updateConfig(sym.symbol, { signalType: e.target.value as SignalType })}
                          >
                            <option value="golden">金叉</option>
                            <option value="death">死叉</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">短期周期</Label>
                          <NumInput
                            value={cfg.ma1Period}
                            onChange={(v) => updateConfig(sym.symbol, { ma1Period: v })}
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">中期周期</Label>
                          <NumInput
                            value={cfg.ma2Period}
                            onChange={(v) => updateConfig(sym.symbol, { ma2Period: v })}
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">长期周期</Label>
                          <NumInput
                            value={cfg.ma3Period}
                            onChange={(v) => updateConfig(sym.symbol, { ma3Period: v })}
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="mt-8">
                        <Label className="text-xs">触发条件（全部满足才触发）</Label>
                        <div style={{ height: '12px' }}></div>
                        <div>
                          {cfg.conditions.map((c, i) => (
                            <div key={c.id} className={i < cfg.conditions.length - 1 ? 'mb-6' : ''}>
                              <ConditionEditor
                                cond={c}
                                onChange={(updated) => {
                                  const newConds = cfg.conditions.map((x, j) => j === i ? updated : x);
                                  updateConfig(sym.symbol, { conditions: newConds });
                                }}
                                onRemove={() => {
                                  const newConds = cfg.conditions.filter((_, j) => j !== i);
                                  updateConfig(sym.symbol, { conditions: newConds });
                                }}
                                canRemove={cfg.conditions.length > 1}
                              />
                            </div>
                          ))}
                        </div>
                        <button
                          className="flex items-center gap-1 text-xs text-primary hover:opacity-75 transition-opacity mt-6"
                          onClick={() => {
                            const newCond: Condition = {
                              id: Date.now().toString(),
                              left: "price",
                              op: ">",
                              right: "ma1",
                            };
                            updateConfig(sym.symbol, { conditions: [...cfg.conditions, newCond] });
                          }}
                        >
                          <Plus className="w-3 h-3" /> 添加条件
                        </button>
                      </div>

                      {/* 离场监控配置 */}
                      <div className="mt-8">
                        <Separator />
                        <div style={{ height: '16px' }}></div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold">🚨 离场监控</Label>
                            <SimpleSwitch
                              checked={cfg.enableExitMonitor ?? false}
                              onCheckedChange={(v) => updateConfig(sym.symbol, { enableExitMonitor: v })}
                            />
                          </div>
                          
                          {cfg.enableExitMonitor && (
                            <div className="space-y-3 pt-2">
                              {/* 市场模式选择 */}
                              <div className="space-y-1">
                                <Label className="text-xs">市场模式</Label>
                                <select
                                  className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                                  value={cfg.exitMarketMode ?? "bullish"}
                                  onChange={(e) => updateConfig(sym.symbol, { exitMarketMode: e.target.value as ExitMarketMode })}
                                >
                                  <option value="bullish">🐂 牛市 - 价格≤MA10离场</option>
                                  <option value="bearish">🐻 熊市 - 收盘价≤昨日离场</option>
                                </select>
                              </div>
                              
                              {/* 说明文字 */}
                              <div className="text-[10px] text-muted-foreground">
                                {cfg.exitMarketMode === "bullish" 
                                  ? "牛市模式：当价格跌破或等于MA10时发送离场提醒"
                                  : "熊市模式：当当天收盘价小于等于上一天收盘价时发送离场提醒"
                                }
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
