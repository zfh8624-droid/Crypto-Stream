import { useState, useEffect, useRef, useCallback } from "react";
import { calcMA, MAType } from "@/lib/ma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

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
  const [config, setConfig] = useState<GoldenCrossConfig>(DEFAULT_CONFIG);
  const [editConfig, setEditConfig] = useState<GoldenCrossConfig>(DEFAULT_CONFIG);
  const [states, setStates] = useState<Record<string, SymbolState>>({});
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testMsg, setTestMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const intervals = assetType === "crypto" ? CRYPTO_INTERVALS : ASHARE_INTERVALS;

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
          const newInSignal = isGolden ? true : false;
          const isNewSignal = isGolden && !wasInSignal;

          if (isNewSignal) {
            const priceStr =
              price != null
                ? price < 10
                  ? price.toFixed(4)
                  : price.toFixed(2)
                : "-";
            const ma1Str = ma1Val != null ? ma1Val.toFixed(4) : "-";
            const ma2Str = ma2Val != null ? ma2Val.toFixed(4) : "-";
            const ma3Str = ma3Val != null ? ma3Val.toFixed(4) : "-";

            const msg =
              `🔔 金叉信号！\n` +
              `标的：${sym.displayName}（${sym.symbol}）\n` +
              `周期：${cfg.interval}  均线类型：${cfg.maType}\n` +
              `当前价：${priceStr}\n` +
              `MA${cfg.ma1}：${ma1Str}\n` +
              `MA${cfg.ma2}：${ma2Str}\n` +
              `MA${cfg.ma3}：${ma3Str}\n` +
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

  const runChecks = useCallback(
    (cfg: GoldenCrossConfig) => {
      for (const sym of symbols) {
        if (sym.currentPrice != null) {
          checkSymbol(sym, cfg);
        }
      }
    },
    [symbols, checkSymbol]
  );

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!config.enabled) return;

    runChecks(config);
    timerRef.current = setInterval(() => runChecks(config), 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [config, runChecks]);

  const handleApply = () => {
    setConfig({ ...editConfig });
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
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-base">金叉信号监控</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            条件：价格 {">"} MA{editConfig.ma3} 且 MA{editConfig.ma1} {">"} MA
            {editConfig.ma2}，首次出现推送钉钉
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">启用</Label>
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => setConfig((c) => ({ ...c, enabled: v }))}
          />
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">K线周期</Label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={editConfig.interval}
            onChange={(e) =>
              setEditConfig((c) => ({ ...c, interval: e.target.value }))
            }
          >
            {intervals.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">均线类型</Label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={editConfig.maType}
            onChange={(e) =>
              setEditConfig((c) => ({ ...c, maType: e.target.value as MAType }))
            }
          >
            {MA_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">短期均线周期</Label>
          <Input
            type="number"
            min={1}
            max={500}
            value={editConfig.ma1}
            onChange={(e) =>
              setEditConfig((c) => ({
                ...c,
                ma1: Math.max(1, parseInt(e.target.value) || 7),
              }))
            }
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">中期均线周期</Label>
          <Input
            type="number"
            min={1}
            max={500}
            value={editConfig.ma2}
            onChange={(e) =>
              setEditConfig((c) => ({
                ...c,
                ma2: Math.max(1, parseInt(e.target.value) || 25),
              }))
            }
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">长期均线周期</Label>
          <Input
            type="number"
            min={1}
            max={500}
            value={editConfig.ma3}
            onChange={(e) =>
              setEditConfig((c) => ({
                ...c,
                ma3: Math.max(1, parseInt(e.target.value) || 99),
              }))
            }
            className="text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" onClick={handleApply}>
          应用配置
        </Button>
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

      {config.enabled && (
        <>
          <Separator />
          {activeSymbols.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              没有正在追踪的标的，请先在上方添加代码
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                每 30 秒自动检查 · 当前配置：{config.maType} MA{config.ma1} /
                MA{config.ma2} / MA{config.ma3} · 周期 {config.interval}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeSymbols.map((sym) => {
                  const st = states[sym.symbol];
                  return (
                    <div
                      key={sym.symbol}
                      className={`rounded-lg border p-3 transition-colors ${
                        st?.isGolden
                          ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30"
                          : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-sm">{sym.displayName}</div>
                        {st?.loading && (
                          <span className="text-xs text-muted-foreground animate-pulse">
                            计算中...
                          </span>
                        )}
                        {!st?.loading && st?.isGolden && (
                          <Badge className="bg-yellow-500 text-white text-xs">
                            ✨ 金叉
                          </Badge>
                        )}
                        {!st?.loading && st && !st.isGolden && st.lastCheck && (
                          <Badge variant="secondary" className="text-xs">
                            未成立
                          </Badge>
                        )}
                      </div>

                      {st?.error ? (
                        <div className="text-xs text-red-500">{st.error}</div>
                      ) : (
                        <div className="space-y-1 text-xs">
                          <div className="grid grid-cols-2 gap-x-3">
                            <span className="text-muted-foreground">
                              {config.maType} {config.ma1}
                            </span>
                            <span className="font-mono">{fmtVal(st?.ma1Val ?? null)}</span>
                            <span className="text-muted-foreground">
                              {config.maType} {config.ma2}
                            </span>
                            <span className="font-mono">{fmtVal(st?.ma2Val ?? null)}</span>
                            <span className="text-muted-foreground">
                              {config.maType} {config.ma3}
                            </span>
                            <span className="font-mono">{fmtVal(st?.ma3Val ?? null)}</span>
                          </div>
                          <div className="pt-1 space-y-0.5">
                            <ConditionRow
                              label={`价格 > ${config.maType}${config.ma3}`}
                              ok={
                                st?.ma3Val != null &&
                                sym.currentPrice != null &&
                                sym.currentPrice > st.ma3Val
                              }
                            />
                            <ConditionRow
                              label={`${config.maType}${config.ma1} > ${config.maType}${config.ma2}`}
                              ok={
                                st?.ma1Val != null &&
                                st?.ma2Val != null &&
                                st.ma1Val > st.ma2Val
                              }
                            />
                          </div>
                          {st?.lastCheck && (
                            <div className="text-muted-foreground pt-1">
                              {st.lastCheck.toLocaleTimeString("zh-CN")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConditionRow({ label, ok }: { label: string; ok: boolean | null | undefined }) {
  if (ok == null) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={ok ? "text-green-500" : "text-red-400"}>{ok ? "✅" : "❌"}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
