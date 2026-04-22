/**
 * api/history.ts - Vercel Serverless Function
 *
 * History data API endpoint using Upstash Redis Sorted Sets.
 *
 * Data structure:
 * - history:ts:{day}:{eventId}:{sessionId} -> Sorted Set (score=timestamp, member=JSON record)
 * - history:day:{day} -> JSON day index (event/session summary)
 *
 * Supported operations:
 * - GET mode=days: Return list of dates with data
 * - GET mode=events: Return event/session summary for a given day
 * - GET mode=details: Return detailed time series for a day/event
 * - GET (default): Legacy flat query
 * - POST: Batch save history records
 * - DELETE: Delete history records
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

let _kv: Redis | null = null;
function getKv(): Redis {
  if (!_kv) {
    _kv = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    });
  }
  return _kv;
}

// ========== Constants ==========

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_RECORDS_PER_REQUEST = 200;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HISTORY_DAYS_INDEX_KEY = 'history:idx:days';
const MAX_CLIENT_SNAPSHOT_SKEW_MS = 2 * 60 * 1000;
const COLLECTOR_LOGS_KEY = 'history:collector:logs';
const COLLECTOR_SNAPSHOTS_KEY = 'history:collector:snapshots';
const COLLECTOR_STATUS_KEY = 'history:collector:status';
const COLLECTOR_LAST_SUCCESS_KEY = 'history:collector:last-success';

// ========== Types ==========

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

interface DayIndex {
  day: string;
  events: DayEventEntry[];
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

// ========== JST Utilities ==========

function timestampToJSTDay(timestamp: number): string {
  const jstTime = new Date(timestamp + JST_OFFSET_MS);
  const y = jstTime.getUTCFullYear();
  const m = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayIndexKey(day: string): string {
  return `history:day:${day}`;
}

function daySessionsIndexKey(day: string): string {
  return `history:idx:day:${day}`;
}

/** Sorted Set key: history:ts:{day}:{eventId}:{sessionId} */
function tsKey(day: string, eventId: number, sessionId: number): string {
  return `history:ts:${day}:${eventId}:${sessionId}`;
}

// ========== Helpers ==========

function isValidKvConfig(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
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

/** Parse ZRANGE member into HistoryRecord (handles both auto-deserialized objects and raw strings) */
function parseMember(m: unknown): HistoryRecord {
  if (typeof m === 'string') return JSON.parse(m);
  return m as HistoryRecord;
}

function parseStringArray(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is string => typeof item === 'string');
}

function sumPipelineNumbers(values: unknown[]): number {
  return values.reduce<number>(
    (sum, value) => sum + (typeof value === 'number' ? value : Number(value) || 0),
    0,
  );
}

async function getIndexedDays(): Promise<string[]> {
  const indexedDays = parseStringArray(await getKv().smembers(HISTORY_DAYS_INDEX_KEY));
  if (indexedDays.length > 0) {
    return indexedDays.sort();
  }

  const discoveredKeys = parseStringArray(await getKv().keys('history:ts:*'));
  if (discoveredKeys.length === 0) {
    return [];
  }

  const days = new Set<string>();
  const pipeline = getKv().pipeline();
  for (const key of discoveredKeys) {
    const day = key.split(':')[2] ?? '';
    if (!day) continue;
    days.add(day);
    pipeline.sadd(daySessionsIndexKey(day), key);
  }
  for (const day of days) {
    pipeline.sadd(HISTORY_DAYS_INDEX_KEY, day);
  }
  await pipeline.exec();

  return Array.from(days).sort();
}

async function getDayTsKeys(day: string): Promise<string[]> {
  const indexedKeys = parseStringArray(await getKv().smembers(daySessionsIndexKey(day)))
    .filter((key) => key.startsWith(`history:ts:${day}:`));
  if (indexedKeys.length > 0) {
    return indexedKeys;
  }

  const discoveredKeys = parseStringArray(await getKv().keys(`history:ts:${day}:*`));
  if (discoveredKeys.length > 0) {
    const pipeline = getKv().pipeline();
    pipeline.sadd(HISTORY_DAYS_INDEX_KEY, day);
    for (const key of discoveredKeys) {
      pipeline.sadd(daySessionsIndexKey(day), key);
    }
    await pipeline.exec();
  }
  return discoveredKeys;
}

