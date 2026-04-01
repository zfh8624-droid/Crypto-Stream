#!/usr/bin/env tsx
import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.vvhjzniouojcfpgzjlcz:17754528624qq@aws-1-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

console.log("🔗 测试数据库连接...");
console.log("📍 连接地址:", DATABASE_URL.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));
console.log("");

try {
  const sql = postgres(DATABASE_URL);
  
  console.log("✅ 连接成功！");
  console.log("");
  
  // 测试查询
  const result = await sql`SELECT NOW()`;
  console.log("📊 查询结果:", result);
  console.log("");
  
  // 看看有哪些表
  const tables = await sql`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
  `;
  console.log("📋 数据库中的表:", tables);
  
  await sql.end();
  console.log("");
  console.log("✅ 测试完成！");
  
} catch (error) {
  console.error("❌ 连接失败:", error);
  process.exit(1);
}
