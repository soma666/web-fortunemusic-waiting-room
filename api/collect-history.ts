import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const TARGET_ARTIST_NAMES = ['乃木坂46', '櫻坂46', '日向坂46', '=LOVE'];
const COLLECT_INTERVAL_MS = 20 * 1000;
const CRON_WINDOW_MS = 58 * 1000;
const COLLECTOR_LOCK_KEY = 'history:collector:lock';
const COLLECTOR_LOGS_KEY = 'history:collector:logs';
const COLLECTOR_SNAPSHOTS_KEY = 'history:collector:snapshots';
const COLLECTOR_STATUS_KEY = 'history:collector:status';
const COLLECTOR_LAST_SUCCESS_KEY = 'history:collector:last-success';
const COLLECTOR_LOG_LIMIT = 100;
const COLLECTOR_SNAPSHOT_LIMIT = 120;

interface RawArtist {
  artName: string;
  eventArray: RawEvent[];
}

interface RawEventsResponse {
  appGetEventResponse?: {
    artistArray?: RawArtist[];
  };
}

interface RawEvent {
  evtId: number;
  evtName: string;
  dateArray: RawDate[];
}

interface RawDate {
  dateDate: string;
  timeZoneArray: RawTimezone[];
}

interface RawTimezone {
  tzId: number;
  tzName: string;
  tzStart: string;
  tzEnd: string;
  memberArray: RawMember[];
}

interface RawMember {
  mbName: string;
  mbPhotoUrl: string;
  shCode: string;
}

interface RawWaitingRoomsResponse {
  dateMessage: string | null;
  timezones: Array<{
    e_id: string;
    members: Record<string, { totalCount: number; totalWait: number }>;
  }>;
}

interface CollectorSnapshotSummary {
  timestamp: number;
  events: number;
  sessions: number;
  records: number;
}

interface CollectorLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}

interface EventMember {
  name: string;
  thumbnailUrl: string;
}

interface EventSession {
  id: number;
  name: string;
  startTime: Date;
  endTime: Date;
  members: Map<string, EventMember>;
}

interface EventSummary {
  id: number;
  name: string;
  sessions: Map<number, EventSession>;
}

interface HistoryWritePayload {
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
  eventDay: string;
  snapshotTimestamp: number;
}

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function getRequestOrigin(req: VercelRequest): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const host = req.headers.host;

  if (!host) {
    throw new Error('Missing host header');
  }

  return `${protocol || 'https'}://${host}`;
}

function parseJstDateTime(dateText: string, timeText: string): Date {
  return new Date(`${dateText}T${timeText}:00+09:00`);
}

function getJstDay(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameJstDayOrFuture(dateText: string, now: Date): boolean {
  const target = new Date(`${dateText}T00:00:00+09:00`);
  const nowJst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStart = Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate());
  const targetStart = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return targetStart >= todayStart;
}

function mapMembers(memberArray: RawMember[]): Map<string, EventMember> {
  const members = new Map<string, EventMember>();
  for (const member of memberArray) {
    members.set(member.shCode, {
      name: member.mbName,
      thumbnailUrl: member.mbPhotoUrl,
    });
  }
  return members;
}

function parseEventsResponse(data: RawEventsResponse, now: Date): EventSummary[] {
  const results: EventSummary[] = [];

  for (const artist of data.appGetEventResponse?.artistArray || []) {
    if (!TARGET_ARTIST_NAMES.includes(artist.artName)) {
      continue;
    }

    for (const event of artist.eventArray || []) {
      for (const dateEntry of event.dateArray || []) {
        if (!isSameJstDayOrFuture(dateEntry.dateDate, now)) {
          continue;
        }

        const sessions = new Map<number, EventSession>();
        for (const timezone of dateEntry.timeZoneArray || []) {
          sessions.set(timezone.tzId, {
            id: timezone.tzId,
            name: timezone.tzName,
            startTime: parseJstDateTime(dateEntry.dateDate, timezone.tzStart),
            endTime: parseJstDateTime(dateEntry.dateDate, timezone.tzEnd),
            members: mapMembers(timezone.memberArray || []),
          });
        }

        results.push({
          id: event.evtId,
          name: event.evtName,
          sessions,
        });
      }
    }
  }

  return results;
}

