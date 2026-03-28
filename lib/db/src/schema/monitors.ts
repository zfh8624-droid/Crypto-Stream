import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export type AssetType = 'crypto' | 'ashare';
export type MAType = 'SMA' | 'EMA' | 'WMA';
export type SignalType = 'golden' | 'death';

export interface Condition {
  id: string;
  left: 'price' | 'ma1' | 'ma2' | 'ma3';
  op: '>' | '<' | '=';
  right: 'price' | 'ma1' | 'ma2' | 'ma3';
}

export const monitorsTable = sqliteTable(
  'monitors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    symbol: text('symbol').notNull(),
    displayName: text('display_name').notNull(),
    assetType: text('asset_type', { enum: ['crypto', 'ashare'] }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    interval: text('interval').notNull(),
    maType: text('ma_type', { enum: ['SMA', 'EMA', 'WMA'] }).notNull(),
    ma1Period: integer('ma1_period').notNull(),
    ma2Period: integer('ma2_period').notNull(),
    ma3Period: integer('ma3_period').notNull(),
    conditions: text('conditions', { mode: 'json' }).notNull(),
    signalType: text('signal_type', { enum: ['golden', 'death'] }).notNull(),
    dingtalkWebhook: text('dingtalk_webhook'),
    lastCheckAt: integer('last_check_at', { mode: 'timestamp' }),
    lastSignalAt: integer('last_signal_at', { mode: 'timestamp' }),
    hasSentSignal: integer('has_sent_signal', { mode: 'boolean' }).notNull().default(false),
    prevMa1GtMa2: integer('prev_ma1_gt_ma2', { mode: 'boolean' }),
    trendStatus: text('trend_status', { enum: ['bullish', 'bearish', 'neutral'] }).notNull().default('neutral'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (table) => {
    return {
      userIdIdx: index('user_id_idx').on(table.userId),
      symbolIdx: index('symbol_idx').on(table.symbol),
      // 复合索引用于优化查询
      userSymbolIdx: index('user_symbol_idx').on(table.userId, table.symbol),
    };
  }
);

export type Monitor = typeof monitorsTable.$inferSelect;
