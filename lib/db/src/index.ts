import { drizzle } from "drizzle-orm/node-sqlite3";
import sqlite3 from "sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "crypto-stream.db");
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new sqlite3.Database(dbPath);
export const db = drizzle(sqlite, { schema });

export * from "./schema";
export { monitorsTable } from "./schema/monitors";
export { usersTable } from "./schema/users";
export type { Monitor } from "./schema/monitors";
export type { User } from "./schema/users";

