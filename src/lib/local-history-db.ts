/**
 * local-history-db.ts - 本地 SQLite 历史数据存储
 * 
 * 仅用于本地开发（bun --hot 模式），替代 Vercel KV。
 * 使用 bun:sqlite 内置模块。
 */

import { Database } from "bun:sqlite";

/** JST 偏移量（毫秒）：UTC+9 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** TTL: 30 天（毫秒） */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 数据库文件路径 */
const DB_PATH = ".local-history.sqlite";

// ========== 类型 ==========

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

interface DayEventEntry {
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  recordCount: number;
  memberCount: number;
  lastUpdated: number;
}

type HistoryWriteRecord = Omit<HistoryRecord, 'id' | 'timestamp'>;

// ========== 数据库初始化 ==========

let db: Database;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH, { create: true });
    db.run("PRAGMA journal_mode=WAL");
    db.run(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        memberId TEXT NOT NULL,
        memberName TEXT NOT NULL,
        memberAvatar TEXT,
        eventId INTEGER NOT NULL,
        eventName TEXT NOT NULL,
        sessionId INTEGER NOT NULL,
        sessionName TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        waitingCount INTEGER NOT NULL,
        waitingTime INTEGER NOT NULL,
        avgWaitTime INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp)
    `);
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_history_event ON history(eventId, sessionId)
    `);
  }
  return db;
}

// ========== JST 工具 ==========

function timestampToJSTDay(timestamp: number): string {
  const jstTime = new Date(timestamp + JST_OFFSET_MS);
  const y = jstTime.getUTCFullYear();
  const m = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseJstDay(day: string): [number, number, number] {
  const [year = NaN, month = NaN, date = NaN] = day.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) {
    throw new Error(`Invalid JST day: ${day}`);
  }
  return [year, month, date];
}

function jstDayToStartTimestamp(day: string): number {
  const [y, m, d] = parseJstDay(day);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - JST_OFFSET_MS;
}

function jstDayToEndTimestamp(day: string): number {
  const [y, m, d] = parseJstDay(day);
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - JST_OFFSET_MS;
}

// ========== 清理过期记录 ==========

function cleanExpired() {
  const cutoff = Date.now() - TTL_MS;
  getDb().run("DELETE FROM history WHERE timestamp < ?", [cutoff]);
}

function resolveSnapshotTimestamp(snapshotTimestamp: unknown): number {
  if (typeof snapshotTimestamp !== 'number' || !Number.isFinite(snapshotTimestamp)) {
    return Date.now();
  }

  const value = Math.floor(snapshotTimestamp);
  return value > 0 ? value : Date.now();
}

// ========== GET 处理 ==========

export function handleGetDays(): Response {
  cleanExpired();
  const database = getDb();

  // 获取所有不同的日期（基于 JST）
  const rows = database.query<{ timestamp: number }, []>(
    "SELECT DISTINCT timestamp FROM history ORDER BY timestamp DESC"
  ).all();

  // 按 JST 天分组
  const dayMap = new Map<string, { eventIds: Set<number>; sessionIds: Set<number>; count: number }>();
  for (const row of rows) {
    const day = timestampToJSTDay(row.timestamp);
    let entry = dayMap.get(day);
    if (!entry) {
      entry = { eventIds: new Set(), sessionIds: new Set(), count: 0 };
      dayMap.set(day, entry);
    }
  }

  // 获取每天的统计
  for (const [day, entry] of dayMap) {
    const start = jstDayToStartTimestamp(day);
    const end = jstDayToEndTimestamp(day);
    const stats = database.query<{ eventId: number; sessionId: number; cnt: number }, [number, number]>(
      "SELECT eventId, sessionId, COUNT(*) as cnt FROM history WHERE timestamp >= ? AND timestamp <= ? GROUP BY eventId, sessionId"
    ).all(start, end);
    for (const s of stats) {
      entry.eventIds.add(s.eventId);
      entry.sessionIds.add(s.sessionId);
      entry.count += s.cnt;
    }
  }

  const days = Array.from(dayMap.entries())
    .map(([day, entry]) => ({
      day,
      eventCount: entry.eventIds.size,
      sessionCount: entry.sessionIds.size,
      totalRecords: entry.count,
    }))
    .sort((a, b) => b.day.localeCompare(a.day));

  return Response.json({ days });
}

export function handleGetDayEvents(day: string): Response {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: 'day parameter required (yyyy-MM-dd)' }, { status: 400 });
  }

  const database = getDb();
  const start = jstDayToStartTimestamp(day);
  const end = jstDayToEndTimestamp(day);

  const rows = database.query<
    { eventId: number; eventName: string; sessionId: number; sessionName: string; cnt: number; memberCnt: number; lastTs: number },
    [number, number]
  >(
    `SELECT eventId, eventName, sessionId, sessionName, 
            COUNT(*) as cnt, 
            COUNT(DISTINCT memberId) as memberCnt, 
            MAX(timestamp) as lastTs 
     FROM history 
     WHERE timestamp >= ? AND timestamp <= ? 
     GROUP BY eventId, sessionId`
  ).all(start, end);

  const events: DayEventEntry[] = rows.map(r => ({
    eventId: r.eventId,
    eventName: r.eventName,
    sessionId: r.sessionId,
    sessionName: r.sessionName,
    recordCount: r.cnt,
    memberCount: r.memberCnt,
    lastUpdated: r.lastTs,
  }));

  return Response.json({ day, events });
}

