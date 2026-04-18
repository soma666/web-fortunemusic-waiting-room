/**
 * api/history.ts - Vercel Serverless Function
 * 
 * 历史数据 API 端点，使用 Vercel KV 存储数据。
 * 
 * 支持的操作：
 * - GET: 获取历史记录（支持过滤和浏览模式）
 *   - mode=days: 返回有数据的日期列表
 *   - mode=events: 返回某日内的活动/场次摘要
 *   - mode=details: 返回某日某活动的详细时间序列
 *   - (默认): 兼容旧版平面过滤查询
 * - POST: 批量保存历史记录（同时维护日级索引）
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

/** JST 偏移量（毫秒）：UTC+9 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
  avgWaitTime: number;
}

/** 查询过滤条件 */
interface HistoryFilter {
  eventId?: number;
  sessionId?: number;
  memberIds?: string[];
  startTime?: number;
  endTime?: number;
}

/** 日级索引：存储某天有哪些 eventId+sessionId 组合 */
interface DayIndex {
  day: string;                    // yyyy-MM-dd (JST)
  events: DayEventEntry[];
}

/** 日级索引中的活动条目 */
interface DayEventEntry {
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  recordCount: number;            // 该活动当天的记录数
  memberCount: number;            // 该活动当天的成员数
  lastUpdated: number;            // 最后更新时间戳
}

// ========== JST 日期工具函数 ==========

/**
 * 将 UTC 毫秒时间戳转换为 JST 日期字符串 (yyyy-MM-dd)
 */
