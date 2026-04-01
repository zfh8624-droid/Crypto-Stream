import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

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

console.log(`[DB] 环境: ${isProduction ? '生产' : '开发'}`);
console.log(`[DB] 连接地址: ${dbUrl}`);

const client = createClient({
  url: dbUrl,
  authToken: authToken,
});

export const db = drizzle(client, { schema });

export * from "./schema";
export { monitorsTable } from "./schema/monitors";
export { usersTable } from "./schema/users";
export type { Monitor } from "./schema/monitors";
export type { User } from "./schema/users";
