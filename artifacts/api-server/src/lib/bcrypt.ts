// 统一使用 bcryptjs（纯 JavaScript，无需编译）
let bcryptInstance: any = null;

export async function loadBcrypt() {
  if (bcryptInstance) return bcryptInstance;
  
  const bcryptjs = await import("bcryptjs");
  bcryptInstance = bcryptjs.default || bcryptjs;
  
  return bcryptInstance;
}

export async function getBcrypt() {
  if (!bcryptInstance) {
    await loadBcrypt();
  }
  return bcryptInstance;
}
