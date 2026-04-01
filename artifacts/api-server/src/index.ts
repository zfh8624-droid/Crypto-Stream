import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupAShareWS } from "./ashare-ws";
import { setupBinanceWS } from "./binance-ws";
import { monitorScheduler } from "./monitor-scheduler";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loadBcrypt, getBcrypt } from "./lib/bcrypt.js";

const isProduction = process.env.NODE_ENV === "production";

// 安全检查：验证JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET;

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

async function initAdminUser() {
  try {
    const bcrypt = await getBcrypt();
    
    // 创建或更新 admin 用户
    const existingAdmin = await db.query.usersTable.findFirst({
      where: eq(usersTable.username, "admin"),
    });

    const adminPasswordHash = await bcrypt.hash("admin123", 10);
    if (!existingAdmin) {
      await db.insert(usersTable).values({
        username: "admin",
        passwordHash: adminPasswordHash,
        isAdmin: true,
      });
      logger.info("✅ 管理员用户已创建");
    } else {
      await db.update(usersTable).set({
        passwordHash: adminPasswordHash,
        isActive: true,
      }).where(eq(usersTable.username, "admin"));
      logger.info("✅ 管理员用户密码已重置");
    }
    logger.info("   用户名: admin");
    logger.info("   密码: admin123");

    // 创建或更新 wbz 用户
    const existingWbz = await db.query.usersTable.findFirst({
      where: eq(usersTable.username, "wbz"),
    });

    const wbzPasswordHash = await bcrypt.hash("wbz123", 10);
    if (!existingWbz) {
      await db.insert(usersTable).values({
        username: "wbz",
        passwordHash: wbzPasswordHash,
        isAdmin: false,
      });
      logger.info("✅ wbz 用户已创建");
    } else {
      await db.update(usersTable).set({
        passwordHash: wbzPasswordHash,
        isActive: true,
      }).where(eq(usersTable.username, "wbz"));
      logger.info("✅ wbz 用户密码已重置");
    }
    logger.info("   用户名: wbz");
    logger.info("   密码: wbz123");
  } catch (error) {
    logger.error({ err: error }, "初始化用户失败");
  }
}

server.listen(port, async (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  await loadBcrypt();
  await initAdminUser();
  
  logger.info("✅ 数据库连接成功");
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
