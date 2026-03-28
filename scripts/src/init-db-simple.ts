#!/usr/bin/env tsx
import { db, usersTable } from "../../lib/db/src/index.js";
import bcrypt from "bcrypt";

async function main() {
  console.log("🚀 初始化数据库 - 创建默认管理员用户");
  console.log("=".repeat(50));
  
  const username = "admin";
  const password = "admin123";
  
  console.log(`用户名: ${username}`);
  console.log(`密码: ${password}`);
  console.log("");
  
  const passwordHash = await bcrypt.hash(password, 10);
  
  try {
    const result = await db.insert(usersTable).values({
      username,
      passwordHash,
      isAdmin: true,
    }).returning();
    
    console.log("");
    console.log("✅ 管理员用户创建成功!");
    console.log(`   用户ID: ${result[0].id}`);
    console.log(`   用户名: ${username}`);
  } catch (error: any) {
    if (error?.message?.includes("UNIQUE")) {
      console.log("ℹ️  管理员用户已存在，跳过创建");
    } else {
      console.error("❌ 创建失败:", error);
    }
  }
}

main();