async function getAllTsKeys(): Promise<string[]> {
  const days = await getIndexedDays();
  const keySet = new Set<string>();

  for (const day of days) {
    const keys = await getDayTsKeys(day);
    for (const key of keys) {
      keySet.add(key);
    }
  }

  if (keySet.size > 0) {
    return Array.from(keySet);
  }

  return parseStringArray(await getKv().keys('history:ts:*'));
}

async function pruneEmptyDays(days: string[]): Promise<void> {
  const uniqueDays = Array.from(new Set(days));
  for (const day of uniqueDays) {
    const remainingKeys = parseStringArray(await getKv().smembers(daySessionsIndexKey(day)));
    if (remainingKeys.length === 0) {
      const pipeline = getKv().pipeline();
      pipeline.del(daySessionsIndexKey(day));
      pipeline.srem(HISTORY_DAYS_INDEX_KEY, day);
      pipeline.del(dayIndexKey(day));
      await pipeline.exec();
    }
  }
}

async function pruneEmptyTsKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  const pipeline = getKv().pipeline();
  for (const key of keys) {
    pipeline.zcard(key);
  }
  const counts = await pipeline.exec();

  const emptyKeys: string[] = [];
  for (let index = 0; index < keys.length; index++) {
    if (((counts[index] as number) || 0) === 0) {
      emptyKeys.push(keys[index]!);
    }
  }

  if (emptyKeys.length === 0) {
    return;
  }

  const affectedDays = new Set<string>();
  const cleanupPipeline = getKv().pipeline();
  for (const key of emptyKeys) {
    const day = key.split(':')[2] ?? '';
    if (day) {
      affectedDays.add(day);
      cleanupPipeline.srem(daySessionsIndexKey(day), key);
    }
    cleanupPipeline.del(key);
  }
  await cleanupPipeline.exec();
  await pruneEmptyDays(Array.from(affectedDays));
}

function resolveSnapshotTimestamp(snapshotTimestamp: unknown): number {
  const serverNow = Date.now();
  if (typeof snapshotTimestamp !== 'number' || !Number.isFinite(snapshotTimestamp)) {
    return serverNow;
  }

  const requestedTimestamp = Math.floor(snapshotTimestamp);
  if (requestedTimestamp <= 0) {
    return serverNow;
  }

  if (Math.abs(requestedTimestamp - serverNow) > MAX_CLIENT_SNAPSHOT_SKEW_MS) {
    console.warn('Ignoring out-of-range snapshotTimestamp', { requestedTimestamp, serverNow });
    return serverNow;
  }

  return requestedTimestamp;
}

export interface HistoryWriteInput {
  records: Array<{
    memberId: string;
    memberName: string;
    memberAvatar?: string;
    eventId: number;
    eventName: string;
    sessionId: number;
    sessionName: string;
    waitingCount: number;
    waitingTime: number;
    avgWaitTime?: number;
  }>;
  eventDay?: string;
  snapshotTimestamp?: number;
}

