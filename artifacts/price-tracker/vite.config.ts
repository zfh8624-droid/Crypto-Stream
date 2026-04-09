import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

// 只在 Replit 环境加载 @replit 插件
async function getReplitPlugins() {
  if (process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined) {
    try {
      const [runtimeErrorOverlay, cartographer, devBanner] = await Promise.all([
        import("@replit/vite-plugin-runtime-error-modal").catch(() => null),
        import("@replit/vite-plugin-cartographer").catch(() => null),
        import("@replit/vite-plugin-dev-banner").catch(() => null),
      ]);
      
      const plugins = [];
      if (runtimeErrorOverlay) plugins.push(runtimeErrorOverlay.default());
      if (cartographer) {
        plugins.push(
          cartographer.cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          })
        );
      }
      if (devBanner) plugins.push(devBanner.devBanner());
      return plugins;
    } catch {
      return [];
    }
  }
  return [];
}

export default defineConfig(async () => {
  const replitPlugins = await getReplitPlugins();
  
  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      ...replitPlugins,
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
