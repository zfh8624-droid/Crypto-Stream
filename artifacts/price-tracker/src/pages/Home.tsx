import { useState, useMemo, useCallback } from "react";
import { useBinanceTracker, useFinnhubTracker, PriceEntry } from "@/hooks/usePriceTracker";
import { useAShareTracker, AShareQuote } from "@/hooks/useAShareWS";
import { WSStatus } from "@/hooks/useWebSocket";
import { GoldenCrossMonitor, MonitoredSymbol } from "@/components/GoldenCrossMonitor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

const DEFAULT_BINANCE_WS = "wss://stream.binance.com:9443";
const DEFAULT_CRYPTO_SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "XRP"];

const DEFAULT_FINNHUB_WS = "wss://ws.finnhub.io";
const DEFAULT_FINNHUB_TOKEN = "";
const DEFAULT_STOCK_SYMBOLS = ["AAPL", "GOOGL", "TSLA", "AMZN", "MSFT"];

const DEFAULT_ASHARE_SYMBOLS = [
  "sh510300",
  "sh510500",
  "sh510050",
  "sh600519",
  "sz000001",
];

function StatusDot({ status }: { status: WSStatus }) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
      ? "bg-yellow-400 animate-pulse"
      : status === "error"
      ? "bg-red-500"
      : "bg-gray-400";
  const label =
    status === "connected"
      ? "已连接"
      : status === "connecting"
      ? "连接中..."
      : status === "error"
      ? "连接错误"
      : "未连接";

  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function PriceCard({ entry }: { entry: PriceEntry }) {
  const isUp = (entry.change24hPct ?? 0) >= 0;
  const flashClass =
    entry.flash === "up"
      ? "bg-green-50 dark:bg-green-950"
      : entry.flash === "down"
      ? "bg-red-50 dark:bg-red-950"
      : "";

  return (
    <div className={`rounded-xl border border-border p-4 transition-colors duration-300 ${flashClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-lg leading-none">{entry.symbol}</div>
          {entry.lastUpdate && (
            <div className="text-xs text-muted-foreground mt-1">
              {entry.lastUpdate.toLocaleTimeString("zh-CN")}
            </div>
          )}
        </div>
        {entry.change24hPct != null && (
          <Badge variant={isUp ? "default" : "destructive"} className="text-xs shrink-0">
            {isUp ? "+" : ""}{entry.change24hPct.toFixed(2)}%
          </Badge>
        )}
      </div>
      <div className="mt-3">
        {entry.price != null ? (
          <span
            className={`text-2xl font-mono font-bold transition-colors duration-300 ${
              entry.flash === "up" ? "text-green-600 dark:text-green-400"
              : entry.flash === "down" ? "text-red-600 dark:text-red-400"
              : ""
            }`}
          >
            ${entry.price.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: entry.price < 1 ? 6 : 2,
            })}
          </span>
        ) : (
          <span className="text-2xl font-mono font-bold text-muted-foreground">等待数据...</span>
        )}
      </div>
      {entry.volume != null && (
        <div className="mt-1 text-xs text-muted-foreground">
          成交量: {entry.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

function AShareCard({ quote }: { quote: AShareQuote }) {
  const isUp = quote.changePct >= 0;
  const flashClass =
    quote.flash === "up" ? "bg-green-50 dark:bg-green-950"
    : quote.flash === "down" ? "bg-red-50 dark:bg-red-950"
    : "";

  return (
    <div className={`rounded-xl border border-border p-4 transition-colors duration-300 ${flashClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-base leading-none">{quote.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{quote.code}</div>
          {quote.time && <div className="text-xs text-muted-foreground mt-1">{quote.time}</div>}
        </div>
        <Badge variant={isUp ? "default" : "destructive"} className="text-xs shrink-0">
          {isUp ? "+" : ""}{quote.changePct.toFixed(2)}%
        </Badge>
      </div>
      <div className="mt-3">
        <span
          className={`text-2xl font-mono font-bold transition-colors duration-300 ${
            quote.flash === "up" ? "text-green-600 dark:text-green-400"
            : quote.flash === "down" ? "text-red-600 dark:text-red-400"
            : ""
          }`}
        >
          ¥{quote.price.toFixed(3)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
        <div>涨跌额: <span className={isUp ? "text-green-600" : "text-red-500"}>{isUp ? "+" : ""}{quote.change.toFixed(3)}</span></div>
        <div>昨收: {quote.prevClose.toFixed(3)}</div>
        <div>今开: {quote.open.toFixed(3)}</div>
        <div>最高: {quote.high.toFixed(3)}</div>
        <div>最低: {quote.low.toFixed(3)}</div>
        <div>成交量: {(quote.volume / 10000).toFixed(0)}万手</div>
      </div>
    </div>
  );
}

function AShareEmptyCard({ code }: { code: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="font-bold text-base leading-none text-muted-foreground">{code}</div>
      <div className="mt-3 text-2xl font-mono font-bold text-muted-foreground">等待数据...</div>
    </div>
  );
}

function SymbolInput({
  label, symbols, onAdd, onRemove, placeholder, uppercase = false,
}: {
  label: string; symbols: string[]; onAdd: (s: string) => void;
  onRemove: (s: string) => void; placeholder: string; uppercase?: boolean;
}) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const sym = uppercase ? input.trim().toUpperCase() : input.trim().toLowerCase();
    if (sym && !symbols.includes(sym)) { onAdd(sym); setInput(""); }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={placeholder}
          className={`flex-1 text-sm font-mono ${uppercase ? "uppercase" : ""}`}
        />
        <Button variant="outline" size="sm" onClick={handleAdd}>添加</Button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {symbols.map((sym) => (
          <Badge
            key={sym} variant="secondary"
            className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
            onClick={() => onRemove(sym)}
          >
            {sym} ×
          </Badge>
        ))}
      </div>
    </div>
  );
}

function WSConfigPanel({
  wsUrl, onWsUrlChange, token, onTokenChange, showToken, label, urlPlaceholder,
  tokenPlaceholder, readOnly, extra,
}: {
  wsUrl: string; onWsUrlChange: (v: string) => void; token?: string;
  onTokenChange?: (v: string) => void; showToken?: boolean; label: string;
  urlPlaceholder: string; tokenPlaceholder?: string; readOnly?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 p-4 rounded-lg bg-muted/40 border border-border">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {label} WebSocket 配置
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">WebSocket 地址</Label>
        <Input
          value={wsUrl} onChange={(e) => onWsUrlChange(e.target.value)}
          placeholder={urlPlaceholder} className="text-xs font-mono" readOnly={readOnly}
        />
      </div>
      {showToken && onTokenChange && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            API Token{" "}
            <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer"
              className="text-primary underline ml-1">(免费注册获取)</a>
          </Label>
          <Input
            value={token ?? ""} onChange={(e) => onTokenChange(e.target.value)}
            placeholder={tokenPlaceholder ?? "输入 Token"} className="text-xs font-mono"
          />
        </div>
      )}
      {extra}
    </div>
  );
}