export async function writeHistoryRecords(input: HistoryWriteInput): Promise<{ saved: number; failed: number; timestamp: number; day: string; }> {
  const { records, eventDay, snapshotTimestamp } = input;

  if (!isValidKvConfig()) {
    throw new Error('KV not configured');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Invalid records: must be a non-empty array');
  }
  if (records.length > MAX_RECORDS_PER_REQUEST) {
    throw new Error(`Too many records: max ${MAX_RECORDS_PER_REQUEST}`);
  }
  for (let index = 0; index < records.length; index++) {
    const validationError = validateRecord(records[index]);
    if (validationError) {
      throw new Error(`Record[${index}]: ${validationError}`);
    }
  }

  const timestamp = resolveSnapshotTimestamp(snapshotTimestamp);
  const day = (typeof eventDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(eventDay))
    ? eventDay
    : timestampToJSTDay(timestamp);

  const groups = new Map<string, HistoryWriteInput['records']>();
  for (const record of records) {
    const groupKey = `${record.eventId}:${record.sessionId}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = [];
      groups.set(groupKey, group);
    }
    group.push(record);
  }

  const pipeline = getKv().pipeline();
  const memberIdsInBatch = new Set<string>();

  for (const [groupKey, groupRecords] of groups) {
    const [eid = 0, sid = 0] = groupKey.split(':').map(Number);
    const sortedSetKey = tsKey(day, eid, sid);

    pipeline.zremrangebyscore(sortedSetKey, timestamp, timestamp);
    pipeline.sadd(HISTORY_DAYS_INDEX_KEY, day);
    pipeline.sadd(daySessionsIndexKey(day), sortedSetKey);

    for (const record of groupRecords) {
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
        avgWaitTime: record.avgWaitTime ?? (record.waitingCount > 0 ? Math.floor(record.waitingTime / record.waitingCount) : 0),
      };
      pipeline.zadd(sortedSetKey, { score: timestamp, member: JSON.stringify(historyRecord) });
      memberIdsInBatch.add(record.memberId);
    }

    pipeline.expire(sortedSetKey, DEFAULT_TTL_SECONDS);
  }

  await pipeline.exec();
  await updateDayIndex(day, records, memberIdsInBatch.size, timestamp);

  return { saved: records.length, failed: 0, timestamp, day };
}

/** Paginated ZRANGE to avoid Upstash 10MB response limit */
const ZRANGE_PAGE_SIZE = 500;
async function paginatedZrange(
  key: string,
  maxRecords: number,
  filterFn?: (r: HistoryRecord) => boolean,
): Promise<HistoryRecord[]> {
  const results: HistoryRecord[] = [];
  let offset = 0;

  while (results.length < maxRecords) {
    const batch = await getKv().zrange(key, offset, offset + ZRANGE_PAGE_SIZE - 1);
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const m of batch as unknown[]) {
      const record = parseMember(m);
      if (!filterFn || filterFn(record)) {
        results.push(record);
        if (results.length >= maxRecords) break;
      }
    }

    offset += ZRANGE_PAGE_SIZE;
    if (batch.length < ZRANGE_PAGE_SIZE) break; // no more data
  }

  return results;
}

// ========== Main Handler ==========

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('X-API-Version', 'v2-sorted-sets');
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Unhandled error in handler:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', message: String(error) });
    }
  }
}

// ========== GET ==========

async function handleGet(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }
  const mode = getSingleQueryValue(req.query.mode);
  try {
    switch (mode) {
      case 'days': return await handleGetDays(req, res);
      case 'events': return await handleGetDayEvents(req, res);
      case 'details': return await handleGetDayDetails(req, res);
      case 'diag': return await handleGetDiag(req, res);
      case 'collector-diag': return await handleGetCollectorDiag(req, res);
      default: return await handleGetLegacy(req, res);
    }
  } catch (error) {
    console.error('KV get error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch history', message: String(error) });
    }
  }
}

/** mode=diag: Return recent diagnostic snapshots from waitingrooms proxy */
async function handleGetDiag(_req: VercelRequest, res: VercelResponse) {
  const kv = getKv();
  const snapshots = await kv.lrange('diag:waitingrooms', 0, 49);
  const parsed = snapshots.map((s: unknown) => {
    if (typeof s === 'string') {
      try { return JSON.parse(s); } catch { return s; }
    }
    return s;
  });
  res.status(200).json({
    count: parsed.length,
    snapshots: parsed,
  });
}

async function handleGetCollectorDiag(req: VercelRequest, res: VercelResponse) {
  const logsLimit = Math.min(parseInt(getSingleQueryValue(req.query.logsLimit) ?? '30') || 30, 100);
  const snapshotsLimit = Math.min(parseInt(getSingleQueryValue(req.query.snapshotsLimit) ?? '20') || 20, 120);
  const kv = getKv();
  const [status, lastSuccess, logsRaw, snapshotsRaw] = await Promise.all([
    kv.get(COLLECTOR_STATUS_KEY),
    kv.get(COLLECTOR_LAST_SUCCESS_KEY),
    kv.lrange(COLLECTOR_LOGS_KEY, 0, logsLimit - 1),
    kv.lrange(COLLECTOR_SNAPSHOTS_KEY, 0, snapshotsLimit - 1),
  ]);

  const parseJsonItem = (item: unknown) => {
    if (typeof item === 'string') {
      try {
        return JSON.parse(item);
      } catch {
        return item;
      }
    }
    return item;
  };

  res.status(200).json({
    mode: 'collector-diag',
    status,
    lastSuccess,
    logs: Array.isArray(logsRaw) ? logsRaw.map(parseJsonItem) : [],
    snapshots: Array.isArray(snapshotsRaw) ? snapshotsRaw.map(parseJsonItem) : [],
  });
}

/** mode=days: Compute from sorted set keys (not cached day index) */
async function handleGetDays(_req: VercelRequest, res: VercelResponse) {
  const indexedDays = await getIndexedDays();
  if (indexedDays.length === 0) {
    res.status(200).json({ days: [] });
    return;
  }

  const allKeys: string[] = [];
  const dayKeysMap = new Map<string, string[]>();
  for (const day of indexedDays) {
    const keys = await getDayTsKeys(day);
    dayKeysMap.set(day, keys);
    allKeys.push(...keys);
  }

  if (allKeys.length === 0) {
    res.status(200).json({ days: [] });
    return;
  }

  const pipeline = getKv().pipeline();
  for (const key of allKeys) {
    pipeline.zcard(key);
  }
  const counts = await pipeline.exec();

  const dayMap = new Map<string, { eventIds: Set<number>; sessionIds: Set<number>; totalRecords: number }>();
  let offset = 0;
  for (const day of indexedDays) {
    const keys = dayKeysMap.get(day) || [];
    for (const key of keys) {
      const parts = key.split(':');
      const eventId = parseInt(parts[3] ?? '');
      const sessionId = parseInt(parts[4] ?? '');
      const count = (counts[offset] as number) || 0;
      offset += 1;
      if (count === 0) continue;

      if (!dayMap.has(day)) {
        dayMap.set(day, { eventIds: new Set(), sessionIds: new Set(), totalRecords: 0 });
      }
      const entry = dayMap.get(day)!;
      entry.eventIds.add(eventId);
      entry.sessionIds.add(sessionId);
      entry.totalRecords += count;
    }
  }

  const daySummaries = Array.from(dayMap.entries()).map(([day, entry]) => ({
    day,
    eventCount: entry.eventIds.size,
    sessionCount: entry.sessionIds.size,
    totalRecords: entry.totalRecords,
  }));

  daySummaries.sort((a, b) => b.day.localeCompare(a.day));
  res.status(200).json({ days: daySummaries });
}

/** mode=events: Compute from sorted set keys (not cached day index) */
async function handleGetDayEvents(req: VercelRequest, res: VercelResponse) {
  const { day } = req.query;
  if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    res.status(400).json({ error: 'day parameter required (yyyy-MM-dd)' });
    return;
  }

  const keys = await getDayTsKeys(day);
  if (!keys || keys.length === 0) {
    res.status(200).json({ day, events: [] });
    return;
  }

  // Pipeline: ZCARD + last batch sample for each key
  const pipeline = getKv().pipeline();
  for (const key of keys as string[]) {
    pipeline.zcard(key);
    pipeline.zrange(key, -200, -1); // last ~200 records for member count + names
  }
  const results = await pipeline.exec();

  const events: DayEventEntry[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as string;
    const parts = key.split(':');
    const eventId = parseInt(parts[3] ?? '');
    const sessionId = parseInt(parts[4] ?? '');
    const recordCount = (results[i * 2] as number) || 0;
    const lastBatch = results[i * 2 + 1];

    if (recordCount === 0) continue;

    let eventName = '';
    let sessionName = '';
    let memberCount = 0;
    let lastUpdated = 0;

    if (Array.isArray(lastBatch) && lastBatch.length > 0) {
      const memberIds = new Set<string>();
      for (const m of lastBatch as unknown[]) {
        const record = parseMember(m);
        memberIds.add(record.memberId);
        if (!eventName) {
          eventName = record.eventName;
          sessionName = record.sessionName;
        }
        if (record.timestamp > lastUpdated) {
          lastUpdated = record.timestamp;
        }
      }
      memberCount = memberIds.size;
    }

    events.push({ eventId, eventName, sessionId, sessionName, recordCount, memberCount, lastUpdated });
  }

  res.status(200).json({ day, events });
}

/** mode=details: Precise sorted set query */
async function handleGetDayDetails(req: VercelRequest, res: VercelResponse) {
  const { day, eventId, sessionId, memberIds, limit = '20000' } = req.query;

  if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    res.status(400).json({ error: 'day parameter required (yyyy-MM-dd)' });
    return;
  }

  const maxRecords = Math.min(parseInt(limit as string) || 20000, 50000);
  const parsedMemberIds = memberIds
    ? (Array.isArray(memberIds) ? memberIds as string[] : (memberIds as string).split(','))
    : undefined;

  let allRecords: HistoryRecord[] = [];

  const filterFn = parsedMemberIds
    ? (r: HistoryRecord) => parsedMemberIds.includes(r.memberId)
    : undefined;

  if (eventId && sessionId) {
    // Exact query: read a single sorted set key (paginated)
    const key = tsKey(day, parseInt(eventId as string), parseInt(sessionId as string));
    allRecords = await paginatedZrange(key, maxRecords, filterFn);
  } else {
    // Fuzzy query: scan sorted set keys under this day
    const pattern = eventId
      ? `history:ts:${day}:${parseInt(eventId as string)}:`
      : `history:ts:${day}:`;
    const keys = (await getDayTsKeys(day)).filter((key) => key.startsWith(pattern));

    for (const key of (keys || []) as string[]) {
      if (allRecords.length >= maxRecords) break;
      const remaining = maxRecords - allRecords.length;
      const batch = await paginatedZrange(key, remaining, filterFn);
      allRecords.push(...batch);
    }
  }

  const records = allRecords
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, maxRecords);

  res.status(200).json({ day, records, count: records.length });
}

/** Legacy flat query */
async function handleGetLegacy(req: VercelRequest, res: VercelResponse) {
  const { eventId, sessionId, memberIds, startTime, endTime, limit = '1000' } = req.query;

  try {
    const parsedEventId = eventId ? parseInt(eventId as string) : undefined;
    const parsedSessionId = sessionId ? parseInt(sessionId as string) : undefined;
    const parsedMemberIds = memberIds
      ? (Array.isArray(memberIds) ? memberIds as string[] : (memberIds as string).split(','))
      : undefined;
    const maxRecords = Math.min(parseInt(limit as string) || 1000, 5000);

    // Scan sorted set keys
    const keys = await getAllTsKeys();
    if (!keys || keys.length === 0) {
      res.status(200).json({ records: [], count: 0 });
      return;
    }

    const allRecords: HistoryRecord[] = [];
    for (const key of keys as string[]) {
      // Quick filter by eventId/sessionId from key name
      // Key format: history:ts:day:eventId:sessionId
      const parts = (key as string).split(':');
      const keyEventId = parseInt(parts[3] ?? '');
      const keySessionId = parseInt(parts[4] ?? '');
      if (parsedEventId && keyEventId !== parsedEventId) continue;
      if (parsedSessionId && keySessionId !== parsedSessionId) continue;

      if (allRecords.length >= maxRecords) break;
      const remaining = maxRecords - allRecords.length;
      const filterFn = (record: HistoryRecord) => {
        if (parsedMemberIds && !parsedMemberIds.includes(record.memberId)) return false;
        if (startTime && record.timestamp < parseInt(startTime as string)) return false;
        if (endTime && record.timestamp > parseInt(endTime as string)) return false;
        return true;
      };
      const batch = await paginatedZrange(key as string, remaining, filterFn);
      allRecords.push(...batch);
    }

    const records = allRecords
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, maxRecords);

    res.status(200).json({ records, count: records.length });
  } catch (error) {
    console.error('KV get error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

// ========== POST: Batch write using Sorted Sets ==========

async function handlePost(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { records, eventDay, snapshotTimestamp } = req.body;

  try {
    const result = await writeHistoryRecords({ records, eventDay, snapshotTimestamp });
    res.status(200).json({ success: true, saved: result.saved, failed: result.failed, timestamp: result.timestamp, day: result.day });
  } catch (error) {
    console.error('KV post error:', error);
    const message = error instanceof Error ? error.message : 'Failed to save history';
    const status = message.startsWith('Invalid records') || message.startsWith('Too many records') || message.startsWith('Record[')
      ? 400
      : (message === 'KV not configured' ? 503 : 500);
    res.status(status).json({ error: message });
  }
}

// ========== Day Index Maintenance ==========

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
          const existing = dayIndex.events[idx]!;
          existing.recordCount += newEntry.recordCount;
          existing.memberCount = Math.max(existing.memberCount, newEntry.memberCount);
          existing.lastUpdated = timestamp;
          existing.eventName = newEntry.eventName;
          existing.sessionName = newEntry.sessionName;
        } else {
          dayIndex.events.push(newEntry);
        }
      }
    } else {
      dayIndex = { day, events: Array.from(batchEntries.values()) };
    }

    await getKv().set(key, dayIndex, { ex: DEFAULT_TTL_SECONDS });
  } catch (error) {
    console.error('Failed to update day index:', error);
  }
}

// ========== DELETE ==========

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { beforeTimestamp, memberIds, day: deleteDay } = req.body;

  if (!beforeTimestamp && !memberIds && !deleteDay) {
    res.status(400).json({ error: 'Must provide beforeTimestamp, memberIds, or day' });
    return;
  }

  try {
    let deleted = 0;

    // Delete all data for a specific day
    if (deleteDay && typeof deleteDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deleteDay)) {
      const tsKeys = await getDayTsKeys(deleteDay);
      if (tsKeys.length > 0) {
        const countPipeline = getKv().pipeline();
        for (const key of tsKeys) {
          countPipeline.zcard(key);
        }
        const counts = await countPipeline.exec();
        deleted += sumPipelineNumbers(counts);

        const pipeline = getKv().pipeline();
        for (const key of tsKeys) {
          pipeline.del(key);
          pipeline.srem(daySessionsIndexKey(deleteDay), key);
        }
        pipeline.del(daySessionsIndexKey(deleteDay));
        pipeline.srem(HISTORY_DAYS_INDEX_KEY, deleteDay);
        pipeline.del(dayIndexKey(deleteDay));
        await pipeline.exec();
      }
    }

    if (beforeTimestamp) {
      const cutoffDay = timestampToJSTDay(beforeTimestamp);

      const days = await getIndexedDays();
      const olderDays = days.filter((day) => day < cutoffDay);

      for (const day of olderDays) {
        const tsKeys = await getDayTsKeys(day);
        if (tsKeys.length === 0) {
          await pruneEmptyDays([day]);
          continue;
        }

        const countPipeline = getKv().pipeline();
        for (const key of tsKeys) {
          countPipeline.zcard(key);
        }
        const counts = await countPipeline.exec();
        deleted += sumPipelineNumbers(counts);

        const pipeline = getKv().pipeline();
        for (const key of tsKeys) {
          pipeline.del(key);
          pipeline.srem(daySessionsIndexKey(day), key);
        }
        pipeline.del(daySessionsIndexKey(day));
        pipeline.srem(HISTORY_DAYS_INDEX_KEY, day);
        pipeline.del(dayIndexKey(day));
        await pipeline.exec();
      }

      const cutoffKeys = await getDayTsKeys(cutoffDay);
      if (cutoffKeys.length > 0) {
        const removePipeline = getKv().pipeline();
        for (const key of cutoffKeys) {
          removePipeline.zremrangebyscore(key, 0, beforeTimestamp - 1);
        }
        const removedCounts = await removePipeline.exec();
        deleted += sumPipelineNumbers(removedCounts);
        await pruneEmptyTsKeys(cutoffKeys);
      }
    }

    if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
      const tsKeys = await getAllTsKeys();
      for (const key of tsKeys) {
        // Paginated scan to avoid 10MB response limit
        let offset = 0;
        while (true) {
          const batch = await getKv().zrange(key, offset, offset + ZRANGE_PAGE_SIZE - 1);
          if (!Array.isArray(batch) || batch.length === 0) break;

          const pipeline = getKv().pipeline();
          let removedCount = 0;
          for (const m of batch as unknown[]) {
            const record = parseMember(m);
            if (memberIds.includes(record.memberId)) {
              pipeline.zrem(key, typeof m === 'string' ? m : JSON.stringify(m));
              removedCount++;
            }
          }
          if (removedCount > 0) {
            await pipeline.exec();
            deleted += removedCount;
            // Don't advance offset since items were removed
          } else {
            offset += ZRANGE_PAGE_SIZE;
          }
          if (batch.length < ZRANGE_PAGE_SIZE) break;
        }
      }
      await pruneEmptyTsKeys(tsKeys);
    }

    res.status(200).json({ success: true, deleted });
  } catch (error) {
    console.error('KV delete error:', error);
    res.status(500).json({ error: 'Failed to delete history' });
  }
}