export function handleGetDayDetails(
  day: string,
  eventId?: number,
  sessionId?: number,
  memberIds?: string[],
  limit = 1000,
): Response {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: 'day parameter required (yyyy-MM-dd)' }, { status: 400 });
  }

  const database = getDb();
  const start = jstDayToStartTimestamp(day);
  const end = jstDayToEndTimestamp(day);
  const maxRecords = Math.min(limit, 5000);

  let sql = `SELECT * FROM history WHERE timestamp >= ? AND timestamp <= ?`;
  const params: any[] = [start, end];

  if (eventId !== undefined) {
    sql += ` AND eventId = ?`;
    params.push(eventId);
  }
  if (sessionId !== undefined) {
    sql += ` AND sessionId = ?`;
    params.push(sessionId);
  }
  if (memberIds && memberIds.length > 0) {
    sql += ` AND memberId IN (${memberIds.map(() => '?').join(',')})`;
    params.push(...memberIds);
  }

  sql += ` ORDER BY timestamp ASC LIMIT ?`;
  params.push(maxRecords);

  const records = database.query(sql).all(...params) as HistoryRecord[];
  return Response.json({ day, records, count: records.length });
}

export function handleGetLegacy(
  eventId?: number,
  sessionId?: number,
  memberIds?: string[],
  startTime?: number,
  endTime?: number,
  limit = 1000,
): Response {
  const database = getDb();
  const maxRecords = Math.min(limit, 5000);

  let sql = `SELECT * FROM history WHERE 1=1`;
  const params: any[] = [];

  if (eventId !== undefined) {
    sql += ` AND eventId = ?`;
    params.push(eventId);
  }
  if (sessionId !== undefined) {
    sql += ` AND sessionId = ?`;
    params.push(sessionId);
  }
  if (memberIds && memberIds.length > 0) {
    sql += ` AND memberId IN (${memberIds.map(() => '?').join(',')})`;
    params.push(...memberIds);
  }
  if (startTime !== undefined) {
    sql += ` AND timestamp >= ?`;
    params.push(startTime);
  }
  if (endTime !== undefined) {
    sql += ` AND timestamp <= ?`;
    params.push(endTime);
  }

  sql += ` ORDER BY timestamp ASC LIMIT ?`;
  params.push(maxRecords);

  const records = database.query(sql).all(...params) as HistoryRecord[];
  return Response.json({ records, count: records.length });
}

// ========== POST 处理 ==========

export function handlePost(records: HistoryWriteRecord[], _eventDay?: string, snapshotTimestamp?: number): Response {
  if (!Array.isArray(records) || records.length === 0) {
    return Response.json({ error: 'Invalid records: must be a non-empty array' }, { status: 400 });
  }

  if (records.length > 200) {
    return Response.json({ error: 'Too many records: max 200' }, { status: 400 });
  }

  const database = getDb();
  const timestamp = resolveSnapshotTimestamp(snapshotTimestamp);

  const insert = database.prepare(`
    INSERT OR REPLACE INTO history (id, memberId, memberName, memberAvatar, eventId, eventName, sessionId, sessionName, timestamp, waitingCount, waitingTime, avgWaitTime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((recs: HistoryWriteRecord[]) => {
    for (const record of recs) {
      const id = `${record.eventId}:${record.sessionId}:${record.memberId}:${timestamp}`;
      const avgWaitTime = record.avgWaitTime ?? (record.waitingCount > 0 ? Math.floor(record.waitingTime / record.waitingCount) : 0);
      insert.run(
        id,
        record.memberId,
        record.memberName,
        record.memberAvatar || null,
        record.eventId,
        record.eventName,
        record.sessionId,
        record.sessionName,
        timestamp,
        record.waitingCount,
        record.waitingTime,
        avgWaitTime,
      );
    }
  });

  insertMany(records);

  return Response.json({ success: true, saved: records.length, failed: 0 });
}

// ========== DELETE 处理 ==========

export function handleDelete(beforeTimestamp?: number, memberIds?: string[]): Response {
  const database = getDb();

  let sql = `DELETE FROM history WHERE 1=1`;
  const params: any[] = [];

  if (beforeTimestamp !== undefined) {
    sql += ` AND timestamp < ?`;
    params.push(beforeTimestamp);
  }
  if (memberIds && memberIds.length > 0) {
    sql += ` AND memberId IN (${memberIds.map(() => '?').join(',')})`;
    params.push(...memberIds);
  }

  // 如果没有任何过滤条件，不执行全量删除（安全保护）
  if (!beforeTimestamp && (!memberIds || memberIds.length === 0)) {
    return Response.json({ success: true, deleted: 0 });
  }

  const result = database.run(sql, params);
  return Response.json({ success: true, deleted: result.changes });
}