async function pushCollectorLog(entry: CollectorLogEntry): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.lpush(COLLECTOR_LOGS_KEY, JSON.stringify(entry));
  pipeline.ltrim(COLLECTOR_LOGS_KEY, 0, COLLECTOR_LOG_LIMIT - 1);
  await pipeline.exec();
}

async function pushCollectorSnapshot(snapshot: CollectorSnapshotSummary): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.lpush(COLLECTOR_SNAPSHOTS_KEY, JSON.stringify(snapshot));
  pipeline.ltrim(COLLECTOR_SNAPSHOTS_KEY, 0, COLLECTOR_SNAPSHOT_LIMIT - 1);
  await pipeline.exec();
}

async function setCollectorStatus(status: Record<string, unknown>): Promise<void> {
  await getRedis().set(COLLECTOR_STATUS_KEY, status);
}

function isAuthorized(req: VercelRequest): boolean {
  const mode = getSingleQueryValue(req.query.mode);
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = req.headers.authorization;
    const token = getSingleQueryValue(req.query.token);
    return authHeader === `Bearer ${cronSecret}` || token === cronSecret;
  }

  const userAgent = req.headers['user-agent'];
  return userAgent === 'vercel-cron/1.0' || process.env.NODE_ENV !== 'production' || mode === 'once';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getActiveEvents(events: EventSummary[], now: Date): EventSummary[] {
  return events.filter((event) => Array.from(event.sessions.values()).some((session) => now >= session.startTime && now <= session.endTime));
}

