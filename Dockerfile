# 使用轻量级 Node.js 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json (利用 Docker 缓存机制)
COPY package.json ./

# 虽然目前没有外部依赖，但保留 install 步骤以备未来扩展
# 如果有 package-lock.json 也应该复制
RUN npm install --production

# 复制源代码
COPY server.js ./

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]
