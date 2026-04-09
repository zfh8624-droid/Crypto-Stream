import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { authenticateToken } from "../middlewares/auth.js";
import { getBcrypt } from "../lib/bcrypt.js";

const router: IRouter = Router();

// 只允许管理员访问
const requireAdmin = (req: Request, res: Response, next: any) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: "权限不足，需要管理员权限" });
  }
  next();
};

router.use(authenticateToken);

// 获取用户列表（除了admin）
router.get("/users", requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await db.query.usersTable.findMany({
      where: eq(usersTable.isAdmin, false),
    });

    const userList = users.map(user => ({
      id: user.id,
      username: user.username,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }));

    res.json(userList);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "获取用户列表失败" });
  }
});

// 创建新用户
router.post("/users", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "用户名和密码不能为空" });
    }

    if (username === "admin") {
      return res.status(400).json({ error: "不能创建名为admin的用户" });
    }

    // 检查用户是否已存在
    const existingUser = await db.query.usersTable.findFirst({
      where: eq(usersTable.username, username),
    });

    if (existingUser) {
      return res.status(400).json({ error: "用户名已存在" });
    }

    const bcrypt = await getBcrypt();
    const passwordHash = await bcrypt.hash(password, 10);
    const [newUser] = await db.insert(usersTable).values({
      username,
      passwordHash,
      isAdmin: false,
      isActive: true,
    }).returning();

    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      isActive: newUser.isActive,
      createdAt: newUser.createdAt,
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ error: "创建用户失败" });
  }
});

// 禁用/启用用户（软删除）
router.put("/users/:id/status", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive 参数必须是布尔值" });
    }

    // 检查用户是否存在
    const existingUser = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, userId),
    });

    if (!existingUser) {
      return res.status(404).json({ error: "用户不存在" });
    }

    if (existingUser.isAdmin) {
      return res.status(400).json({ error: "不能禁用管理员用户" });
    }

    const [updatedUser] = await db.update(usersTable)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();

    res.json({
      id: updatedUser.id,
      username: updatedUser.username,
      isActive: updatedUser.isActive,
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({ error: "更新用户状态失败" });
  }
});

export default router;