function CryptoTab() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_BINANCE_WS);
  const [symbols, setSymbols] = useState(DEFAULT_CRYPTO_SYMBOLS);

  const config = useMemo(
    () => ({ type: "crypto" as const, wsUrl, symbols }),
    [wsUrl, symbols.join(",")]
  );
  const { prices, status } = useBinanceTracker(config);

  const addSymbol = useCallback((s: string) => {
    setSymbols((prev) => (prev.includes(s) ? prev : [...prev, s]));
  }, []);
  const removeSymbol = useCallback((s: string) => {
    setSymbols((prev) => prev.filter((x) => x !== s));
  }, []);

  const entries = useMemo(
    () =>
      symbols.map((sym) => prices[sym] ?? {
        symbol: sym, price: null, prevPrice: null, change24h: null,
        change24hPct: null, volume: null, lastUpdate: null, flash: null,
      }),
    [prices, symbols.join(",")]
  );

  const monitoredSymbols = useMemo<MonitoredSymbol[]>(
    () => symbols.map((sym) => ({
      symbol: sym, displayName: sym, currentPrice: prices[sym]?.price ?? null,
    })),
    [prices, symbols.join(",")]
  );

  return (
    <div className="space-y-4">
      <WSConfigPanel
        label="Binance 加密货币" wsUrl={wsUrl} onWsUrlChange={setWsUrl}
        urlPlaceholder={DEFAULT_BINANCE_WS}
      />
      <SymbolInput
        label="交易对（自动添加 USDT）" symbols={symbols}
        onAdd={addSymbol} onRemove={removeSymbol} placeholder="例如 DOGE" uppercase
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">实时价格</span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => <PriceCard key={entry.symbol} entry={entry} />)}
      </div>
      <GoldenCrossMonitor assetType="crypto" symbols={monitoredSymbols} />
    </div>
  );
}

