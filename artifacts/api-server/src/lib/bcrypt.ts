const isProduction = process.env.NODE_ENV === "production";
let bcryptInstance: any = null;

export async function loadBcrypt() {
  if (bcryptInstance) return bcryptInstance;
  
  if (isProduction) {
    // 生产环境使用 bcrypt
    try {
      const bcrypt = await import("bcrypt");
      bcryptInstance = bcrypt.default || bcrypt;
    } catch (error) {
      // 如果 bcrypt 加载失败，回退到 bcryptjs
      const bcryptjs = await import("bcryptjs");
      bcryptInstance = bcryptjs.default || bcryptjs;
    }
  } else {
    // 开发环境使用 bcryptjs
    const bcryptjs = await import("bcryptjs");
    bcryptInstance = bcryptjs.default || bcryptjs;
  }
  
  return bcryptInstance;
}

export async function getBcrypt() {
  if (!bcryptInstance) {
    await loadBcrypt();
  }
  return bcryptInstance;
}
