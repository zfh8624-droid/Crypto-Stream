import { pgTable, text, serial, integer, json, boolean, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';

export const assetTypeEnum = pgEnum('asset_type', ['crypto', 'ashare']);
export const maTypeEnum = pgEnum('ma_type', ['SMA', 'EMA', 'WMA']);
export const signalTypeEnum = pgEnum('signal_type', ['golden', 'death']);
export const trendStatusEnum = pgEnum('trend_status', ['bullish', 'bearish', 'neutral']);
export const exitMarketModeEnum = pgEnum('exit_market_mode', ['bullish', 'bearish']);

export type AssetType = 'crypto' | 'ashare';
export type MAType = 'SMA' | 'EMA' | 'WMA';
export type SignalType = 'golden' | 'death';

export interface Condition {
  id: string;
  left: 'price' | 'ma1' | 'ma2' | 'ma3';
  op: '>' | '<' | '=';
  right: 'price' | 'ma1' | 'ma2' | 'ma3';
}

export type ExitMarketMode = 'bullish' | 'bearish';

export const monitorsTable = pgTable(
  'monitors',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    symbol: text('symbol').notNull(),
    displayName: text('display_name').notNull(),
    assetType: assetTypeEnum('asset_type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    interval: text('interval').notNull(),
    maType: maTypeEnum('ma_type').notNull(),
    ma1Period: integer('ma1_period').notNull(),
    ma2Period: integer('ma2_period').notNull(),
    ma3Period: integer('ma3_period').notNull(),
    conditions: json('conditions').notNull().$type<Condition[]>(),
    signalType: signalTypeEnum('signal_type').notNull(),
    dingtalkWebhook: text('dingtalk_webhook'),
    lastCheckAt: timestamp('last_check_at', { mode: 'date' }),
    lastSignalAt: timestamp('last_signal_at', { mode: 'date' }),
    hasSentSignal: boolean('has_sent_signal').notNull().default(false),
    prevMa1GtMa2: boolean('prev_ma1_gt_ma2'),
    trendStatus: trendStatusEnum('trend_status').notNull().default('neutral'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
    // 离场监控相关字段
    enableExitMonitor: boolean('enable_exit_monitor').notNull().default(false),
    inPosition: boolean('in_position').notNull().default(false),
    exitMarketMode: exitMarketModeEnum('exit_market_mode'),
    prevClosePrice: integer('prev_close_price'),
    hasSentExitSignal: boolean('has_sent_exit_signal').notNull().default(false),
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
