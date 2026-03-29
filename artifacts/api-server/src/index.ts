import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupAShareWS } from "./ashare-ws";
import { setupBinanceWS } from "./binance-ws";
import { monitorScheduler } from "./monitor-scheduler";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

// 安全检查：验证JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && (!JWT_SECRET || JWT_SECRET === "your-secret-key-change-in-production")) {
  logger.error("❌ 生产环境必须设置JWT_SECRET环境变量，且不能使用默认值！");
  process.exit(1);
}

if (!JWT_SECRET) {
  logger.warn("⚠️  JWT_SECRET未设置，使用默认值（仅用于开发环境）");
}

const rawPort = process.env["PORT"] || "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

setupAShareWS(server);
setupBinanceWS(server);

async function initDatabase() {
  try {
    // 优先使用环境变量指定的路径
    let dbPath: string;
    if (process.env.DATABASE_PATH) {
      dbPath = process.env.DATABASE_PATH;
    } 
    // 对于容器化部署，使用 /data 目录（通常会被挂载为持久卷）
    else if (fs.existsSync("/data")) {
      dbPath = path.join("/data", "crypto-stream.db");
    }
    // 对于本地部署，使用用户主目录
    else {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      if (homeDir) {
        const appDataDir = path.join(homeDir, ".crypto-stream");
        if (!fs.existsSync(appDataDir)) {
          fs.mkdirSync(appDataDir, { recursive: true });
        }
        dbPath = path.join(appDataDir, "crypto-stream.db");
      }
      // 最后使用当前工作目录作为 fallback
      else {
        dbPath = path.join(process.cwd(), "data", "crypto-stream.db");
      }
    }
    
    const dataDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    logger.info(`📁 使用数据库路径: ${dbPath}`);
    
    const client = createClient({
      url: `file:${dbPath}`
    });
    
    // 确保表结构存在
    await client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );
    `);
    
    await client.execute(`
      CREATE TABLE IF NOT EXISTS monitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        display_name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('crypto', 'ashare', 'stock')),
        enabled INTEGER NOT NULL DEFAULT 0,
        interval TEXT NOT NULL,
        ma_type TEXT NOT NULL CHECK(ma_type IN ('SMA', 'EMA', 'WMA')),
        ma1_period INTEGER NOT NULL,
        ma2_period INTEGER NOT NULL,
        ma3_period INTEGER NOT NULL,
        conditions TEXT NOT NULL,
        signal_type TEXT NOT NULL CHECK(signal_type IN ('golden', 'death')),
        dingtalk_webhook TEXT,
        last_check_at INTEGER,
        last_signal_at INTEGER,
        has_sent_signal INTEGER NOT NULL DEFAULT 0,
        prev_ma1_gt_ma2 INTEGER,
        trend_status TEXT NOT NULL DEFAULT 'neutral' CHECK(trend_status IN ('bullish', 'bearish', 'neutral')),
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    
    await client.execute(`CREATE INDEX IF NOT EXISTS user_id_idx ON monitors(user_id);`);
    await client.execute(`CREATE INDEX IF NOT EXISTS symbol_idx ON monitors(symbol);`);
    
    await client.close();
    logger.info("✅ 数据库表结构检查完成");
  } catch (error) {
    logger.error({ err: error }, "数据库表结构检查失败");
  }
}

async function initAdminUser() {
  try {
    // 创建或检查 admin 用户
    const existingAdmin = await db.query.usersTable.findFirst({
      where: eq(usersTable.username, "admin"),
    });

    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash("admin123", 10);
      await db.insert(usersTable).values({
        username: "admin",
        passwordHash,
        isAdmin: true,
      });
      logger.info("✅ 管理员用户已创建");
      logger.info("   用户名: admin");
      logger.info("   密码: admin123");
    } else {
      logger.info("ℹ️  管理员用户已存在");
      logger.info("   用户名: admin");
      logger.info("   密码: admin123");
    }

    // 创建或检查 wbz 用户
    const existingWbz = await db.query.usersTable.findFirst({
      where: eq(usersTable.username, "wbz"),
    });

    if (!existingWbz) {
      const passwordHash = await bcrypt.hash("wbz123", 10);
      await db.insert(usersTable).values({
        username: "wbz",
        passwordHash,
        isAdmin: false,
      });
      logger.info("✅ wbz 用户已创建");
      logger.info("   用户名: wbz");
      logger.info("   密码: wbz123");
    } else {
      logger.info("ℹ️  wbz 用户已存在");
      logger.info("   用户名: wbz");
      logger.info("   密码: wbz123");
    }
  } catch (error) {
    logger.error({ err: error }, "初始化用户失败");
  }
}

server.listen(port, async (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  await initDatabase();
  await initAdminUser();
  logger.info({ port }, "Server listening");
  monitorScheduler.start();
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  monitorScheduler.stop();
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  monitorScheduler.stop();
  server.close(() => {
    process.exit(0);
  });
});
