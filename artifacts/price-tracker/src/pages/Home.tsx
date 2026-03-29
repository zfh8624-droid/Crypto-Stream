import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useBinanceTracker, useFinnhubTracker, PriceEntry } from "@/hooks/usePriceTracker";
import { useAShareTracker, AShareQuote } from "@/hooks/useAShareWS";
import { WSStatus } from "@/hooks/useWebSocket";
import { GoldenCrossMonitor, MonitoredSymbol } from "@/components/GoldenCrossMonitor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleTabs, SimpleTabsContent, SimpleTabsList, SimpleTabsTrigger } from "@/components/ui/simple-tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2, LogOut, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";

const WS_PASSWORD = "zfh8624";
// 默认使用后端代理模式
const getDefaultBinanceWS = () => {
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/binance`;
};
const DEFAULT_BINANCE_WS = "ws://localhost:3000/api/binance";
const DEFAULT_CRYPTO_SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "XRP"];

const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BNB: "Binance Coin",
  SOL: "Solana",
  XRP: "Ripple",
  DOGE: "Dogecoin",
  ADA: "Cardano",
  DOT: "Polkadot",
  MATIC: "Polygon",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  UNI: "Uniswap",
  ATOM: "Cosmos",
  LTC: "Litecoin",
  BCH: "Bitcoin Cash",
  XLM: "Stellar",
  FIL: "Filecoin",
  TRX: "TRON",
  ETC: "Ethereum Classic",
};

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

function usePasswordDialog(onConfirmed: (value: string) => void) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");
  const pendingRef = useRef<string>("");

  const prompt = (value: string) => {
    pendingRef.current = value;
    setPwd("");
    setError("");
    setOpen(true);
  };

  const handleConfirm = () => {
    if (pwd === WS_PASSWORD) {
      setOpen(false);
      onConfirmed(pendingRef.current);
    } else {
      setError("密码错误，请重试");
      setPwd("");
    }
  };

  const dialog = (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>身份验证</DialogTitle>
          <DialogDescription>修改 WebSocket 地址需要验证密码</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm">密码</Label>
            <Input
              type="password"
              value={pwd}
              onChange={(e) => { setPwd(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
              placeholder="请输入密码"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleConfirm}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { prompt, dialog };
}

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

function PriceCard({ entry, onRemove }: { entry: PriceEntry; onRemove?: (symbol: string) => void }) {
  const isUp = (entry.change24hPct ?? 0) >= 0;
  const cryptoName = CRYPTO_NAMES[entry.symbol] || entry.symbol;
  const flashClass =
    entry.flash === "up"
      ? "bg-green-50/80 dark:bg-green-950/50"
      : entry.flash === "down"
      ? "bg-red-50/80 dark:bg-red-950/50"
      : "";

  return (
    <div className={`rounded-2xl border border-border p-4 sm:p-5 transition-all duration-300 ${flashClass} glass-card price-card-hover relative`}>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(entry.symbol)}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600 transition-colors"
          title="删除"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-start justify-between gap-2 pr-7">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-lg sm:text-xl leading-none text-blue-600 dark:text-blue-400">
            {entry.symbol}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {cryptoName}
          </div>
          {entry.lastUpdate && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              {entry.lastUpdate.toLocaleTimeString("zh-CN")}
            </div>
          )}
        </div>
        {entry.change24hPct != null && (
          <Badge 
            variant={isUp ? "default" : "destructive"} 
            className={`text-xs shrink-0 !text-white`}
            style={{ backgroundColor: isUp ? '#22c55e' : '#ef4444' }}
          >
            {isUp ? "📈 +" : "📉 "}{entry.change24hPct.toFixed(2)}%
          </Badge>
        )}
      </div>
      <div className="mt-3 sm:mt-4">
        {entry.price != null ? (
          <span
            className={`text-2xl sm:text-3xl font-mono font-extrabold transition-all duration-300 break-all number-flash`}
            style={{ 
              color: entry.flash === "up" ? '#16a34a' : entry.flash === "down" ? '#dc2626' : undefined
            }}
          >
            ${entry.price.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: entry.price < 1 ? 6 : 2,
            })}
          </span>
        ) : (
          <span className="text-2xl sm:text-3xl font-mono font-bold text-muted-foreground animate-pulse">等待数据...</span>
        )}
      </div>
      {entry.volume != null && (
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
          <span>📊</span>
          成交量: {entry.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

function AShareCard({ quote, onRemove }: { quote: AShareQuote; onRemove?: (code: string) => void }) {
  const isUp = quote.changePct >= 0;
  const flashClass =
    quote.flash === "up" ? "bg-red-50/80 dark:bg-red-950/50"
    : quote.flash === "down" ? "bg-green-50/80 dark:bg-green-950/50"
    : "";

  return (
    <div className={`rounded-2xl border border-border p-4 sm:p-5 transition-all duration-300 ${flashClass} glass-card price-card-hover relative`}>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(quote.code)}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600 transition-colors"
          title="删除"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-start justify-between gap-2 pr-7">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-lg sm:text-xl leading-none text-red-600 dark:text-red-400">
            {quote.name}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">
            {quote.code}
          </div>
          {quote.time && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              {quote.time}
            </div>
          )}
        </div>
        <Badge 
          variant={isUp ? "default" : "destructive"} 
          className={`text-xs shrink-0 !text-white`}
          style={{ backgroundColor: isUp ? '#ef4444' : '#22c55e' }}
        >
          {isUp ? "📈 +" : "📉 "}{quote.changePct.toFixed(2)}%
        </Badge>
      </div>
      <div className="mt-3 sm:mt-4">
        <span
          className={`text-2xl sm:text-3xl font-mono font-extrabold transition-all duration-300 break-all number-flash`}
          style={{ 
            color: quote.flash === "up" ? '#dc2626' : quote.flash === "down" ? '#16a34a' : undefined
          }}
        >
          ¥{quote.price.toFixed(3)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 sm:gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="truncate">涨跌额: <span style={{ color: isUp ? '#dc2626' : '#16a34a' }} className="font-bold">{isUp ? "+" : ""}{quote.change.toFixed(3)}</span></div>
        <div className="truncate">昨收: {quote.prevClose.toFixed(3)}</div>
        <div className="truncate">今开: {quote.open.toFixed(3)}</div>
        <div className="truncate">最高: {quote.high.toFixed(3)}</div>
        <div className="truncate">最低: {quote.low.toFixed(3)}</div>
        <div className="truncate">📊 成交量: {(quote.volume / 10000).toFixed(0)}万手</div>
      </div>
    </div>
  );
}

function AShareEmptyCard({ code, onRemove }: { code: string; onRemove?: (code: string) => void }) {
  return (
    <div className="rounded-xl border border-border p-4 relative">
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(code)}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600 transition-colors"
          title="删除"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="font-bold text-base leading-none text-muted-foreground pr-7">{code}</div>
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
    const rawSymbols = input.split(",").map(s => s.trim()).filter(s => s.length > 0);
    if (rawSymbols.length > 0) {
      rawSymbols.forEach(rawSym => {
        const sym = uppercase ? rawSym.toUpperCase() : rawSym.toLowerCase();
        if (sym && !symbols.includes(sym)) {
          onAdd(sym);
        }
      });
      setInput("");
    }
  };

  return (
    <div className="p-5 rounded-2xl glass-card border-0">
      <Label className="text-base font-bold text-foreground">{label}</Label>
      <div className="mt-2 text-xs text-muted-foreground">
        支持单个或多个符号（用逗号分隔）
      </div>
      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={placeholder}
          className={`flex-1 text-sm font-mono ${uppercase ? "uppercase" : ""} bg-white/5 dark:bg-black/5 border-2 border-teal-500/40 dark:border-teal-400/40`}
        />
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleAdd}
          className="border-2 border-teal-500/60 text-teal-600 hover:bg-teal-500/10"
        >
          添加
        </Button>
      </div>

    </div>
  );
}

function WSConfigPanel({
  wsUrl, onWsUrlChange, token, onTokenChange, showToken, label, urlPlaceholder,
  tokenPlaceholder, readOnly, extra, className,
}: {
  wsUrl: string; onWsUrlChange: (v: string) => void; token?: string;
  onTokenChange?: (v: string) => void; showToken?: boolean; label: string;
  urlPlaceholder: string; tokenPlaceholder?: string; readOnly?: boolean;
  extra?: React.ReactNode;
  className?: string;
}) {
  const [editUrl, setEditUrl] = useState(wsUrl);
  const isDirty = editUrl !== wsUrl;

  const { prompt, dialog } = usePasswordDialog((confirmed) => {
    onWsUrlChange(confirmed);
  });

  const handleApply = () => {
    if (editUrl.trim() === wsUrl) return;
    prompt(editUrl.trim());
  };

  return (
    <div className={`space-y-3 p-5 rounded-2xl glass-card border-0 ${className ?? ''}`}>
      {dialog}
      <div className="text-sm font-bold text-foreground flex items-center gap-2">
        <span>⚡</span>
        {label} WebSocket 配置
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">WebSocket 地址</Label>
        {readOnly ? (
          <Input
            value={wsUrl}
            readOnly
            placeholder={urlPlaceholder}
            className="text-xs font-mono bg-white/5 dark:bg-black/5 border-2 border-teal-500/40 dark:border-teal-400/40"
          />
        ) : (
          <div className="flex gap-2">
            <Input
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder={urlPlaceholder}
              className="text-xs font-mono flex-1 bg-white/5 dark:bg-black/5 border-2 border-teal-500/40 dark:border-teal-400/40"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!isDirty}
              onClick={handleApply}
              className={`border-2 border-teal-500/60 text-teal-600 hover:bg-teal-500/10 ${!isDirty ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              确认修改
            </Button>
          </div>
        )}
      </div>
      {showToken && onTokenChange && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            API Token{" "}
            <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer"
              className="text-primary underline ml-1">(免费注册获取)</a>
          </Label>
          <Input
            value={token ?? ""} onChange={(e) => onTokenChange(e.target.value)}
            placeholder={tokenPlaceholder ?? "输入 Token"} 
            className="text-xs font-mono bg-white/20 dark:bg-black/20 border-white/30 dark:border-white/10"
          />
        </div>
      )}
      {extra}
    </div>
  );
}

