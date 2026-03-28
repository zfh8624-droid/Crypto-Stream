import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

// 使用与index.ts相同的逻辑
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "your-secret-key-change-in-production")) {
  throw new Error("生产环境必须设置JWT_SECRET环境变量，且不能使用默认值！");
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        isAdmin: boolean;
      };
    }
  }
}

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user as any;
    next();
  });
};
