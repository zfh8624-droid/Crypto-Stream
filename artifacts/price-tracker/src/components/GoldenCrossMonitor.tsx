import { useState, useEffect, useRef, useCallback } from "react";
import { calcMA, MAType } from "@/lib/ma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

export type AssetType = "crypto" | "ashare";

export interface MonitoredSymbol {
  symbol: string;
  displayName: string;
  currentPrice: number | null;
}

type Side = "price" | "ma1" | "ma2" | "ma3";
type Op = ">" | "<" | "=";

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
}

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

const DEFAULT_CONFIG: SymbolConfig = {
  enabled: false,
  interval: "1h",
  maType: "SMA",
  ma1Period: 7,
  ma2Period: 25,
  ma3Period: 99,
  conditions: DEFAULT_CONDITIONS,
};

const CACHE_TTL = 5 * 60 * 1000;

function storageKey(assetType: AssetType, symbol: string) {
  return `gc_v2_${assetType}_${symbol}`;
}

function loadConfig(assetType: AssetType, symbol: string): SymbolConfig {
  try {
    const raw = localStorage.getItem(storageKey(assetType, symbol));
    if (!raw) return { ...DEFAULT_CONFIG };
    const p = JSON.parse(raw) as SymbolConfig;
    if (!Array.isArray(p.conditions) || p.conditions.length === 0) {
      p.conditions = [...DEFAULT_CONDITIONS];
    }
    return p;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(assetType: AssetType, symbol: string, cfg: SymbolConfig) {
  try {
    localStorage.setItem(storageKey(assetType, symbol), JSON.stringify(cfg));
  } catch { }
}

async function apiFetchCloses(
  symbol: string,
  interval: string,
  type: AssetType,
  limit: number
): Promise<number[]> {
  if (type === "crypto") {
    // Fetch directly from Binance in the browser (backend is geo-blocked 451)
    const params = new URLSearchParams({
      symbol: `${symbol}USDT`,
      interval,
      limit: String(limit),
    });
    const res = await fetch(`https://api.binance.com/api/v3/klines?${params}`);
    if (!res.ok) throw new Error(`Binance K线请求失败 (${res.status})`);
    const rows = await res.json() as unknown[][];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Binance K线数据为空");
    return rows.map((r) => parseFloat(r[4] as string)); // index 4 = close price
  }

  // A-share: use backend proxy
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

async function sendAlert(content: string) {
  await fetch("/api/notify/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
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

function fmtVal(v: number | null): string {
  if (v == null) return "-";
  if (v === 0) return "0";
  return v < 1 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2);
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
    <div className="flex items-center gap-1.5 flex-wrap">
      <select
        className={sel}
        value={cond.left}
        onChange={(e) => onChange({ ...cond, left: e.target.value as Side })}
      >
        {SIDES.map((s) => (
          <option key={s} value={s}>{SIDE_LABELS[s]}</option>
        ))}
      </select>
      <select
        className={`${sel} w-10`}
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value as Op })}
      >
        {OPS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <select
        className={sel}
        value={cond.right}
        onChange={(e) => onChange({ ...cond, right: e.target.value as Side })}
      >
        {SIDES.map((s) => (
          <option key={s} value={s}>{SIDE_LABELS[s]}</option>
        ))}
      </select>
      {canRemove && (
        <button
          className="text-muted-foreground hover:text-red-500 transition-colors"
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
}

export function GoldenCrossMonitor({ assetType, symbols }: Props) {
  const intervals = assetType === "crypto" ? CRYPTO_INTERVALS : ASHARE_INTERVALS;

  const [configs, setConfigs] = useState<Record<string, SymbolConfig>>({});
  const [runtimes, setRuntimes] = useState<Record<string, SymbolRuntime>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testMsg, setTestMsg] = useState("");

  const closesCache = useRef<Record<string, ClosesCache>>({});
  const refreshTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const configsRef = useRef(configs);
  configsRef.current = configs;
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const getConfig = useCallback(
    (symbol: string): SymbolConfig => configs[symbol] ?? loadConfig(assetType, symbol),
    [configs, assetType]
  );

  useEffect(() => {
    const missing = symbols.filter((s) => !(s.symbol in configs));
    if (missing.length === 0) return;
    setConfigs((prev) => {
      const next = { ...prev };
      for (const sym of missing) next[sym.symbol] = loadConfig(assetType, sym.symbol);
      return next;
    });
  }, [symbols.map((s) => s.symbol).join(","), assetType]);

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
        const wasInSignal = prevRt?.inSignal ?? false;
        const isNewSignal = isGolden && !wasInSignal;

        if (isNewSignal) {
          const msg =
            `🔔 金叉信号！\n` +
            `标的：${sym.displayName}（${sym.symbol}）\n` +
            `周期：${cfg.interval}  均线类型：${cfg.maType}\n` +
            `当前价：${fmtVal(sym.currentPrice)}\n` +
            `MA${cfg.ma1Period}（短）：${fmtVal(ma1Val)}\n` +
            `MA${cfg.ma2Period}（中）：${fmtVal(ma2Val)}\n` +
            `MA${cfg.ma3Period}（长）：${fmtVal(ma3Val)}\n` +
            cfg.conditions
              .map((c) => `${SIDE_LABELS[c.left]} ${c.op} ${SIDE_LABELS[c.right]}`)
              .join("，");
          sendAlert(msg).catch((e) => console.error("钉钉推送失败", e));
        }

        return {
          ...prev,
          [sym.symbol]: {
            ma1Val,
            ma2Val,
            ma3Val,
            condResults,
            isGolden,
            inSignal: isGolden,
            lastCheck: new Date(),
            error: null,
            loading: false,
          },
        };
      });
    },
    []
  );

  const fetchAndActivate = useCallback(
    async (sym: MonitoredSymbol, cfg: SymbolConfig) => {
      if (sym.currentPrice == null) return;

      const maxPeriod = Math.max(cfg.ma1Period, cfg.ma2Period, cfg.ma3Period);

      setRuntimes((prev) => ({
        ...prev,
        [sym.symbol]: {
          ...(prev[sym.symbol] ?? {
            ma1Val: null, ma2Val: null, ma3Val: null,
            condResults: [], isGolden: false, inSignal: false, lastCheck: null,
          }),
          loading: true,
          error: null,
        } as SymbolRuntime,
      }));

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
        setRuntimes((prev) => ({
          ...prev,
          [sym.symbol]: {
            ...(prev[sym.symbol] ?? {
              ma1Val: null, ma2Val: null, ma3Val: null,
              condResults: [], isGolden: false, inSignal: false, lastCheck: null,
            }),
            loading: false,
            error: String(err),
          } as SymbolRuntime,
        }));
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
      setConfigs((prev) => {
        const current = prev[symbol] ?? loadConfig(assetType, symbol);
        const updated = { ...current, ...patch };
        saveConfig(assetType, symbol, updated);

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

        return { ...prev, [symbol]: updated };
      });
    },
    [assetType]
  );

  const handleToggle = useCallback(
    (symbol: string, enabled: boolean) => updateConfig(symbol, { enabled }),
    [updateConfig]
  );

  const handleTestSend = async () => {
    setTestStatus("sending");
    setTestMsg("");
    try {
      const res = await fetch("/api/notify/test", { method: "POST" });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) { setTestStatus("ok"); setTestMsg("发送成功！"); }
      else { setTestStatus("err"); setTestMsg(data.error ?? "发送失败"); }
    } catch (e) {
      setTestStatus("err");
      setTestMsg(String(e));
    }
    setTimeout(() => setTestStatus("idle"), 4000);
  };

  const activeSymbols = symbols.filter((s) => s.currentPrice != null);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold text-base">金叉信号监控</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            每个标的独立配置，指标实时更新，配置刷新后自动恢复
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={handleTestSend} disabled={testStatus === "sending"}>
            {testStatus === "sending" ? "发送中..." : "📡 测试钉钉"}
          </Button>
          {testStatus !== "idle" && (
            <span className={`text-xs font-medium ${testStatus === "ok" ? "text-green-600" : "text-red-500"}`}>
              {testMsg}
            </span>
          )}
        </div>
      </div>

      {activeSymbols.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">暂无追踪标的，请先在上方添加代码</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeSymbols.map((sym) => {
            const cfg = getConfig(sym.symbol);
            const rt = runtimes[sym.symbol];
            const isExpanded = expanded[sym.symbol] ?? false;

            return (
              <div
                key={sym.symbol}
                className={`rounded-lg border p-3 space-y-2 transition-colors ${
                  cfg.enabled && rt?.isGolden
                    ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{sym.displayName}</div>
                    <div className="text-xs text-muted-foreground">{sym.symbol}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cfg.enabled && rt?.loading && (
                      <span className="text-xs text-muted-foreground animate-pulse">加载</span>
                    )}
                    {cfg.enabled && !rt?.loading && rt?.isGolden && (
                      <Badge className="bg-yellow-500 text-white text-xs">✨ 信号</Badge>
                    )}
                    {cfg.enabled && !rt?.loading && rt && !rt.isGolden && rt.lastCheck && (
                      <Badge variant="secondary" className="text-xs">未触发</Badge>
                    )}
                    <Switch
                      checked={cfg.enabled}
                      onCheckedChange={(v) => handleToggle(sym.symbol, v)}
                    />
                  </div>
                </div>

                {cfg.enabled && rt && !rt.error && rt.lastCheck && (
                  <div className="space-y-1 text-xs">
                    <Separator />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span className="text-muted-foreground">当前价</span>
                      <span className="font-mono">{fmtVal(sym.currentPrice)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma1Period}</span>
                      <span className="font-mono">{fmtVal(rt.ma1Val)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma2Period}</span>
                      <span className="font-mono">{fmtVal(rt.ma2Val)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma3Period}</span>
                      <span className="font-mono">{fmtVal(rt.ma3Val)}</span>
                    </div>
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
                    <div className="text-muted-foreground">
                      {rt.lastCheck.toLocaleTimeString("zh-CN")} · {cfg.interval} · {cfg.maType}
                    </div>
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

                      <div className="grid grid-cols-2 gap-2">
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
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">短期周期</Label>
                          <NumInput
                            value={cfg.ma1Period}
                            onChange={(v) => updateConfig(sym.symbol, { ma1Period: v })}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">中期周期</Label>
                          <NumInput
                            value={cfg.ma2Period}
                            onChange={(v) => updateConfig(sym.symbol, { ma2Period: v })}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">长期周期</Label>
                          <NumInput
                            value={cfg.ma3Period}
                            onChange={(v) => updateConfig(sym.symbol, { ma3Period: v })}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">触发条件（全部满足才触发）</Label>
                        <div className="space-y-1.5">
                          {cfg.conditions.map((c, i) => (
                            <ConditionEditor
                              key={c.id}
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
                          ))}
                        </div>
                        <button
                          className="flex items-center gap-1 text-xs text-primary hover:opacity-75 transition-opacity"
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
