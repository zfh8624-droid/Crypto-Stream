import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const isProduction = process.env.NODE_ENV === "production";

// 本地开发环境使用 localhost，生产环境使用 Replit 数据库
const localDbUrl = "postgresql://qiaozhi@localhost:5432/heliumdb?sslmode=disable";
const productionDbUrl = "postgresql://postgres:password@helium/heliumdb?sslmode=disable";

const dbUrl = process.env.DATABASE_URL || (isProduction ? productionDbUrl : localDbUrl);

console.log(`[DB] 环境: ${isProduction ? '生产' : '开发'}`);
console.log(`[DB] 连接地址: ${dbUrl.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@')}`);

const client = postgres(dbUrl);

export const db = drizzle(client, { schema });

export * from "./schema";
export { monitorsTable } from "./schema/monitors";
export { usersTable } from "./schema/users";
export type { Monitor } from "./schema/monitors";
export type { User } from "./schema/users";