function CryptoTab({ onDelete }: { onDelete?: (symbol: string, onConfirm: () => void) => void }) {
  // 默认使用后端代理模式
  const defaultWsUrl = useMemo(() => {
    return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/binance`;
  }, []);
  
  // 自定义持久化状态，强制使用Vite代理地址
  const [wsUrl, setWsUrl] = useState<string>(() => {
    try {
      // 清除旧的地址，强制使用Vite代理
      localStorage.removeItem("crypto_ws_url");
    } catch {
      // ignore
    }
    return defaultWsUrl;
  });
  
  // 同步到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem("crypto_ws_url", wsUrl);
    } catch {
      // ignore
    }
  }, [wsUrl]);
  
  const [symbols, setSymbols] = usePersistedState("crypto_symbols", DEFAULT_CRYPTO_SYMBOLS);

  const config = useMemo(
    () => ({ type: "crypto" as const, wsUrl, symbols }),
    [wsUrl, symbols.join(",")]
  );
  const { prices, status, subscribe, unsubscribe } = useBinanceTracker(config);

  const addSymbol = useCallback((s: string) => {
    setSymbols((prev) => {
      if (prev.includes(s)) return prev;
      const newSymbols = [...prev, s];
      subscribe([s]);
      return newSymbols;
    });
  }, [subscribe]);
  const removeSymbol = useCallback((s: string) => {
    setSymbols((prev) => {
      unsubscribe([s]);
      return prev.filter((x) => x !== s);
    });
  }, [unsubscribe]);

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
        urlPlaceholder={defaultWsUrl}
        className="mb-8"
      />
      <SymbolInput
        label="交易对（自动添加 USDT）" symbols={symbols}
        onAdd={addSymbol} onRemove={removeSymbol} placeholder="例如 DOGE" uppercase
      />
      <div className="mt-8 flex items-center justify-between">
        <span className="text-lg font-bold text-foreground">实时价格</span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => (
          <PriceCard 
            key={entry.symbol} 
            entry={entry} 
            onRemove={onDelete 
              ? (s) => onDelete(s, () => removeSymbol(s)) 
              : removeSymbol
            } 
          />
        ))}
      </div>
      <div className="mt-8">
        <GoldenCrossMonitor assetType="crypto" symbols={monitoredSymbols} />
      </div>
    </div>
  );
}

function StockTab({ onDelete }: { onDelete?: (symbol: string, onConfirm: () => void) => void }) {
  const [wsUrl, setWsUrl] = useState(DEFAULT_FINNHUB_WS);
  const [token, setToken] = useState(DEFAULT_FINNHUB_TOKEN);
  const [symbols, setSymbols] = usePersistedState("stock_symbols", DEFAULT_STOCK_SYMBOLS);

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
        className="mb-8"
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
      <div className="mt-8 flex items-center justify-between">
        <span className="text-lg font-bold text-foreground">实时价格（仅交易时段）</span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => (
          <PriceCard 
            key={entry.symbol} 
            entry={entry} 
            onRemove={onDelete 
              ? (s) => onDelete(s, () => removeSymbol(s)) 
              : removeSymbol
            } 
          />
        ))}
      </div>
    </div>
  );
}

function AShareTab({ onDelete }: { onDelete?: (symbol: string, onConfirm: () => void) => void }) {
  const [symbols, setSymbols] = usePersistedState("ashare_symbols", DEFAULT_ASHARE_SYMBOLS);
  const { prices, status } = useAShareTracker(symbols);

  const addSymbol = useCallback((s: string) => {
    setSymbols((prev) => (prev.includes(s) ? prev : [...prev, s]));
  }, []);
  const removeSymbol = useCallback((s: string) => {
    setSymbols((prev) => prev.filter((x) => x !== s));
  }, []);

  const wsUrl = useMemo(() => {
    return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/ashare`;
  }, []);

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
        className="mb-8"
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
      <div className="mt-6 rounded-2xl glass-card border-0 p-3 sm:p-4 text-xs text-foreground space-y-2">
        <div className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <span>📚</span>
          常用代码参考
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-2 sm:gap-x-4 gap-y-1 font-mono">
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sh510300 沪深300ETF</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sh510500 中证500ETF</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sh510050 上证50ETF</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sh159919 沪深300ETF(嘉实)</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sh600519 贵州茅台</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sh601318 中国平安</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sz000001 平安银行</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sz300750 宁德时代</span>
          <span className="bg-teal-500/8 border border-teal-500/30 px-2 py-1 rounded text-[10px] sm:text-xs truncate text-teal-700">sh688981 中芯国际</span>
        </div>
      </div>
      <div className="mt-8 flex items-center justify-between">
        <span className="text-lg font-bold text-foreground">实时行情</span>
        <StatusDot status={status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {symbols.map((code) =>
          prices[code] ? (
            <AShareCard 
              key={code} 
              quote={prices[code]} 
              onRemove={onDelete 
                ? (c) => onDelete(c, () => removeSymbol(c)) 
                : removeSymbol
              } 
            />
          ) : (
            <AShareEmptyCard 
              key={code} 
              code={code} 
              onRemove={onDelete 
                ? (c) => onDelete(c, () => removeSymbol(c)) 
                : removeSymbol
              } 
            />
          )
        )}
      </div>
      <div className="mt-8">
        <GoldenCrossMonitor assetType="ashare" symbols={monitoredSymbols} />
      </div>
    </div>
  );
}

