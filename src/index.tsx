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
     * 默认路由 - 返回 index.html
     * 所有未匹配的路由都返回前端页面（支持 SPA 路由）
     */
    "/*": index,
  },
});

console.log(`🚀 Server running at ${server.url}`);