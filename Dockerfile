FROM node:22-slim

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm@9

# 复制 workspace 配置
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

# 复制所有 packages
COPY artifacts/api-server ./artifacts/api-server
COPY artifacts/price-tracker ./artifacts/price-tracker
COPY artifacts/mockup-sandbox ./artifacts/mockup-sandbox
COPY lib/db ./lib/db
COPY lib/api-zod ./lib/api-zod
COPY lib/api-client-react ./lib/api-client-react
COPY scripts ./scripts

# 安装依赖
RUN pnpm install --no-frozen-lockfile

# 构建 api-server
WORKDIR /app/artifacts/api-server
RUN pnpm run build

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["pnpm", "run", "start"]
