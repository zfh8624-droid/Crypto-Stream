import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export type AssetType = 'crypto' | 'ashare';
export type MAType = 'SMA' | 'EMA' | 'WMA';
export type SignalType = 'golden' | 'death';
export type TrendStatus = 'bullish' | 'bearish' | 'neutral';
export type ExitMarketMode = 'bullish' | 'bearish';

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
    assetType: text('asset_type').notNull().$type<AssetType>(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    interval: text('interval').notNull(),
    maType: text('ma_type').notNull().$type<MAType>(),
    ma1Period: integer('ma1_period').notNull(),
    ma2Period: integer('ma2_period').notNull(),
    ma3Period: integer('ma3_period').notNull(),
    conditions: text('conditions', { mode: 'json' }).notNull().$type<Condition[]>(),
    signalType: text('signal_type').notNull().$type<SignalType>(),
    dingtalkWebhook: text('dingtalk_webhook'),
    lastCheckAt: integer('last_check_at', { mode: 'timestamp' }),
    lastSignalAt: integer('last_signal_at', { mode: 'timestamp' }),
    hasSentSignal: integer('has_sent_signal', { mode: 'boolean' }).notNull().default(false),
    prevMa1GtMa2: integer('prev_ma1_gt_ma2', { mode: 'boolean' }),
    trendStatus: text('trend_status').notNull().default('neutral').$type<TrendStatus>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => Date.now()),
    // 离场监控相关字段
    enableExitMonitor: integer('enable_exit_monitor', { mode: 'boolean' }).notNull().default(false),
    inPosition: integer('in_position', { mode: 'boolean' }).notNull().default(false),
    exitMarketMode: text('exit_market_mode').$type<ExitMarketMode>(),
    prevClosePrice: integer('prev_close_price'),
    hasSentExitSignal: integer('has_sent_exit_signal', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => {
    return {
      userIdIdx: index('user_id_idx').on(table.userId),
      symbolIdx: index('symbol_idx').on(table.symbol),
      userSymbolIdx: index('user_symbol_idx').on(table.userId, table.symbol),
    };
  }
);

export type Monitor = typeof monitorsTable.$inferSelect;