function timestampToJSTDay(timestamp: number): string {
  const jstTime = new Date(timestamp + JST_OFFSET_MS);
  const y = jstTime.getUTCFullYear();
  const m = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 将 JST 日期字符串 (yyyy-MM-dd) 转换为该天 00:00:00 JST 的 UTC 时间戳
 */
function jstDayToStartTimestamp(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return utcMs - JST_OFFSET_MS;
}

/**
 * 将 JST 日期字符串 (yyyy-MM-dd) 转换为该天 23:59:59.999 JST 的 UTC 时间戳
 */
function jstDayToEndTimestamp(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return utcMs - JST_OFFSET_MS;
}

/**
 * 获取日级索引的 KV 键名
 */
function dayIndexKey(day: string): string {
  return `history:day:${day}`;
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
 * 根据 mode 参数分发到不同的查询模式
 * 
 * 查询参数：
 * - mode: 查询模式 (days | events | details | 默认兼容模式)
 * - day: 日期字符串 (yyyy-MM-dd, JST)，用于 events/details 模式
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

  const { mode } = req.query;

  try {
    switch (mode) {
      case 'days':
        return handleGetDays(req, res);
      case 'events':
        return handleGetDayEvents(req, res);
      case 'details':
        return handleGetDayDetails(req, res);
      default:
        return handleGetLegacy(req, res);
    }
  } catch (error) {
    console.error('KV get error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

/**
 * mode=days: 返回有数据的日期列表
 * 读取所有 history:day:* 索引键
 */
async function handleGetDays(_req: VercelRequest, res: VercelResponse) {
  const keys = await kv.keys('history:day:*');
  if (keys.length === 0) {
    res.status(200).json({ days: [] });
    return;
  }

  // 批量读取日级索引
  const days: Array<{ day: string; eventCount: number; sessionCount: number; totalRecords: number }> = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE) as string[];
    const values = await kv.mget<DayIndex[]>(...batch);
    for (const index of values) {
      if (!index) continue;
      const eventIds = new Set(index.events.map(e => e.eventId));
      const sessionIds = new Set(index.events.map(e => e.sessionId));
      const totalRecords = index.events.reduce((sum, e) => sum + e.recordCount, 0);
      days.push({
        day: index.day,
        eventCount: eventIds.size,
        sessionCount: sessionIds.size,
        totalRecords,
      });
    }
  }

  // 按日期降序排列（最近的在前）
  days.sort((a, b) => b.day.localeCompare(a.day));
  res.status(200).json({ days });
}

/**
 * mode=events: 返回某日内的活动/场次摘要
 * 必须提供 day 参数
 */
async function handleGetDayEvents(req: VercelRequest, res: VercelResponse) {
  const { day } = req.query;
  if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    res.status(400).json({ error: 'day parameter required (yyyy-MM-dd)' });
    return;
  }

  const index = await kv.get<DayIndex>(dayIndexKey(day));
  if (!index) {
    res.status(200).json({ day, events: [] });
    return;
  }

  // 按 eventId 分组，保留场次细节
  res.status(200).json({
    day: index.day,
    events: index.events,
  });
}

/**
 * mode=details: 返回某日某活动的详细时间序列
 * 必须提供 day 参数，可选 eventId/sessionId/memberIds 过滤
 */
async function handleGetDayDetails(req: VercelRequest, res: VercelResponse) {
  const { day, eventId, sessionId, memberIds, limit = '1000' } = req.query;

  if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    res.status(400).json({ error: 'day parameter required (yyyy-MM-dd)' });
    return;
  }

  const startTime = jstDayToStartTimestamp(day);
  const endTime = jstDayToEndTimestamp(day);
  const maxRecords = Math.min(parseInt(limit as string) || 1000, 5000);

  // 获取所有历史记录的 key
  const keys = await kv.keys('history:*');
  // 排除日级索引键
  const recordKeys = (keys as string[]).filter(k => !k.startsWith('history:day:'));

  if (recordKeys.length === 0) {
    res.status(200).json({ day, records: [], count: 0 });
    return;
  }

  const filter: HistoryFilter = {
    eventId: eventId ? parseInt(eventId as string) : undefined,
    sessionId: sessionId ? parseInt(sessionId as string) : undefined,
    memberIds: memberIds
      ? (Array.isArray(memberIds) ? memberIds as string[] : (memberIds as string).split(','))
      : undefined,
    startTime,
    endTime,
  };

  // 批量获取并过滤
  const allRecords: HistoryRecord[] = [];
  for (let i = 0; i < recordKeys.length; i += BATCH_SIZE) {
    const batch = recordKeys.slice(i, i + BATCH_SIZE) as string[];
    const values = await kv.mget<HistoryRecord[]>(...batch);
    for (const data of values) {
      if (!data) continue;
      if (data.timestamp < filter.startTime! || data.timestamp > filter.endTime!) continue;
      if (filter.eventId && data.eventId !== filter.eventId) continue;
      if (filter.sessionId && data.sessionId !== filter.sessionId) continue;
      if (filter.memberIds && !filter.memberIds.includes(data.memberId)) continue;
      allRecords.push(data);
    }
  }

  const records = allRecords
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, maxRecords);

  res.status(200).json({ day, records, count: records.length });
}

/**
 * 兼容旧版平面查询
 * 保持原有行为不变
 */
async function handleGetLegacy(req: VercelRequest, res: VercelResponse) {
  const { eventId, sessionId, memberIds, startTime, endTime, limit = '1000' } = req.query;

  try {
    // 获取所有历史记录的 key
    const keys = await kv.keys('history:*');
    // 排除日级索引键
    const recordKeys = (keys as string[]).filter(k => !k.startsWith('history:day:'));

    if (recordKeys.length === 0) {
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
    for (let i = 0; i < recordKeys.length; i += BATCH_SIZE) {
      const batch = recordKeys.slice(i, i + BATCH_SIZE) as string[];
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
    const day = timestampToJSTDay(timestamp);

    // 使用 pipeline 批量写入，减少网络往返
    const pipeline = kv.pipeline();
    const memberIdsInBatch = new Set<string>();

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
        avgWaitTime: record.avgWaitTime ?? (record.waitingCount > 0 ? Math.floor(record.waitingTime / record.waitingCount) : 0),
      };
      pipeline.set(key, historyRecord, { ex: DEFAULT_TTL_SECONDS });
      memberIdsInBatch.add(record.memberId);
    }
    await pipeline.exec();

    // 更新日级索引
    await updateDayIndex(day, records, memberIdsInBatch.size, timestamp);

    res.status(200).json({ success: true, saved: records.length, failed: 0 });
  } catch (error) {
    console.error('KV post error:', error);
    res.status(500).json({ error: 'Failed to save history' });
  }
}

