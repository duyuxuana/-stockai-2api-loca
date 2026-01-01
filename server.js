
const http = require('http');
const http2 = require('http2');
const crypto = require('crypto');

// 配置
const PORT = 3000;
const TARGET_HOST = 'https://free.stockai.trade';
const TARGET_PATH = '/api/chat';

// 允许的模型列表 (动态获取前的 Fallback)
let CACHED_MODELS = [
  "mistral/devstral-2",
  "qwen/qwen3-coder",
  "openai/gpt-4o-mini",
  "deepseek/deepseek-chat-v3.1"
];
let LAST_FETCH_TIME = 0;
const CACHE_TTL = 3600000; // 缓存 1 小时

const server = http.createServer(async (req, res) => {
  // CORS 配置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. 处理模型列表请求 (动态获取)
  if (req.url === '/v1/models') {
    const models = await getModels();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: models.map(id => ({ id, object: 'model', created: Date.now() }))
    }));
    return;
  }

  // 2. 处理聊天请求
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const reqBody = JSON.parse(body);
        await handleChatRequest(reqBody, res);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

async function handleChatRequest(openaiBody, clientRes) {
  const model = openaiBody.model || "mistral/devstral-2";
  const stream = openaiBody.stream !== false;
  
  // 转换请求体
  const payload = JSON.stringify({
    model: model,
    webSearch: false,
    id: generateId(16),
    messages: openaiBody.messages.map(m => ({
      parts: [{ type: "text", text: m.content }],
      id: generateId(16),
      role: m.role
    })),
    trigger: "submit-message"
  });

  // 使用 HTTP/2 客户端 (核心：模拟浏览器指纹)
  const client = http2.connect(TARGET_HOST);
  
  client.on('error', (err) => {
    console.error('Upstream Error:', err);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
      clientRes.end(JSON.stringify({ error: 'Upstream connection failed' }));
    }
  });

  const reqHeaders = {
    ':method': 'POST',
    ':path': TARGET_PATH,
    ':scheme': 'https',
    'content-type': 'application/json',
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'origin': TARGET_HOST,
    'referer': TARGET_HOST + '/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'priority': 'u=1, i'
  };

  const req = client.request(reqHeaders);
  req.setEncoding('utf8');

  // 设置客户端响应头
  if (stream) {
    clientRes.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
  } else {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
  }

  let fullContent = "";
  let fullReasoning = "";
  let buffer = "";

  req.on('response', (headers) => {
    if (headers[':status'] !== 200) {
      console.log(`Upstream Status: ${headers[':status']}`);
    }
  });

  req.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      try {
        const data = JSON.parse(dataStr);
        let content = null;
        let reasoning = null;

        if (data.type === 'text-delta' && data.delta) content = data.delta;
        if (data.type === 'reasoning' && data.text) reasoning = data.text;

        if (content || reasoning) {
          if (stream) {
            const chunk = {
              id: 'chatcmpl-' + generateId(10),
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{ index: 0, delta: reasoning ? { reasoning_content: reasoning } : { content: content }, finish_reason: null }]
            };
            clientRes.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else {
            if (content) fullContent += content;
            if (reasoning) fullReasoning += reasoning;
          }
        }
      } catch (e) {}
    }
  });

  req.on('end', () => {
    // 处理剩余的 buffer
    if (buffer) {
      const lines = [buffer];
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          let content = null;
          let reasoning = null;
          if (data.type === 'text-delta' && data.delta) content = data.delta;
          if (data.type === 'reasoning' && data.text) reasoning = data.text;
          if (content || reasoning) {
             if (stream) {
                const chunk = {
                  id: 'chatcmpl-' + generateId(10),
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: model,
                  choices: [{ index: 0, delta: reasoning ? { reasoning_content: reasoning } : { content: content }, finish_reason: null }]
                };
                clientRes.write(`data: ${JSON.stringify(chunk)}\n\n`);
             } else {
                if (content) fullContent += content;
                if (reasoning) fullReasoning += reasoning;
             }
          }
        } catch (e) {}
      }
    }

    if (stream) {
      const endChunk = {
        id: 'chatcmpl-' + generateId(10),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
      };
      clientRes.write(`data: ${JSON.stringify(endChunk)}\n\n`);
      clientRes.write('data: [DONE]\n\n');
      clientRes.end();
    } else {
      const resp = {
        id: 'chatcmpl-' + generateId(10),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: { 
            role: 'assistant', 
            content: fullContent,
            reasoning_content: fullReasoning || undefined
          },
          finish_reason: "stop"
        }]
      };
      clientRes.end(JSON.stringify(resp));
    }
    client.close();
  });

  req.write(payload);
  req.end();
}

function generateId(len) {
  return crypto.randomBytes(Math.ceil(len/2)).toString('hex').slice(0, len);
}

const https = require('https');

async function getModels() {
  const now = Date.now();
  if (CACHED_MODELS.length > 5 && (now - LAST_FETCH_TIME < CACHE_TTL)) {
    return CACHED_MODELS;
  }

  try {
    const homeHtml = await fetchUrl(TARGET_HOST + '/');
    const pageJsRegex = /src="(\/_next\/static\/chunks\/app\/page-[a-z0-9]+\.js)"/;
    const match = homeHtml.match(pageJsRegex);
    
    if (match) {
      const jsContent = await fetchUrl(TARGET_HOST + match[1]);
      const listRegex = /\[\s*\{[^{}]*name\s*:\s*"[^"]+"[^{}]*value\s*:\s*"[^"]+"[^{}]*\}\s*(?:,\s*\{[^{}]*name\s*:\s*"[^"]+"[^{}]*value\s*:\s*"[^"]+"[^{}]*\}\s*)*\]/g;
      const listMatches = jsContent.match(listRegex);
      
      if (listMatches) {
        let bestMatch = "";
        let maxCount = 0;
        for (const m of listMatches) {
          const count = (m.match(/value\s*:\s*"[^"]+"/g) || []).length;
          if (count > maxCount) { maxCount = count; bestMatch = m; }
        }

        if (bestMatch) {
          const valueRegex = /value\s*:\s*"([^"]+)"/g;
          const extracted = [];
          let m;
          while ((m = valueRegex.exec(bestMatch)) !== null) {
            extracted.push(m[1]);
          }
          if (extracted.length > 0) {
            CACHED_MODELS = extracted;
            LAST_FETCH_TIME = now;
            console.log(`[System] Models updated: ${extracted.length} found.`);
          }
        }
      }
    }
  } catch (e) {
    console.error('[Error] Failed to fetch dynamic models:', e.message);
  }
  return CACHED_MODELS;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`\nLocal Proxy Running!`);
  console.log(`Endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`Test command: curl http://localhost:${PORT}/v1/chat/completions -X POST -H "Content-Type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"`);
});
