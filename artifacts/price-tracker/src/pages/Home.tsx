import { useState, useMemo, useCallback } from "react";
import { useBinanceTracker, useFinnhubTracker, PriceEntry } from "@/hooks/usePriceTracker";
import { WSStatus } from "@/hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

const DEFAULT_BINANCE_WS = "wss://stream.binance.com:9443";
const DEFAULT_CRYPTO_SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "XRP"];

const DEFAULT_FINNHUB_WS = "wss://ws.finnhub.io";
const DEFAULT_FINNHUB_TOKEN = "";
const DEFAULT_STOCK_SYMBOLS = ["AAPL", "GOOGL", "TSLA", "AMZN", "MSFT"];

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
    <div
      className={`rounded-xl border border-border p-4 transition-colors duration-300 ${flashClass}`}
    >
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
          <Badge
            variant={isUp ? "default" : "destructive"}
            className="text-xs shrink-0"
          >
            {isUp ? "+" : ""}
            {entry.change24hPct.toFixed(2)}%
          </Badge>
        )}
      </div>
      <div className="mt-3">
        {entry.price != null ? (
          <span
            className={`text-2xl font-mono font-bold transition-colors duration-300 ${
              entry.flash === "up"
                ? "text-green-600 dark:text-green-400"
                : entry.flash === "down"
                ? "text-red-600 dark:text-red-400"
                : ""
            }`}
          >
            $
            {entry.price.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: entry.price < 1 ? 6 : 2,
            })}
          </span>
        ) : (
          <span className="text-2xl font-mono font-bold text-muted-foreground">
            等待数据...
          </span>
        )}
      </div>
      {entry.volume != null && (
        <div className="mt-1 text-xs text-muted-foreground">
          成交量:{" "}
          {entry.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

function SymbolInput({
  label,
  symbols,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  symbols: string[];
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const sym = input.trim().toUpperCase();
    if (sym && !symbols.includes(sym)) {
      onAdd(sym);
      setInput("");
    }
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
          className="flex-1 text-sm font-mono uppercase"
        />
        <Button variant="outline" size="sm" onClick={handleAdd}>
          添加
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {symbols.map((sym) => (
          <Badge
            key={sym}
            variant="secondary"
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
  wsUrl,
  onWsUrlChange,
  token,
  onTokenChange,
  showToken,
  label,
  urlPlaceholder,
  tokenPlaceholder,
}: {
  wsUrl: string;
  onWsUrlChange: (v: string) => void;
  token?: string;
  onTokenChange?: (v: string) => void;
  showToken?: boolean;
  label: string;
  urlPlaceholder: string;
  tokenPlaceholder?: string;
}) {
  return (
    <div className="space-y-3 p-4 rounded-lg bg-muted/40 border border-border">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {label} WebSocket 配置
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">WebSocket 地址</Label>
        <Input
          value={wsUrl}
          onChange={(e) => onWsUrlChange(e.target.value)}
          placeholder={urlPlaceholder}
          className="text-xs font-mono"
        />
      </div>
      {showToken && onTokenChange && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            API Token{" "}
            <a
              href="https://finnhub.io/register"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline ml-1"
            >
              (免费注册获取)
            </a>
          </Label>
          <Input
            value={token ?? ""}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder={tokenPlaceholder ?? "输入 Token"}
            className="text-xs font-mono"
          />
        </div>
      )}
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
      symbols.map(
        (sym) =>
          prices[sym] ?? {
            symbol: sym,
            price: null,
            prevPrice: null,
            change24h: null,
            change24hPct: null,
            volume: null,
            lastUpdate: null,
            flash: null,
          }
      ),
    [prices, symbols.join(",")]
  );

  return (
    <div className="space-y-4">
      <WSConfigPanel
        label="Binance 加密货币"
        wsUrl={wsUrl}
        onWsUrlChange={setWsUrl}
        urlPlaceholder={DEFAULT_BINANCE_WS}
      />
      <SymbolInput
        label="交易对（自动添加 USDT）"
        symbols={symbols}
        onAdd={addSymbol}
        onRemove={removeSymbol}
        placeholder="例如 DOGE"
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          实时价格
        </span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => (
          <PriceCard key={entry.symbol} entry={entry} />
        ))}
      </div>
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
      symbols.map(
        (sym) =>
          prices[sym] ?? {
            symbol: sym,
            price: null,
            prevPrice: null,
            change24h: null,
            change24hPct: null,
            volume: null,
            lastUpdate: null,
            flash: null,
          }
      ),
    [prices, symbols.join(",")]
  );

  return (
    <div className="space-y-4">
      <WSConfigPanel
        label="Finnhub 股票"
        wsUrl={wsUrl}
        onWsUrlChange={setWsUrl}
        showToken
        token={token}
        onTokenChange={setToken}
        urlPlaceholder={DEFAULT_FINNHUB_WS}
        tokenPlaceholder="例如：cxxx..."
      />
      {!token && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-300">
          请先在上方填入 Finnhub API Token 才能获取股票数据。
          <a
            href="https://finnhub.io/register"
            target="_blank"
            rel="noopener noreferrer"
            className="underline ml-1 font-medium"
          >
            免费注册
          </a>
        </div>
      )}
      <SymbolInput
        label="股票代码"
        symbols={symbols}
        onAdd={addSymbol}
        onRemove={removeSymbol}
        placeholder="例如 NVDA"
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          实时价格（仅交易时段）
        </span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => (
          <PriceCard key={entry.symbol} entry={entry} />
        ))}
      </div>
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
            通过 WebSocket 长连接实时获取加密货币和股票价格
          </p>
        </div>
        <Separator />
        <Tabs defaultValue="crypto">
          <TabsList className="mb-4">
            <TabsTrigger value="crypto">加密货币</TabsTrigger>
            <TabsTrigger value="stock">股票</TabsTrigger>
          </TabsList>
          <TabsContent value="crypto">
            <CryptoTab />
          </TabsContent>
          <TabsContent value="stock">
            <StockTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