// ========== 日级索引维护 ==========

/**
 * 更新日级索引
 * 在写入记录后，更新该天的活动/场次摘要索引
 */
async function updateDayIndex(
  day: string,
  records: any[],
  memberCount: number,
  timestamp: number,
): Promise<void> {
  try {
    const key = dayIndexKey(day);
    const existing = await kv.get<DayIndex>(key);

    // 按 eventId+sessionId 聚合本批次
    const batchEntries = new Map<string, DayEventEntry>();
    for (const record of records) {
      const entryKey = `${record.eventId}:${record.sessionId}`;
      const existing = batchEntries.get(entryKey);
      if (existing) {
        existing.recordCount += 1;
        existing.lastUpdated = timestamp;
      } else {
        batchEntries.set(entryKey, {
          eventId: record.eventId,
          eventName: record.eventName,
          sessionId: record.sessionId,
          sessionName: record.sessionName,
          recordCount: 1,
          memberCount,
          lastUpdated: timestamp,
        });
      }
    }

    let dayIndex: DayIndex;
    if (existing) {
      dayIndex = existing;
      // 合并：更新已有条目或新增
      for (const [entryKey, newEntry] of batchEntries) {
        const idx = dayIndex.events.findIndex(
          (e) => `${e.eventId}:${e.sessionId}` === entryKey
        );
        if (idx >= 0) {
          dayIndex.events[idx].recordCount += newEntry.recordCount;
          dayIndex.events[idx].memberCount = Math.max(dayIndex.events[idx].memberCount, newEntry.memberCount);
          dayIndex.events[idx].lastUpdated = timestamp;
          // 更新名称（以最新为准）
          dayIndex.events[idx].eventName = newEntry.eventName;
          dayIndex.events[idx].sessionName = newEntry.sessionName;
        } else {
          dayIndex.events.push(newEntry);
        }
      }
    } else {
      dayIndex = {
        day,
        events: Array.from(batchEntries.values()),
      };
    }

    await kv.set(key, dayIndex, { ex: DEFAULT_TTL_SECONDS });
  } catch (error) {
    // 索引更新失败不应阻塞主流程
    console.error('Failed to update day index:', error);
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
    // 分离记录键和日级索引键
    const recordKeys = (keys as string[]).filter(k => !k.startsWith('history:day:'));
    const dayKeys = (keys as string[]).filter(k => k.startsWith('history:day:'));

    if (recordKeys.length === 0) {
      res.status(200).json({ success: true, deleted: 0 });
      return;
    }

    // 批量读取所有记录
    const keysToDelete: string[] = [];
    for (let i = 0; i < recordKeys.length; i += BATCH_SIZE) {
      const batch = recordKeys.slice(i, i + BATCH_SIZE) as string[];
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

    // 批量删除记录
    if (keysToDelete.length > 0) {
      const pipeline = kv.pipeline();
      for (const key of keysToDelete) {
        pipeline.del(key);
      }
      await pipeline.exec();
    }

    // 清理过期的日级索引（beforeTimestamp 模式下）
    if (beforeTimestamp && dayKeys.length > 0) {
      const cutoffDay = timestampToJSTDay(beforeTimestamp);
      const dayKeysToDelete = dayKeys.filter(k => {
        const day = k.replace('history:day:', '');
        return day < cutoffDay;
      });
      if (dayKeysToDelete.length > 0) {
        const pipeline = kv.pipeline();
        for (const key of dayKeysToDelete) {
          pipeline.del(key);
        }
        await pipeline.exec();
      }
    }

    res.status(200).json({ success: true, deleted: keysToDelete.length });
  } catch (error) {
    console.error('KV delete error:', error);
    res.status(500).json({ error: 'Failed to delete history' });
  }
}