import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, monitorsTable } from "@workspace/db";
import type { Monitor } from "@workspace/db";
import { authenticateToken } from "../middlewares/auth.js";

const router: IRouter = Router();

router.use(authenticateToken);

router.get("/monitors", async (req: Request, res: Response) => {
  try {
    console.log("[GET /monitors] req.user:", req.user);
    if (!req.user) {
      return res.sendStatus(401);
    }

    const userId = parseInt(req.user.id);
    console.log("[GET /monitors] Using userId:", userId);

    const monitors = await db
      .select()
      .from(monitorsTable)
      .where(eq(monitorsTable.userId, userId));

    // 处理 conditions 字段 - 从数据库读取时可能是字符串，需要解析
    const processedMonitors = monitors.map(m => ({
      ...m,
      conditions: typeof m.conditions === "string" ? JSON.parse(m.conditions) : m.conditions
    }));

    console.log("[GET /monitors] Processed monitors:", processedMonitors);
    res.json(processedMonitors);
  } catch (error) {
    console.error("Get monitors error:", error);
    res.status(500).json({ error: "获取监控列表失败" });
  }
});

router.post("/monitors", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.sendStatus(401);
    }

    const userId = parseInt(req.user.id);
    const symbol = req.body.symbol;
    
    // 先检查是否已存在相同的用户+币种组合
    const existing = await db.select().from(monitorsTable)
      .where(eq(monitorsTable.userId, userId))
      .where(eq(monitorsTable.symbol, symbol));

    if (existing.length > 0) {
      // 已存在，执行更新而不是创建
      const monitorData = {
        ...req.body,
        userId,
        updatedAt: new Date(),
      };
      
      const [updatedMonitor] = await db
        .update(monitorsTable)
        .set(monitorData)
        .where(eq(monitorsTable.id, existing[0].id))
        .returning();
      
      res.json(updatedMonitor);
    } else {
      // 不存在，创建新记录
      const monitorData = {
        ...req.body,
        userId,
      };

      const [newMonitor] = await db
        .insert(monitorsTable)
        .values(monitorData)
        .returning();

      res.status(201).json(newMonitor);
    }
  } catch (error) {
    console.error("Create monitor error:", error);
    res.status(500).json({ error: "创建监控失败" });
  }
});

router.put("/monitors/:id", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.sendStatus(401);
    }

    const monitorId = parseInt(req.params.id);
    const userId = parseInt(req.user.id);

    // 首先检查监控是否属于当前用户
    const [existingMonitor] = await db
      .select()
      .from(monitorsTable)
      .where(eq(monitorsTable.id, monitorId));

    if (!existingMonitor) {
      return res.status(404).json({ error: "监控不存在" });
    }

    // 验证所有权
    if (existingMonitor.userId !== userId) {
      return res.status(403).json({ error: "无权修改此监控" });
    }

    const monitorData = {
      ...req.body,
      updatedAt: new Date(),
    };

    const [updatedMonitor] = await db
      .update(monitorsTable)
      .set(monitorData)
      .where(
        eq(monitorsTable.id, monitorId)
      )
      .returning();

    res.json(updatedMonitor);
  } catch (error) {
    console.error("Update monitor error:", error);
    res.status(500).json({ error: "更新监控失败" });
  }
});

router.delete("/monitors/:id", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.sendStatus(401);
    }

    const monitorId = parseInt(req.params.id);
    const userId = parseInt(req.user.id);

    // 首先检查监控是否属于当前用户
    const [existingMonitor] = await db
      .select()
      .from(monitorsTable)
      .where(eq(monitorsTable.id, monitorId));

    if (!existingMonitor) {
      return res.status(404).json({ error: "监控不存在" });
    }

    // 验证所有权
    if (existingMonitor.userId !== userId) {
      return res.status(403).json({ error: "无权删除此监控" });
    }

    const result = await db
      .delete(monitorsTable)
      .where(
        eq(monitorsTable.id, monitorId)
      );

    res.sendStatus(204);
  } catch (error) {
    console.error("Delete monitor error:", error);
    res.status(500).json({ error: "删除监控失败" });
  }
});

// 批量更新用户所有监控的钉钉地址
router.put("/monitors/batch/update-webhook", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.sendStatus(401);
    }

    const userId = parseInt(req.user.id);
    const { webhookUrl } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({ error: "缺少 webhookUrl 参数" });
    }

    // 批量更新用户的所有监控记录
    const result = await db
      .update(monitorsTable)
      .set({
        dingtalkWebhook: webhookUrl,
        updatedAt: new Date(),
      })
      .where(eq(monitorsTable.userId, userId));

    // 获取实际更新的记录数
    const updatedCount = result?.changes || 0;
    res.json({ success: true, updatedCount });
  } catch (error) {
    console.error("Batch update webhook error:", error);
    res.status(500).json({ error: "批量更新钉钉地址失败" });
  }
});

export default router;
