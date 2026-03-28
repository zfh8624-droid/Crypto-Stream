import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "crypto-stream.db");
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const client = createClient({
  url: `file:${dbPath}`
});

export const db = drizzle(client, { schema });

export * from "./schema";
export { monitorsTable } from "./schema/monitors";
export { usersTable } from "./schema/users";
export type { Monitor } from "./schema/monitors";
export type { User } from "./schema/users";

