import { defineConfig } from "drizzle-kit";
import path from "path";

const isProduction = process.env.NODE_ENV === "production";

// 本地开发环境使用 localhost，生产环境使用 Replit 数据库
const localDbUrl = "postgresql://qiaozhi@localhost:5432/heliumdb?sslmode=disable";
const productionDbUrl = "postgresql://postgres:password@helium/heliumdb?sslmode=disable";

const dbUrl = process.env.DATABASE_URL || (isProduction ? productionDbUrl : localDbUrl);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
