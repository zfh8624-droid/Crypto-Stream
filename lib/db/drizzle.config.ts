import { defineConfig } from "drizzle-kit";
import path from "path";

const isProduction = process.env.NODE_ENV === "production";

// 本地开发环境使用本地文件，生产环境使用 Turso
const localDbUrl = "file:./local.db";
const tursoDbUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

let dbUrl: string;
let authToken: string | undefined;

if (isProduction) {
  if (!tursoDbUrl) {
    throw new Error("生产环境必须设置 TURSO_DATABASE_URL 环境变量！");
  }
  dbUrl = tursoDbUrl;
  authToken = tursoAuthToken;
} else {
  dbUrl = localDbUrl;
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: dbUrl,
    authToken: authToken,
  },
});