function StockTab() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_FINNHUB_WS);
  const [token, setToken] = useState(DEFAULT_FINNHUB_TOKEN);
  const [symbols, setSymbols] = useState(DEFAULT_STOCK_SYMBOLS);

  const config = useMemo(
    () => ({ type: "stock" as const, wsUrl, token, symbols }),
    [wsUrl, token, symbols.join(",")]
  );
  const { prices, status } = useFinnhubTracker(config);

  const addSymbol = useCallback((s: string) => {
    setSymbols((prev) => (prev.includes(s) ? prev : [...prev, s]));
  }, []);
  const removeSymbol = useCallback((s: string) => {
    setSymbols((prev) => prev.filter((x) => x !== s));
  }, []);

  const entries = useMemo(
    () =>
      symbols.map((sym) => prices[sym] ?? {
        symbol: sym, price: null, prevPrice: null, change24h: null,
        change24hPct: null, volume: null, lastUpdate: null, flash: null,
      }),
    [prices, symbols.join(",")]
  );

  return (
    <div className="space-y-4">
      <WSConfigPanel
        label="Finnhub 股票" wsUrl={wsUrl} onWsUrlChange={setWsUrl}
        showToken token={token} onTokenChange={setToken}
        urlPlaceholder={DEFAULT_FINNHUB_WS} tokenPlaceholder="例如：cxxx..."
      />
      {!token && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-300">
          请先填入 Finnhub API Token 才能获取股票数据。
          <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer"
            className="underline ml-1 font-medium">免费注册</a>
        </div>
      )}
      <SymbolInput
        label="股票代码" symbols={symbols} onAdd={addSymbol}
        onRemove={removeSymbol} placeholder="例如 NVDA" uppercase
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">实时价格（仅交易时段）</span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => <PriceCard key={entry.symbol} entry={entry} />)}
      </div>
    </div>
  );
}

function AShareTab() {
  const [symbols, setSymbols] = useState(DEFAULT_ASHARE_SYMBOLS);
  const { prices, status } = useAShareTracker(symbols);

  const addSymbol = useCallback((s: string) => {
    setSymbols((prev) => (prev.includes(s) ? prev : [...prev, s]));
  }, []);
  const removeSymbol = useCallback((s: string) => {
    setSymbols((prev) => prev.filter((x) => x !== s));
  }, []);

  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/ashare`;

  const monitoredSymbols = useMemo<MonitoredSymbol[]>(
    () =>
      symbols.map((code) => ({
        symbol: code,
        displayName: prices[code]?.name ?? code,
        currentPrice: prices[code]?.price ?? null,
      })),
    [prices, symbols.join(",")]
  );

  return (
    <div className="space-y-4">
      <WSConfigPanel
        label="A股行情 (新浪财经数据源)" wsUrl={wsUrl} onWsUrlChange={() => {}}
        readOnly urlPlaceholder=""
        extra={
          <div className="text-xs text-muted-foreground pt-1">
            数据来源：新浪财经免费接口，后端代理推送，每 2 秒更新一次。仅交易时段有数据（周一至周五 9:30–15:00）。
          </div>
        }
      />
      <SymbolInput
        label="代码格式：sh+沪市代码 / sz+深市代码" symbols={symbols}
        onAdd={addSymbol} onRemove={removeSymbol} placeholder="例如 sh510300 / sz000001"
      />
      <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
        <div className="font-semibold">常用代码参考</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 font-mono">
          <span>sh510300 沪深300ETF</span>
          <span>sh510500 中证500ETF</span>
          <span>sh510050 上证50ETF</span>
          <span>sh159919 沪深300ETF(嘉实)</span>
          <span>sh600519 贵州茅台</span>
          <span>sh601318 中国平安</span>
          <span>sz000001 平安银行</span>
          <span>sz300750 宁德时代</span>
          <span>sh688981 中芯国际</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">实时行情</span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {symbols.map((code) =>
          prices[code] ? (
            <AShareCard key={code} quote={prices[code]} />
          ) : (
            <AShareEmptyCard key={code} code={code} />
          )
        )}
      </div>
      <GoldenCrossMonitor assetType="ashare" symbols={monitoredSymbols} />
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">实时价格追踪</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            通过 WebSocket 长连接实时获取加密货币、美股和A股价格，支持金叉信号钉钉推送
          </p>
        </div>
        <Separator />
        <Tabs defaultValue="ashare">
          <TabsList className="mb-4">
            <TabsTrigger value="ashare">A股 / ETF</TabsTrigger>
            <TabsTrigger value="crypto">加密货币</TabsTrigger>
            <TabsTrigger value="stock">美股</TabsTrigger>
          </TabsList>
          <TabsContent value="ashare"><AShareTab /></TabsContent>
          <TabsContent value="crypto"><CryptoTab /></TabsContent>
          <TabsContent value="stock"><StockTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
