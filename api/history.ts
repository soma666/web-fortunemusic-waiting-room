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

// ========== 常量定义 ==========

/** 每条记录的默认 TTL（秒）：30 天 */
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** 批量操作每批的大小 */
const BATCH_SIZE = 100;

/** 单次最多接受的记录数 */
const MAX_RECORDS_PER_REQUEST = 200;

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

/**
 * 验证单条记录的必填字段和类型
 */
function validateRecord(record: any): string | null {
  if (!record || typeof record !== 'object') return 'Record must be an object';
  if (typeof record.memberId !== 'string' || record.memberId.length === 0) return 'memberId is required';
  if (typeof record.memberName !== 'string' || record.memberName.length === 0) return 'memberName is required';
  if (typeof record.eventId !== 'number' || !Number.isFinite(record.eventId)) return 'eventId must be a number';
  if (typeof record.eventName !== 'string') return 'eventName is required';
  if (typeof record.sessionId !== 'number' || !Number.isFinite(record.sessionId)) return 'sessionId must be a number';
  if (typeof record.sessionName !== 'string') return 'sessionName is required';
  if (typeof record.waitingCount !== 'number' || record.waitingCount < 0) return 'waitingCount must be >= 0';
  if (typeof record.waitingTime !== 'number' || record.waitingTime < 0) return 'waitingTime must be >= 0';
  return null;
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
 * 使用 kv.mget() 批量获取替代逐条查询
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
    if (keys.length === 0) {
      res.status(200).json({ records: [], count: 0 });
      return;
    }

    // 构建过滤条件
    const filter: HistoryFilter = {
      eventId: eventId ? parseInt(eventId as string) : undefined,
      sessionId: sessionId ? parseInt(sessionId as string) : undefined,
      memberIds: memberIds
        ? (Array.isArray(memberIds) ? memberIds as string[] : (memberIds as string).split(','))
        : undefined,
      startTime: startTime ? parseInt(startTime as string) : undefined,
      endTime: endTime ? parseInt(endTime as string) : undefined,
    };

    const maxRecords = Math.min(parseInt(limit as string) || 1000, 5000);

    // 批量获取所有记录（使用 mget 替代逐条 get）
    const allRecords: HistoryRecord[] = [];
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE) as string[];
      const values = await kv.mget<HistoryRecord[]>(...batch);
      for (const data of values) {
        if (!data) continue;
        allRecords.push(data);
      }
    }

    // 应用过滤条件
    const records = allRecords
      .filter((data) => {
        if (filter.eventId && data.eventId !== filter.eventId) return false;
        if (filter.sessionId && data.sessionId !== filter.sessionId) return false;
        if (filter.memberIds && !filter.memberIds.includes(data.memberId)) return false;
        if (filter.startTime && data.timestamp < filter.startTime) return false;
        if (filter.endTime && data.timestamp > filter.endTime) return false;
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, maxRecords);

    res.status(200).json({ records, count: records.length });
  } catch (error) {
    console.error('KV get error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

// ========== POST: 批量保存历史记录 ==========

/**
 * 处理 POST 请求
 * 批量保存历史记录，使用 pipeline 批量写入
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
    res.status(400).json({ error: 'Invalid records: must be a non-empty array' });
    return;
  }

  if (records.length > MAX_RECORDS_PER_REQUEST) {
    res.status(400).json({ error: `Too many records: max ${MAX_RECORDS_PER_REQUEST}` });
    return;
  }

  // 验证每条记录的字段
  for (let i = 0; i < records.length; i++) {
    const validationError = validateRecord(records[i]);
    if (validationError) {
      res.status(400).json({ error: `Record[${i}]: ${validationError}` });
      return;
    }
  }

  try {
    const timestamp = Date.now();

    // 使用 pipeline 批量写入，减少网络往返
    const pipeline = kv.pipeline();
    for (const record of records) {
      const id = `${record.memberId}:${timestamp}`;
      const key = `history:${id}`;
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
      pipeline.set(key, historyRecord, { ex: DEFAULT_TTL_SECONDS });
    }
    await pipeline.exec();

    res.status(200).json({ success: true, saved: records.length, failed: 0 });
  } catch (error) {
    console.error('KV post error:', error);
    res.status(500).json({ error: 'Failed to save history' });
  }
}

// ========== DELETE: 删除历史记录 ==========

/**
 * 处理 DELETE 请求
 * 删除符合条件的历史记录
 * 使用 mget 批量读取 + pipeline 批量删除
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

  if (!beforeTimestamp && !memberIds) {
    res.status(400).json({ error: 'Must provide beforeTimestamp or memberIds' });
    return;
  }

  try {
    const keys = await kv.keys('history:*');
    if (keys.length === 0) {
      res.status(200).json({ success: true, deleted: 0 });
      return;
    }

    // 批量读取所有记录
    const keysToDelete: string[] = [];
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE) as string[];
      const values = await kv.mget<HistoryRecord[]>(...batch);
      for (let j = 0; j < values.length; j++) {
        const data = values[j];
        if (!data) continue;

        let shouldDelete = false;
        if (beforeTimestamp && data.timestamp < beforeTimestamp) {
          shouldDelete = true;
        }
        if (memberIds && Array.isArray(memberIds) && memberIds.includes(data.memberId)) {
          shouldDelete = true;
        }

        if (shouldDelete) {
          keysToDelete.push(batch[j]);
        }
      }
    }

    // 批量删除
    if (keysToDelete.length > 0) {
      const pipeline = kv.pipeline();
      for (const key of keysToDelete) {
        pipeline.del(key);
      }
      await pipeline.exec();
    }

    res.status(200).json({ success: true, deleted: keysToDelete.length });
  } catch (error) {
    console.error('KV delete error:', error);
    res.status(500).json({ error: 'Failed to delete history' });
  }
}