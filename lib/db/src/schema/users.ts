import { pgTable, text, serial, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const usersTable = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    isAdmin: boolean('is_admin').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => {
    return {
      usernameIdx: uniqueIndex('username_idx').on(table.username),
    };
  }
);

export type User = typeof usersTable.$inferSelect;
