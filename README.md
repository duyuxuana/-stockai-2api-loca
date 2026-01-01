# StockAI-2API (Local Version)

这是一个将 [StockAI](https://free.stockai.trade) 的免费聊天接口转换为标准 OpenAI API 格式的本地代理服务。

## ✨ 特性

- **OpenAI 格式兼容**：完美支持 `/v1/chat/completions` 和 `/v1/models`。
- **动态模型同步**：自动从 StockAI 官网抓取最新的可用模型列表。
- **流式响应支持**：支持 Server-Sent Events (SSE)，打字机效果流畅。
- **指纹伪装**：内置 HTTP/2 和浏览器指纹模拟，降低被拦截风险。
- **Docker 支持**：提供轻量级 Docker 镜像，一键部署。

## 🚀 快速开始 (Node.js)

1. **安装 Node.js** (版本 >= 18)
2. **下载代码**
3. **运行服务**
   ```bash
   node server.js
   ```
4. **配置客户端** (如 NextChat, LobeChat, BotGem 等)
   - **Base URL**: `http://localhost:3000/v1`
   - **API Key**: 任意填写 (如 `sk-123456`)

## 🐳 Docker 部署

### 1. 构建镜像

```bash
docker build -t stockai-2api .
```

### 2. 运行容器

```bash
docker run -d -p 3000:3000 --name stockai-proxy stockai-2api
```

此时服务已在 `http://localhost:3000` 运行。

### 3. 使用 Docker Compose (可选)

创建一个 `docker-compose.yml` 文件：

```yaml
version: '3'
services:
  stockai-proxy:
    image: stockai-2api:latest # 或者使用构建指令 build: .
    container_name: stockai-proxy
    ports:
      - "3000:3000"
    restart: unless-stopped
```

然后运行：
```bash
docker-compose up -d
```

## 🛠️ API 接口说明

### 1. 获取模型列表
- **GET** `/v1/models`
- 返回 StockAI 当前支持的所有模型。

### 2. 聊天对话
- **POST** `/v1/chat/completions`
- 支持参数：`model`, `messages`, `stream`
- 示例：
  ```json
  {
    "model": "mistral/devstral-2",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }
  ```

## ⚠️ 免责声明

本项目仅供学习和研究 HTTP/2 协议及 API 转发技术使用。请勿用于商业用途或大规模滥用上游服务。
