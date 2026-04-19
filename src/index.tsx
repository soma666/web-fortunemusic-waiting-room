/**
 * index.tsx - Bun 开发服务器入口
 * 
 * 这是应用的服务端入口文件，使用 Bun.serve() 创建开发服务器。
 * 主要功能：
 * 1. 提供静态文件服务（HTML/CSS/JS）
 * 2. 代理 FortuneMusic API 请求，解决 CORS 问题
 * 3. 支持热重载（开发模式下）
 */

import { serve } from "bun";
import index from "./index.html";
import {
  handleGetDays,
  handleGetDayEvents,
  handleGetDayDetails,
  handleGetLegacy,
  handlePost,
  handleDelete,
} from "./lib/local-history-db";

const server = serve({
  // 开发模式配置
  development: process.env.NODE_ENV !== "production" && {
    // 热重载（已禁用以提高稳定性）
    hmr: false,
    // 浏览器控制台输出（已禁用以提高稳定性）
    console: false,
  },
  routes: {
    /**
     * 代理活动事件 API
     * 本地开发时通过 /api/events 访问，避免 CORS 问题
     * 生产环境直接使用 corsproxy.io
     */
    "/api/events": {
      async GET() {
        try {
          // 调用 FortuneMusic 官方 API
          const response = await fetch("https://api.fortunemusic.app/v1/appGetEventData/");

          if (!response.ok) {
            return new Response(JSON.stringify({ error: `API returned ${response.status}` }), {
              status: response.status,
              headers: { "Content-Type": "application/json" },
            });
          }

          const data = await response.json();

          // 返回数据，添加 CORS 头
          return new Response(JSON.stringify(data), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (error) {
          console.error("Proxy error:", error);
          return new Response(JSON.stringify({ error: "Failed to fetch from FortuneMusic API" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
    
    /**
     * 代理等待室 API
     * 本地开发时通过 /api/waitingrooms 访问，避免 CORS 问题
     * 注意：这是一个 POST 请求，需要传递 eventId 参数
     */
    "/api/waitingrooms": {
      async POST(req) {
        try {
          const body = await req.json();
          
          // 调用 FortuneMusic 等待室 API
          const response = await fetch("https://meets.fortunemusic.app/lapi/v5/app/dateTimezoneMessages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Host": "meets.fortunemusic.app",
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            return new Response(JSON.stringify({ error: `API returned ${response.status}` }), {
              status: response.status,
              headers: { "Content-Type": "application/json" },
            });
          }

          const data = await response.json();

          // 返回数据，添加 CORS 头
          return new Response(JSON.stringify(data), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (error) {
          console.error("Proxy error:", error);
          return new Response(JSON.stringify({ error: "Failed to fetch waiting rooms" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
    
    /**
     * 本地历史数据 API
     * 使用 bun:sqlite 存储，替代 Vercel KV
     */
    "/api/history": {
      async GET(req) {
        const url = new URL(req.url);
        const mode = url.searchParams.get('mode');
        const day = url.searchParams.get('day') || '';

        switch (mode) {
          case 'days':
            return handleGetDays();
          case 'events':
            return handleGetDayEvents(day);
          case 'details': {
            const eventId = url.searchParams.get('eventId');
            const sessionId = url.searchParams.get('sessionId');
            const memberIdsParam = url.searchParams.get('memberIds');
            const limit = url.searchParams.get('limit');
            return handleGetDayDetails(
              day,
              eventId ? parseInt(eventId) : undefined,
              sessionId ? parseInt(sessionId) : undefined,
              memberIdsParam ? memberIdsParam.split(',') : undefined,
              limit ? parseInt(limit) : 1000,
            );
          }
          default: {
            const eventId = url.searchParams.get('eventId');
            const sessionId = url.searchParams.get('sessionId');
            const memberIdsParam = url.searchParams.get('memberIds');
            const startTime = url.searchParams.get('startTime');
            const endTime = url.searchParams.get('endTime');
            const limit = url.searchParams.get('limit');
            return handleGetLegacy(
              eventId ? parseInt(eventId) : undefined,
              sessionId ? parseInt(sessionId) : undefined,
              memberIdsParam ? memberIdsParam.split(',') : undefined,
              startTime ? parseInt(startTime) : undefined,
              endTime ? parseInt(endTime) : undefined,
              limit ? parseInt(limit) : 1000,
            );
          }
        }
      },
      async POST(req) {
        const body = await req.json() as { records?: unknown[] };
        return handlePost(body.records as any[]);
      },
      async DELETE(req) {
        const body = await req.json() as { beforeTimestamp?: number; memberIds?: string[] };
        return handleDelete(body.beforeTimestamp, body.memberIds);
      },
    },

    /**
     * 默认路由 - 返回 index.html
     * 所有未匹配的路由都返回前端页面（支持 SPA 路由）
     */
    "/*": index,
  },
});

console.log(`🚀 Server running at ${server.url}`);