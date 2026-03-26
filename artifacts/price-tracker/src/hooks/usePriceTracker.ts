import { useState, useCallback, useRef } from "react";
import { useWebSocket, WSStatus } from "./useWebSocket";

export interface PriceEntry {
  symbol: string;
  price: number | null;
  prevPrice: number | null;
  change24h: number | null;
  change24hPct: number | null;
  volume: number | null;
  lastUpdate: Date | null;
  flash: "up" | "down" | null;
}

export interface CryptoConfig {
  type: "crypto";
  wsUrl: string;
  symbols: string[];
}

export interface StockConfig {
  type: "stock";
  wsUrl: string;
  token: string;
  symbols: string[];
}

export type TrackerConfig = CryptoConfig | StockConfig;

export function useBinanceTracker(config: CryptoConfig) {
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const symbolsKey = config.symbols.sort().join(",");

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;

    if (Array.isArray(data)) {
      for (const item of data) {
        handleTicker(item as Record<string, unknown>);
      }
      return;
    }

    if (msg.stream && msg.data) {
      handleTicker(msg.data as Record<string, unknown>);
      return;
    }

    if (msg.e === "24hrTicker") {
      handleTicker(msg);
    }
  }, []);

  const handleTicker = (msg: Record<string, unknown>) => {
    const symbol = (msg.s as string)?.replace("USDT", "") ?? "";
    if (!symbol) return;

    setPrices((prev) => {
      const old = prev[symbol];
      const newPrice = parseFloat(msg.c as string);
      const flash =
        old?.price != null
          ? newPrice > old.price
            ? "up"
            : newPrice < old.price
            ? "down"
            : null
          : null;

      if (flash && flashTimers.current[symbol]) {
        clearTimeout(flashTimers.current[symbol]);
      }

      const next: PriceEntry = {
        symbol,
        price: newPrice,
        prevPrice: old?.price ?? null,
        change24h: parseFloat(msg.P as string) ?? null,
        change24hPct: parseFloat(msg.P as string) ?? null,
        volume: parseFloat(msg.v as string) ?? null,
        lastUpdate: new Date(),
        flash,
      };

      if (flash) {
        flashTimers.current[symbol] = setTimeout(() => {
          setPrices((p) => ({
            ...p,
            [symbol]: { ...p[symbol], flash: null },
          }));
        }, 800);
      }

      return { ...prev, [symbol]: next };
    });
  };

  const buildUrl = useCallback(() => {
    if (!config.symbols.length) return null;
    const streams = config.symbols
      .map((s) => `${s.toLowerCase()}usdt@ticker`)
      .join("/");
    return `${config.wsUrl}/stream?streams=${streams}`;
  }, [config.wsUrl, symbolsKey]);

  const wsUrl = buildUrl();
  const { status } = useWebSocket(wsUrl, { onMessage });

  return { prices, status };
}

export function useFinnhubTracker(config: StockConfig) {
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sendRef = useRef<((data: unknown) => void) | null>(null);

  const symbolsKey = config.symbols.sort().join(",");

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.type === "trade" && Array.isArray(msg.data)) {
      for (const trade of msg.data as Array<Record<string, unknown>>) {
        const symbol = trade.s as string;
        if (!symbol) continue;
        const newPrice = trade.p as number;

        setPrices((prev) => {
          const old = prev[symbol];
          const flash =
            old?.price != null
              ? newPrice > old.price
                ? "up"
                : newPrice < old.price
                ? "down"
                : null
              : null;

          if (flash && flashTimers.current[symbol]) {
            clearTimeout(flashTimers.current[symbol]);
          }

          const next: PriceEntry = {
            symbol,
            price: newPrice,
            prevPrice: old?.price ?? null,
            change24h: null,
            change24hPct: null,
            volume: trade.v as number ?? null,
            lastUpdate: new Date(),
            flash,
          };

          if (flash) {
            flashTimers.current[symbol] = setTimeout(() => {
              setPrices((p) => ({
                ...p,
                [symbol]: { ...p[symbol], flash: null },
              }));
            }, 800);
          }

          return { ...prev, [symbol]: next };
        });
      }
    }
  }, []);

  const onOpen = useCallback(() => {
    if (sendRef.current) {
      for (const sym of config.symbols) {
        sendRef.current({ type: "subscribe", symbol: sym });
      }
    }
  }, [symbolsKey]);

  const wsUrlWithToken = config.token
    ? `${config.wsUrl}?token=${config.token}`
    : null;

  const { status, send } = useWebSocket(wsUrlWithToken, { onMessage, onOpen });
  sendRef.current = send;

  return { prices, status };
}
