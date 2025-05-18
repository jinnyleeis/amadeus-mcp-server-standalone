// src/index.ts

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import Amadeus from 'amadeus';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import type {
  RegisteredPrompt,
  RegisteredTool
} from '@modelcontextprotocol/sdk/server/mcp.js';

dotenv.config();

// ————— Amadeus 클라이언트 & 캐시 초기화 —————
export const amadeus = process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET
  ? new Amadeus({
      clientId: process.env.AMADEUS_CLIENT_ID,
      clientSecret: process.env.AMADEUS_CLIENT_SECRET,
    })
  : null;


export const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false })

export async function cachedApiCall<T>(
  cacheKey: string,
  ttl: number,
  apiCall: () => Promise<T>,
): Promise<T> {
  const hit = cache.get<T>(cacheKey);
  if (hit) return hit;
  const res = await apiCall();
  cache.set(cacheKey, res, ttl);
  return res;
}

// ————— MCP 서버 인스턴스 생성 —————
export const server = new McpServer({
  name: 'amadeus-mcp-server',
  version: '1.0.0',
});


// ——— 테스트용 확장: prompts/tools 어레이를 붙인다 ———
;(server as any).prompts = [] as RegisteredPrompt[];
;(server as any).tools = [] as RegisteredTool[];

// 원래 prompt/tool 메서드를 래핑해, 등록 시 배열에도 담아 준다
const _origPrompt = server.prompt;
server.prompt = (name:any, cb:any) => {
  const registered = _origPrompt.call(server, name, cb);
  (server as any).prompts.push(registered);
  return registered;
};

const _origTool = server.tool;
server.tool = (name, cb) => {
  const registered = _origTool.call(server, name, cb);
  (server as any).tools.push(registered);
  return registered;
};

async function initMcp() {
  // 툴, 리소스, 프롬프트 등록
  await Promise.all([
    import('./tools.js'),
    import('./resources.js'),
    import('./prompt.js'),
  ]);
}

export async function main() {
  await initMcp();
  console.error('🚀 MCP Server initialized');

  // 1) Streamable HTTP transport 생성 (port 옵션 제거!)
  const transport = new StreamableHTTPServerTransport({
    // stateful 모드 쓰려면 sessionIdGenerator: () => crypto.randomUUID()
    sessionIdGenerator: undefined,  // stateless 모드
  });
  await server.connect(transport);
  console.error('✅ Transport connected');

  // 2) Express 앱으로 /mcp 엔드포인트 열기
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    try {
      // 공식문서대로 handleRequest에 req, res, body 넘김
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        });
      }
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Amadeus Flight MCP Server HTTP listening on http://localhost:${PORT}/mcp`);
  });
}

// CLI로 직접 실행할 때만
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
