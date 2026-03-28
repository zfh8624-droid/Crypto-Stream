import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupAShareWS } from "./ashare-ws";
import { setupBinanceWS } from "./binance-ws";

const rawPort = process.env["PORT"] || "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

setupAShareWS(server);
setupBinanceWS(server);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