async function fetchActiveEvents(): Promise<EventSummary[]> {
  const response = await fetch('https://fm.proxies.n46.io/v1/appGetEventData/');
  if (!response.ok) {
    throw new Error(`Events upstream API returned ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as RawEventsResponse;
  return getActiveEvents(parseEventsResponse(data, new Date()), new Date());
}

async function fetchWaitingRoomsSnapshot(sessionId: number): Promise<RawWaitingRoomsResponse> {
  const response = await fetch('https://fm.proxies.n46.io/lapi/v5/app/dateTimezoneMessages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ eventId: `e${sessionId}` }),
  });

  if (!response.ok) {
    throw new Error(`Waiting rooms upstream API returned ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<RawWaitingRoomsResponse>;
}

async function saveHistoryRecords(req: VercelRequest, payload: HistoryWritePayload): Promise<void> {
  const response = await fetch(`${getRequestOrigin(req)}/api/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Failed to save history records');
    throw new Error(`History API returned ${response.status}: ${errorText}`);
  }
}

async function collectSnapshot(req: VercelRequest, snapshotTimestamp: number): Promise<{ events: number; sessions: number; records: number; }> {
  const now = new Date(snapshotTimestamp);
  const events = await fetchActiveEvents();
  let sessionCount = 0;
  let recordCount = 0;

  for (const event of events) {
    const activeSessions = Array.from(event.sessions.values()).filter((session) => now >= session.startTime && now <= session.endTime);
    if (activeSessions.length === 0) {
      continue;
    }

    const representativeSession = activeSessions[0]!;
    const waitingRooms = await fetchWaitingRoomsSnapshot(representativeSession.id);
    const eventDay = getJstDay(now);

    for (const session of activeSessions) {
      const timezone = waitingRooms.timezones.find((item) => item.e_id === `e${session.id}`);
      if (!timezone) {
        continue;
      }

      const records = Object.entries(timezone.members).map(([memberId, info]) => {
        const member = session.members.get(memberId);
        return {
          memberId,
          memberName: member?.name || memberId,
          memberAvatar: member?.thumbnailUrl,
          eventId: event.id,
          eventName: event.name,
          sessionId: session.id,
          sessionName: session.name,
          waitingCount: info.totalCount,
          waitingTime: info.totalWait,
          avgWaitTime: info.totalCount > 0 ? Math.floor(info.totalWait / info.totalCount) : 0,
        };
      });

      if (records.length === 0) {
        continue;
      }

      await saveHistoryRecords(req, {
        records,
        eventDay,
        snapshotTimestamp,
      });
      sessionCount += 1;
      recordCount += records.length;
    }
  }

  return {
    events: events.length,
    sessions: sessionCount,
    records: recordCount,
  };
}

async function acquireCollectorLock(): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(COLLECTOR_LOCK_KEY, String(Date.now()), { nx: true, ex: Math.ceil(CRON_WINDOW_MS / 1000) });
  return result === 'OK';
}

async function releaseCollectorLock(): Promise<void> {
  try {
    await getRedis().del(COLLECTOR_LOCK_KEY);
  } catch {
    // Ignore cleanup failures; lock also expires automatically.
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const manualOnce = getSingleQueryValue(req.query.mode) === 'once';
  const startedAt = Date.now();
  const snapshots: CollectorSnapshotSummary[] = [];

  try {
    const locked = await acquireCollectorLock();
    if (!locked) {
      await pushCollectorLog({
        ts: Date.now(),
        level: 'warn',
        event: 'lock-conflict',
        message: 'Collector skipped because another run is already active',
      });
      res.status(409).json({ error: 'Collector already running' });
      return;
    }

    await setCollectorStatus({
      state: 'running',
      startedAt,
      mode: manualOnce ? 'once' : 'cron',
    });
    await pushCollectorLog({
      ts: startedAt,
      level: 'info',
      event: 'run-start',
      message: `Collector run started (${manualOnce ? 'once' : 'cron'})`,
      meta: { manualOnce },
    });

    if (manualOnce) {
      const timestamp = Math.floor(Date.now() / COLLECT_INTERVAL_MS) * COLLECT_INTERVAL_MS;
      const snapshot = { timestamp, ...(await collectSnapshot(req, timestamp)) };
      snapshots.push(snapshot);
      await pushCollectorSnapshot(snapshot);
      await pushCollectorLog({
        ts: Date.now(),
        level: 'info',
        event: 'snapshot-complete',
        message: `Collected snapshot at ${timestamp}`,
        meta: snapshot,
      });
    } else {
      const deadline = startedAt + CRON_WINDOW_MS;
      let nextSnapshot = Math.ceil(startedAt / COLLECT_INTERVAL_MS) * COLLECT_INTERVAL_MS;

      while (nextSnapshot <= deadline) {
        const waitMs = nextSnapshot - Date.now();
        if (waitMs > 0) {
          await delay(waitMs);
        }
        const snapshot = { timestamp: nextSnapshot, ...(await collectSnapshot(req, nextSnapshot)) };
        snapshots.push(snapshot);
        await pushCollectorSnapshot(snapshot);
        await pushCollectorLog({
          ts: Date.now(),
          level: 'info',
          event: 'snapshot-complete',
          message: `Collected snapshot at ${nextSnapshot}`,
          meta: snapshot,
        });
        nextSnapshot += COLLECT_INTERVAL_MS;
      }
    }

    const totalRecords = snapshots.reduce((sum, snapshot) => sum + snapshot.records, 0);
    const totalSessions = snapshots.reduce((sum, snapshot) => sum + snapshot.sessions, 0);
    const finishedAt = Date.now();
    const status = {
      state: 'idle',
      startedAt,
      finishedAt,
      mode: manualOnce ? 'once' : 'cron',
      totalRecords,
      totalSessions,
      snapshotCount: snapshots.length,
      lastSnapshotAt: snapshots.length > 0 ? snapshots[snapshots.length - 1]!.timestamp : null,
    };
    await setCollectorStatus(status);
    await getRedis().set(COLLECTOR_LAST_SUCCESS_KEY, status);
    await pushCollectorLog({
      ts: finishedAt,
      level: 'info',
      event: 'run-complete',
      message: 'Collector run completed',
      meta: status,
    });
    res.status(200).json({
      success: true,
      mode: manualOnce ? 'once' : 'cron',
      snapshots,
      totalRecords,
      totalSessions,
    });
  } catch (error) {
    console.error('History collector failed:', error);
    const failedAt = Date.now();
    const message = error instanceof Error ? error.message : 'History collector failed';
    const status = {
      state: 'error',
      startedAt,
      failedAt,
      mode: manualOnce ? 'once' : 'cron',
      error: message,
      snapshotCount: snapshots.length,
    };
    try {
      await setCollectorStatus(status);
      await pushCollectorLog({
        ts: failedAt,
        level: 'error',
        event: 'run-failed',
        message,
        meta: status,
      });
    } catch {
      // Ignore secondary logging failures.
    }
    res.status(500).json({ error: message });
  } finally {
    await releaseCollectorLock();
  }
}