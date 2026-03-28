import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const usersTable = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => {
    return {
      usernameIdx: uniqueIndex('username_idx').on(table.username),
    };
  }
);

export type User = typeof usersTable.$inferSelect;
