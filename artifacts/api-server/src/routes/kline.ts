import { Router } from "express";
import { fetchBinanceKLines, fetchSinaKLines } from "../kline.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/kline/data", async (req, res) => {
  const { symbol, interval, type, limit } = req.query as Record<string, string>;

  if (!symbol || !interval || !type) {
    res.status(400).json({ error: "symbol, interval, type are required" });
    return;
  }

  const n = Math.min(parseInt(limit ?? "300", 10), 500);

  try {
    let closes: number[], highs: number[], lows: number[], volumes: number[];
    if (type === "crypto") {
      const candles = await fetchBinanceKLines(symbol, interval, n);
      closes = candles.map((c) => c.close);
      highs = candles.map((c) => c.high);
      lows = candles.map((c) => c.low);
      volumes = candles.map((c) => c.volume);
    } else if (type === "ashare") {
      const candles = await fetchSinaKLines(symbol, interval, n);
      closes = candles.map((c) => c.close);
      highs = candles.map((c) => c.high);
      lows = candles.map((c) => c.low);
      volumes = candles.map((c) => c.volume);
    } else {
      res.status(400).json({ error: `Unsupported type: ${type}` });
      return;
    }

    res.json({ closes, highs, lows, volumes });
  } catch (err) {
    logger.error({ err, symbol }, "K-line fetch error");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
