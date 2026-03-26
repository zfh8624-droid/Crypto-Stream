import { useState, useEffect, useRef, useCallback } from "react";
import { calcMA, MAType } from "@/lib/ma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronUp } from "lucide-react";

export type AssetType = "crypto" | "ashare";

export interface MonitoredSymbol {
  symbol: string;
  displayName: string;
  currentPrice: number | null;
}

export interface GoldenCrossConfig {
  enabled: boolean;
  interval: string;
  ma1: number;
  ma2: number;
  ma3: number;
  maType: MAType;
}

interface SymbolState {
  ma1Val: number | null;
  ma2Val: number | null;
  ma3Val: number | null;
  isGolden: boolean;
  inSignal: boolean;
  lastCheck: Date | null;
  error: string | null;
  loading: boolean;
}

const CRYPTO_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const ASHARE_INTERVALS = ["5m", "15m", "30m", "1h", "1d"];
const MA_TYPES: MAType[] = ["SMA", "EMA", "WMA"];

const DEFAULT_CONFIG: GoldenCrossConfig = {
  enabled: false,
  interval: "1h",
  ma1: 7,
  ma2: 25,
  ma3: 99,
  maType: "SMA",
};

async function fetchCloses(
  symbol: string,
  interval: string,
  type: AssetType,
  limit: number
): Promise<number[]> {
  const params = new URLSearchParams({ symbol, interval, type, limit: String(limit) });
  const res = await fetch(`/api/kline/data?${params}`);
  if (!res.ok) throw new Error(`K-line fetch failed: ${res.status}`);
  const data = (await res.json()) as { closes: number[] };
  return data.closes;
}