function ParticlesBackground({ activeTab }: { activeTab: string }) {
  const currencySymbol = activeTab === "ashare" ? "¥" : "$";
  const particleColor = activeTab === "ashare" 
    ? "rgba(239, 68, 68, 0.4)" 
    : "rgba(20, 184, 166, 0.4)";
  const particles = Array.from({ length: 30 }, (_, i) => {
    const driftX = (Math.random() - 0.5) * 100;
    const rotate = (Math.random() - 0.5) * 720;
    return {
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 200}%`,
      animationDelay: `-${Math.random() * 20}s`,
      animationDuration: `${15 + Math.random() * 15}s`,
      size: 10 + Math.random() * 8,
      driftX,
      rotate,
    };
  });

  return (
    <div className="particles-container">
      {particles.map((p) => (
        <div
          key={p.id}
          className="particle"
          style={{
            left: p.left,
            top: p.top,
            animationDelay: p.animationDelay,
            animationDuration: p.animationDuration,
            fontSize: `${p.size}px`,
            color: particleColor,
            '--drift-x': `${p.driftX}px`,
            '--rotate': `${p.rotate}deg`,
          } as React.CSSProperties}
        >
          {currencySymbol}
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const { isGuest, user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("ashare");
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    symbol: string;
    onConfirm: () => void;
  }>({ open: false, symbol: "", onConfirm: () => {} });

  const handleDelete = (symbol: string, onDelete: () => void) => {
    setDeleteConfirm({
      open: true,
      symbol,
      onConfirm: onDelete,
    });
  };

  const confirmDelete = () => {
    deleteConfirm.onConfirm();
    setDeleteConfirm({ open: false, symbol: "", onConfirm: () => {} });
  };

  const cancelDelete = () => {
    setDeleteConfirm({ open: false, symbol: "", onConfirm: () => {} });
  };
  
  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="gradient-bg absolute inset-0 opacity-100" />
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-4 sm:space-y-6 relative z-10">
        {/* 右上角用户信息栏 */}
        <div className="flex justify-end mb-2">
          <div className="flex items-center gap-3 bg-white/5 dark:bg-black/5 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/10">
            {isGuest ? (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="w-4 h-4" />
                  <span>访客模式</span>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs h-7"
                  onClick={() => setLocation("/welcome")}
                >
                  选择模式
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-blue-500" />
                  <span className="font-medium">{user?.username}</span>
                  {user?.isAdmin && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0">管理员</Badge>
                  )}
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs h-7"
                  onClick={logout}
                >
                  <LogOut className="w-3.5 h-3.5 mr-1" />
                  退出
                </Button>
              </>
            )}
          </div>
        </div>
        
        <div className="text-center float-animation">
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight gradient-title">
            🚀 盯盘系统
          </h1>
        </div>
        <Separator className="opacity-50" />
        <SimpleTabs defaultValue="ashare" value={activeTab} onValueChange={setActiveTab} className="glow-border">
          <SimpleTabsList className="mb-3 sm:mb-4 glass-card p-1">
            <SimpleTabsTrigger 
              value="ashare" 
              className="text-xs sm:text-sm"
            >
              🇨🇳 A股
            </SimpleTabsTrigger>
            <SimpleTabsTrigger 
              value="crypto" 
              className="text-xs sm:text-sm"
            >
              ₿ 加密
            </SimpleTabsTrigger>
            <SimpleTabsTrigger 
              value="stock" 
              className="text-xs sm:text-sm"
            >
              🇺🇸 美股
            </SimpleTabsTrigger>
          </SimpleTabsList>
          <SimpleTabsContent value="ashare">
            <AShareTab onDelete={handleDelete} />
          </SimpleTabsContent>
          <SimpleTabsContent value="crypto">
            <CryptoTab onDelete={handleDelete} />
          </SimpleTabsContent>
          <SimpleTabsContent value="stock">
            <StockTab onDelete={handleDelete} />
          </SimpleTabsContent>
        </SimpleTabs>
      </div>
      <ParticlesBackground activeTab={activeTab} />

      {/* 删除确认对话框 */}
      <Dialog open={deleteConfirm.open} onOpenChange={cancelDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除 {deleteConfirm.symbol} 吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>取消</Button>
            <Button variant="destructive" onClick={confirmDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
