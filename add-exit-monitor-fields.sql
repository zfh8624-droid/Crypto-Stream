-- ========================================
-- 离场监控功能数据库迁移脚本
-- ========================================

-- 1. 添加离场市场模式枚举类型
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exit_market_mode') THEN
    CREATE TYPE exit_market_mode AS ENUM ('bullish', 'bearish');
  END IF;
END $$;

-- 2. 添加离场监控相关字段
ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS enable_exit_monitor BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS in_position BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exit_market_mode exit_market_mode,
  ADD COLUMN IF NOT EXISTS prev_close_price INTEGER,
  ADD COLUMN IF NOT EXISTS has_sent_exit_signal BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. 验证字段添加成功
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'monitors'
  AND column_name IN (
    'enable_exit_monitor',
    'in_position',
    'exit_market_mode',
    'prev_close_price',
    'has_sent_exit_signal'
  )
ORDER BY ordinal_position;

-- ========================================
-- 字段说明：
-- ========================================
-- enable_exit_monitor: 是否启用离场监控
-- in_position: 是否已进场（用户手动打勾）
-- exit_market_mode: 市场模式（bullish=牛市, bearish=熊市）
-- prev_close_price: 上一日收盘价（用于熊市模式判断）
-- has_sent_exit_signal: 是否已发送离场信号
-- ========================================