async function sendDingTalkAlert(content: string): Promise<void> {
  const res = await fetch("/api/notify/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Notify failed: ${res.status}`);
}

interface Props {
  assetType: AssetType;
  symbols: MonitoredSymbol[];
}

export function GoldenCrossMonitor({ assetType, symbols }: Props) {
  const intervals = assetType === "crypto" ? CRYPTO_INTERVALS : ASHARE_INTERVALS;

  const [configs, setConfigs] = useState<Record<string, GoldenCrossConfig>>({});
  const [editConfigs, setEditConfigs] = useState<Record<string, GoldenCrossConfig>>({});
  const [states, setStates] = useState<Record<string, SymbolState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testMsg, setTestMsg] = useState("");
  const timersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const getConfig = useCallback(
    (symbol: string): GoldenCrossConfig =>
      configs[symbol] ?? { ...DEFAULT_CONFIG, interval: intervals[4] ?? "1h" },
    [configs, intervals]
  );

  const getEditConfig = useCallback(
    (symbol: string): GoldenCrossConfig =>
      editConfigs[symbol] ?? { ...DEFAULT_CONFIG, interval: intervals[4] ?? "1h" },
    [editConfigs, intervals]
  );

  const setEditField = (symbol: string, patch: Partial<GoldenCrossConfig>) => {
    setEditConfigs((prev) => ({
      ...prev,
      [symbol]: { ...getEditConfig(symbol), ...patch },
    }));
  };

  const checkSymbol = useCallback(
    async (sym: MonitoredSymbol, cfg: GoldenCrossConfig) => {
      const maxPeriod = Math.max(cfg.ma1, cfg.ma2, cfg.ma3);
      const limit = maxPeriod + 50;

      setStates((prev) => ({
        ...prev,
        [sym.symbol]: { ...prev[sym.symbol], loading: true, error: null },
      }));

      try {
        let closes = await fetchCloses(sym.symbol, cfg.interval, assetType, limit);

        if (sym.currentPrice != null && closes.length > 0) {
          closes = [...closes.slice(0, -1), sym.currentPrice];
        }

        const ma1Val = calcMA(closes, cfg.ma1, cfg.maType);
        const ma2Val = calcMA(closes, cfg.ma2, cfg.maType);
        const ma3Val = calcMA(closes, cfg.ma3, cfg.maType);
        const price = sym.currentPrice ?? (closes[closes.length - 1] ?? null);

        const isGolden =
          ma1Val !== null &&
          ma2Val !== null &&
          ma3Val !== null &&
          price !== null &&
          price > ma3Val &&
          ma1Val > ma2Val;

        setStates((prev) => {
          const prevState = prev[sym.symbol];
          const wasInSignal = prevState?.inSignal ?? false;
          const newInSignal = isGolden;
          const isNewSignal = isGolden && !wasInSignal;

          if (isNewSignal) {
            const fmt = (v: number) =>
              v < 1 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2);
            const msg =
              `🔔 金叉信号！\n` +
              `标的：${sym.displayName}（${sym.symbol}）\n` +
              `周期：${cfg.interval}  均线类型：${cfg.maType}\n` +
              `当前价：${price != null ? fmt(price) : "-"}\n` +
              `MA${cfg.ma1}：${ma1Val != null ? fmt(ma1Val) : "-"}\n` +
              `MA${cfg.ma2}：${ma2Val != null ? fmt(ma2Val) : "-"}\n` +
              `MA${cfg.ma3}：${ma3Val != null ? fmt(ma3Val) : "-"}\n` +
              `✅ 价格 > MA${cfg.ma3}  ✅ MA${cfg.ma1} > MA${cfg.ma2}`;

            sendDingTalkAlert(msg).catch((e) =>
              console.error("DingTalk send failed", e)
            );
          }

          return {
            ...prev,
            [sym.symbol]: {
              ma1Val,
              ma2Val,
              ma3Val,
              isGolden,
              inSignal: newInSignal,
              lastCheck: new Date(),
              error: null,
              loading: false,
            },
          };
        });
      } catch (err) {
        setStates((prev) => ({
          ...prev,
          [sym.symbol]: {
            ...(prev[sym.symbol] ?? {
              ma1Val: null,
              ma2Val: null,
              ma3Val: null,
              isGolden: false,
              inSignal: false,
              lastCheck: null,
            }),
            loading: false,
            error: String(err),
          },
        }));
      }
    },
    [assetType]
  );

  const startTimer = useCallback(
    (sym: MonitoredSymbol, cfg: GoldenCrossConfig) => {
      const key = sym.symbol;
      if (timersRef.current[key]) clearInterval(timersRef.current[key]);
      checkSymbol(sym, cfg);
      timersRef.current[key] = setInterval(() => checkSymbol(sym, cfg), 30_000);
    },
    [checkSymbol]
  );

  const stopTimer = useCallback((symbol: string) => {
    if (timersRef.current[symbol]) {
      clearInterval(timersRef.current[symbol]);
      delete timersRef.current[symbol];
    }
  }, []);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearInterval);
    };
  }, []);

  useEffect(() => {
    for (const sym of symbols) {
      const cfg = configs[sym.symbol];
      if (!cfg) continue;
      if (cfg.enabled && sym.currentPrice != null) {
        startTimer(sym, cfg);
      } else if (!cfg.enabled) {
        stopTimer(sym.symbol);
      }
    }
  }, [configs, symbols, startTimer, stopTimer]);

  const handleApply = (sym: MonitoredSymbol) => {
    const newCfg = getEditConfig(sym.symbol);
    setConfigs((prev) => ({ ...prev, [sym.symbol]: newCfg }));
  };

  const handleToggle = (sym: MonitoredSymbol, enabled: boolean) => {
    const current = getConfig(sym.symbol);
    const updated = { ...current, enabled };
    setConfigs((prev) => ({ ...prev, [sym.symbol]: updated }));
    setEditConfigs((prev) => ({ ...prev, [sym.symbol]: updated }));
  };

  const handleTestSend = async () => {
    setTestStatus("sending");
    setTestMsg("");
    try {
      const res = await fetch("/api/notify/test", { method: "POST" });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        setTestStatus("ok");
        setTestMsg("发送成功！");
      } else {
        setTestStatus("err");
        setTestMsg(data.error ?? "发送失败");
      }
    } catch (e) {
      setTestStatus("err");
      setTestMsg(String(e));
    }
    setTimeout(() => setTestStatus("idle"), 4000);
  };

  const fmtVal = (v: number | null) =>
    v == null ? "-" : v < 1 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2);

  const activeSymbols = symbols.filter((s) => s.currentPrice != null);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold text-base">金叉信号监控</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            每个标的独立配置：K线周期、均线参数、启停
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestSend}
            disabled={testStatus === "sending"}
          >
            {testStatus === "sending" ? "发送中..." : "📡 测试钉钉连通性"}
          </Button>
          {testStatus !== "idle" && (
            <span
              className={`text-xs font-medium ${
                testStatus === "ok" ? "text-green-600" : "text-red-500"
              }`}
            >
              {testMsg}
            </span>
          )}
        </div>
      </div>

      {activeSymbols.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">
          没有正在追踪的标的，请先在上方添加代码
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeSymbols.map((sym) => {
            const cfg = getConfig(sym.symbol);
            const edit = getEditConfig(sym.symbol);
            const st = states[sym.symbol];
            const isExpanded = expanded[sym.symbol] ?? false;

            return (
              <div
                key={sym.symbol}
                className={`rounded-lg border p-3 space-y-2 transition-colors ${
                  cfg.enabled && st?.isGolden
                    ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {sym.displayName}
                    </div>
                    <div className="text-xs text-muted-foreground">{sym.symbol}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cfg.enabled && st?.loading && (
                      <span className="text-xs text-muted-foreground animate-pulse">
                        检查中
                      </span>
                    )}
                    {cfg.enabled && !st?.loading && st?.isGolden && (
                      <Badge className="bg-yellow-500 text-white text-xs">✨ 金叉</Badge>
                    )}
                    {cfg.enabled && !st?.loading && st && !st.isGolden && st.lastCheck && (
                      <Badge variant="secondary" className="text-xs">未成立</Badge>
                    )}
                    <Switch
                      checked={cfg.enabled}
                      onCheckedChange={(v) => handleToggle(sym, v)}
                    />
                  </div>
                </div>

                {cfg.enabled && st && !st.error && st.lastCheck && (
                  <div className="space-y-1 text-xs">
                    <Separator />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma1}</span>
                      <span className="font-mono">{fmtVal(st.ma1Val)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma2}</span>
                      <span className="font-mono">{fmtVal(st.ma2Val)}</span>
                      <span className="text-muted-foreground">{cfg.maType}{cfg.ma3}</span>
                      <span className="font-mono">{fmtVal(st.ma3Val)}</span>
                    </div>
                    <div className="space-y-0.5 pt-0.5">
                      <ConditionRow
                        label={`价格 > ${cfg.maType}${cfg.ma3}`}
                        ok={
                          st.ma3Val != null &&
                          sym.currentPrice != null &&
                          sym.currentPrice > st.ma3Val
                        }
                      />
                      <ConditionRow
                        label={`${cfg.maType}${cfg.ma1} > ${cfg.maType}${cfg.ma2}`}
                        ok={st.ma1Val != null && st.ma2Val != null && st.ma1Val > st.ma2Val}
                      />
                    </div>
                    <div className="text-muted-foreground">
                      {st.lastCheck.toLocaleTimeString("zh-CN")} · {cfg.interval} · {cfg.maType}
                    </div>
                  </div>
                )}

                {cfg.enabled && st?.error && (
                  <div className="text-xs text-red-500">{st.error}</div>
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
                    <div className="mt-2 space-y-2">
                      <Separator />
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">K线周期</Label>
                          <select
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={edit.interval}
                            onChange={(e) =>
                              setEditField(sym.symbol, { interval: e.target.value })
                            }
                          >
                            {intervals.map((i) => (
                              <option key={i} value={i}>{i}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">均线类型</Label>
                          <select
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={edit.maType}
                            onChange={(e) =>
                              setEditField(sym.symbol, { maType: e.target.value as MAType })
                            }
                          >
                            {MA_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">短期（MA{edit.ma1}）</Label>
                          <Input
                            type="number"
                            min={1}
                            max={500}
                            value={edit.ma1}
                            onChange={(e) =>
                              setEditField(sym.symbol, {
                                ma1: Math.max(1, parseInt(e.target.value) || 7),
                              })
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">中期（MA{edit.ma2}）</Label>
                          <Input
                            type="number"
                            min={1}
                            max={500}
                            value={edit.ma2}
                            onChange={(e) =>
                              setEditField(sym.symbol, {
                                ma2: Math.max(1, parseInt(e.target.value) || 25),
                              })
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">长期（MA{edit.ma3}）</Label>
                          <Input
                            type="number"
                            min={1}
                            max={500}
                            value={edit.ma3}
                            onChange={(e) =>
                              setEditField(sym.symbol, {
                                ma3: Math.max(1, parseInt(e.target.value) || 99),
                              })
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="w-full h-8 text-xs"
                        onClick={() => handleApply(sym)}
                      >
                        应用配置
                      </Button>
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

function ConditionRow({
  label,
  ok,
}: {
  label: string;
  ok: boolean | null | undefined;
}) {
  if (ok == null) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={ok ? "text-green-500" : "text-red-400"}>{ok ? "✅" : "❌"}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
