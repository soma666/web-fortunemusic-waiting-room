/**
 * api/history.ts - Vercel Serverless Function
 *
 * 历史数据 API 端点，使用 Upstash Redis 存储数据。
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
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/** Upstash Redis 客户端（惰性初始化） */
let _kv: Redis | null = null;
function getKv(): Redis {
  if (!_kv) {
    _kv = Redis.fromEnv();
  }
  return _kv;
}

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
  day: string; // yyyy-MM-dd (JST)
  events: DayEventEntry[];
}

/** 日级索引中的活动条目 */
interface DayEventEntry {
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  recordCount: number;
  memberCount: number;
  lastUpdated: number;
}

// ========== JST 日期工具函数 ==========

function timestampToJSTDay(timestamp: number): string {
  const jstTime = new Date(timestamp + JST_OFFSET_MS);
  const y = jstTime.getUTCFullYear();
  const m = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function jstDayToStartTimestamp(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return utcMs - JST_OFFSET_MS;
}

function jstDayToEndTimestamp(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return utcMs - JST_OFFSET_MS;
}

function dayIndexKey(day: string): string {
  return `history:day:${day}`;
}

// ========== 工具函数 ==========

function isValidKvConfig(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

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

/** mode=days: 返回有数据的日期列表 */
async function handleGetDays(_req: VercelRequest, res: VercelResponse) {
  const keys = await getKv().keys('history:day:*');
  if (keys.length === 0) {
    res.status(200).json({ days: [] });
    return;
  }

  const days: Array<{ day: string; eventCount: number; sessionCount: number; totalRecords: number }> = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE) as string[];
    const values = await getKv().mget<DayIndex[]>(...batch);
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

  days.sort((a, b) => b.day.localeCompare(a.day));
  res.status(200).json({ days });
}

/** mode=events: 返回某日内的活动/场次摘要 */
async function handleGetDayEvents(req: VercelRequest, res: VercelResponse) {
  const { day } = req.query;
  if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    res.status(400).json({ error: 'day parameter required (yyyy-MM-dd)' });
    return;
  }

  const index = await getKv().get<DayIndex>(dayIndexKey(day));
  if (!index) {
    res.status(200).json({ day, events: [] });
    return;
  }

  res.status(200).json({
    day: index.day,
    events: index.events,
  });
}

/** mode=details: 返回某日某活动的详细时间序列 */
async function handleGetDayDetails(req: VercelRequest, res: VercelResponse) {
  const { day, eventId, sessionId, memberIds, limit = '1000' } = req.query;

  if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    res.status(400).json({ error: 'day parameter required (yyyy-MM-dd)' });
    return;
  }

  const startTime = jstDayToStartTimestamp(day);
  const endTime = jstDayToEndTimestamp(day);
  const maxRecords = Math.min(parseInt(limit as string) || 1000, 5000);

  const keys = await getKv().keys('history:*');
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

  const allRecords: HistoryRecord[] = [];
  for (let i = 0; i < recordKeys.length; i += BATCH_SIZE) {
    const batch = recordKeys.slice(i, i + BATCH_SIZE) as string[];
    const values = await getKv().mget<HistoryRecord[]>(...batch);
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

/** 兼容旧版平面查询 */
async function handleGetLegacy(req: VercelRequest, res: VercelResponse) {
  const { eventId, sessionId, memberIds, startTime, endTime, limit = '1000' } = req.query;

  try {
    const keys = await getKv().keys('history:*');
    const recordKeys = (keys as string[]).filter(k => !k.startsWith('history:day:'));

    if (recordKeys.length === 0) {
      res.status(200).json({ records: [], count: 0 });
      return;
    }

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

    const allRecords: HistoryRecord[] = [];
    for (let i = 0; i < recordKeys.length; i += BATCH_SIZE) {
      const batch = recordKeys.slice(i, i + BATCH_SIZE) as string[];
      const values = await getKv().mget<HistoryRecord[]>(...batch);
      for (const data of values) {
        if (!data) continue;
        allRecords.push(data);
      }
    }

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

async function handlePost(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: 'Invalid records: must be a non-empty array' });
    return;
  }

  if (records.length > MAX_RECORDS_PER_REQUEST) {
    res.status(400).json({ error: `Too many records: max ${MAX_RECORDS_PER_REQUEST}` });
    return;
  }

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

    const pipeline = getKv().pipeline();
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

    await updateDayIndex(day, records, memberIdsInBatch.size, timestamp);

    res.status(200).json({ success: true, saved: records.length, failed: 0 });
  } catch (error) {
    console.error('KV post error:', error);
    res.status(500).json({ error: 'Failed to save history' });
  }
}

// ========== 日级索引维护 ==========

async function updateDayIndex(
  day: string,
  records: any[],
  memberCount: number,
  timestamp: number,
): Promise<void> {
  try {
    const key = dayIndexKey(day);
    const existing = await getKv().get<DayIndex>(key);

    const batchEntries = new Map<string, DayEventEntry>();
    for (const record of records) {
      const entryKey = `${record.eventId}:${record.sessionId}`;
      const prev = batchEntries.get(entryKey);
      if (prev) {
        prev.recordCount += 1;
        prev.lastUpdated = timestamp;
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
      for (const [entryKey, newEntry] of batchEntries) {
        const idx = dayIndex.events.findIndex(
          (e) => `${e.eventId}:${e.sessionId}` === entryKey
        );
        if (idx >= 0) {
          dayIndex.events[idx].recordCount += newEntry.recordCount;
          dayIndex.events[idx].memberCount = Math.max(dayIndex.events[idx].memberCount, newEntry.memberCount);
          dayIndex.events[idx].lastUpdated = timestamp;
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

    await getKv().set(key, dayIndex, { ex: DEFAULT_TTL_SECONDS });
  } catch (error) {
    console.error('Failed to update day index:', error);
  }
}

// ========== DELETE: 删除历史记录 ==========

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
    const keys = await getKv().keys('history:*');
    const recordKeys = (keys as string[]).filter(k => !k.startsWith('history:day:'));
    const dayKeys = (keys as string[]).filter(k => k.startsWith('history:day:'));

    if (recordKeys.length === 0) {
      res.status(200).json({ success: true, deleted: 0 });
      return;
    }

    const keysToDelete: string[] = [];
    for (let i = 0; i < recordKeys.length; i += BATCH_SIZE) {
      const batch = recordKeys.slice(i, i + BATCH_SIZE) as string[];
      const values = await getKv().mget<HistoryRecord[]>(...batch);
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

    if (keysToDelete.length > 0) {
      const pipeline = getKv().pipeline();
      for (const key of keysToDelete) {
        pipeline.del(key);
      }
      await pipeline.exec();
    }

    if (beforeTimestamp && dayKeys.length > 0) {
      const cutoffDay = timestampToJSTDay(beforeTimestamp);
      const dayKeysToDelete = dayKeys.filter(k => {
        const day = k.replace('history:day:', '');
        return day < cutoffDay;
      });
      if (dayKeysToDelete.length > 0) {
        const pipeline = getKv().pipeline();
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
