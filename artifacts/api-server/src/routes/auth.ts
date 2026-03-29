import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { authenticateToken } from "../middlewares/auth.js";

// 使用与index.ts相同的逻辑
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "your-secret-key-change-in-production")) {
  throw new Error("生产环境必须设置JWT_SECRET环境变量，且不能使用默认值！");
}

const JWT_EXPIRES_IN = "7d";

const router: IRouter = Router();

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "用户名和密码不能为空" });
    }

    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.username, username),
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "登录失败" });
  }
});

// 验证token是否有效的端点
router.get("/verify", authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.sendStatus(401);
    }

    // 从数据库重新获取用户信息，确保用户存在且状态正常
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, parseInt(req.user.id)),
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "用户不存在或已被禁用" });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    console.error("Verify token error:", error);
    res.status(500).json({ error: "验证失败" });
  }
});

export default router;
