#!/usr/bin/env tsx
import { db, usersTable } from "@workspace/db";
import bcrypt from "bcrypt";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("🚀 初始化数据库 - 创建管理员用户");
  console.log("=");
  
  const username = await question("输入用户名: ");
  const password = await question("输入密码: ");
  
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
      console.error("❌ 错误: 用户名已存在!");
    } else {
      console.error("❌ 创建失败:", error);
    }
  } finally {
    rl.close();
  }
}

main();
