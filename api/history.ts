/**
 * api/history.ts - Vercel Serverless Function
 * 
 * 历史数据 API 端点，使用 Vercel KV 存储数据。
 * 
 * 支持的操作：
 * - GET: 获取历史记录（支持过滤）
 * - POST: 批量保存历史记录
 * - DELETE: 删除历史记录
 * 
 * 环境变量要求：
 * - KV_REST_API_URL: KV REST API 地址
 * - KV_REST_API_TOKEN: 访问令牌
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

// ========== 类型定义 ==========

/** 历史记录结构 */
interface HistoryRecord {
  id: string;
  memberId: string;
  memberName: string;
  memberAvatar?: string;
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  timestamp: number;
  waitingCount: number;
  waitingTime: number;
}

/** 查询过滤条件 */
interface HistoryFilter {
  eventId?: number;
  sessionId?: number;
  memberIds?: string[];
  startTime?: number;
  endTime?: number;
}

// ========== 工具函数 ==========

/**
 * 检查 KV 配置是否有效
 */
function isValidKvConfig(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// ========== 主处理函数 ==========

/**
 * API 入口函数
 * 根据请求方法分发到对应的处理函数
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// ========== GET: 获取历史记录 ==========

/**
 * 处理 GET 请求
 * 获取历史记录，支持多种过滤条件
 * 
 * 查询参数：
 * - eventId: 活动ID
 * - sessionId: 场次ID
 * - memberIds: 成员ID列表（逗号分隔）
 * - startTime: 开始时间戳
 * - endTime: 结束时间戳
 * - limit: 最大返回数量（默认 1000）
 */
async function handleGet(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { eventId, sessionId, memberIds, startTime, endTime, limit = '1000' } = req.query;

  try {
    // 获取所有历史记录的 key
    const keys = await kv.keys('history:*');
    const records: HistoryRecord[] = [];
    
    // 构建过滤条件
    const filter: HistoryFilter = {
      eventId: eventId ? parseInt(eventId as string) : undefined,
      sessionId: sessionId ? parseInt(sessionId as string) : undefined,
      memberIds: memberIds ? (Array.isArray(memberIds) ? memberIds as string[] : [memberIds as string]) : undefined,
      startTime: startTime ? parseInt(startTime as string) : undefined,
      endTime: endTime ? parseInt(endTime as string) : undefined,
    };

    const maxRecords = parseInt(limit as string);
    let count = 0;

    // 遍历所有记录，应用过滤条件
    for (const key of keys) {
      if (count >= maxRecords) break;

      const data = await kv.get<HistoryRecord>(key as string);
      if (data) {
        // 应用过滤条件
        if (filter.eventId && data.eventId !== filter.eventId) continue;
        if (filter.sessionId && data.sessionId !== filter.sessionId) continue;
        if (filter.memberIds && !filter.memberIds.includes(data.memberId)) continue;
        if (filter.startTime && data.timestamp < filter.startTime) continue;
        if (filter.endTime && data.timestamp > filter.endTime) continue;

        records.push(data);
        count++;
      }
    }

    // 按时间排序
    records.sort((a, b) => a.timestamp - b.timestamp);

    res.status(200).json({ records, count: records.length });
  } catch (error) {
    console.error('KV get error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

// ========== POST: 批量保存历史记录 ==========

/**
 * 处理 POST 请求
 * 批量保存历史记录
 * 
 * 请求体：
 * - records: 历史记录数组
 */
async function handlePost(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { records } = req.body;

  // 验证请求数据
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: 'Invalid records' });
    return;
  }

  try {
    const timestamp = Date.now();
    let success = 0;
    let failed = 0;

    // 批量保存记录
    for (const record of records) {
      // 生成唯一 ID
      const id = `${record.memberId}:${timestamp}`;
      const historyRecord: HistoryRecord = {
        id,
        memberId: record.memberId,
        memberName: record.memberName,
        memberAvatar: record.memberAvatar,
        eventId: record.eventId,
        eventName: record.eventName,
        sessionId: record.sessionId,
        sessionName: record.sessionName,
        timestamp,
        waitingCount: record.waitingCount,
        waitingTime: record.waitingTime,
      };

      // 保存到 KV
      const key = `history:${id}`;
      await kv.set(key, historyRecord);
      success++;
    }

    res.status(200).json({ success: true, saved: success, failed });
  } catch (error) {
    console.error('KV post error:', error);
    res.status(500).json({ error: 'Failed to save history' });
  }
}

// ========== DELETE: 删除历史记录 ==========

/**
 * 处理 DELETE 请求
 * 删除符合条件的历史记录
 * 
 * 请求体：
 * - beforeTimestamp: 删除此时间之前的记录
 * - memberIds: 删除指定成员的记录
 */
async function handleDelete(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { beforeTimestamp, memberIds } = req.body;

  try {
    // 获取所有历史记录的 key
    const keys = await kv.keys('history:*');
    let deleted = 0;

    // 遍历所有记录，检查是否需要删除
    for (const key of keys) {
      const data = await kv.get<HistoryRecord>(key as string);
      if (data) {
        let shouldDelete = false;

        // 检查删除条件
        if (beforeTimestamp && data.timestamp < beforeTimestamp) {
          shouldDelete = true;
        }
        if (memberIds && memberIds.includes(data.memberId)) {
          shouldDelete = true;
        }

        if (shouldDelete) {
          await kv.del(key as string);
          deleted++;
        }
      }
    }

    res.status(200).json({ success: true, deleted });
  } catch (error) {
    console.error('KV delete error:', error);
    res.status(500).json({ error: 'Failed to delete history' });
  }
}