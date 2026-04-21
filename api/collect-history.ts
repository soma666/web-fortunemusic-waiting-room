import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { flatternEventArray, type Event } from '../src/api/fortunemusic/events';
import { writeHistoryRecords } from './history';

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
  eventArray: unknown[];
}

interface RawEventsResponse {
  appGetEventResponse?: {
    artistArray?: RawArtist[];
  };
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

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    return authHeader === `Bearer ${cronSecret}`;
  }

  const userAgent = req.headers['user-agent'];
  return userAgent === 'vercel-cron/1.0' || process.env.NODE_ENV !== 'production';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJstDay(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getActiveEvents(events: Event[], now: Date): Event[] {
  return events.filter((event) => Array.from(event.sessions.values()).some((session) => now >= session.startTime && now <= session.endTime));
}

async function fetchActiveEvents(): Promise<Event[]> {
  const response = await fetch('https://fm.proxies.n46.io/v1/appGetEventData/');
  if (!response.ok) {
    throw new Error(`Events upstream API returned ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as RawEventsResponse;
  const result: Event[] = [];
  for (const artist of data.appGetEventResponse?.artistArray || []) {
    if (!TARGET_ARTIST_NAMES.includes(artist.artName)) {
      continue;
    }
    const eventMap = flatternEventArray(artist.artName, artist.eventArray as never[]);
    eventMap.forEach((events) => {
      result.push(...events);
    });
  }
  return getActiveEvents(result, new Date());
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

async function collectSnapshot(snapshotTimestamp: number): Promise<{ events: number; sessions: number; records: number; }> {
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

      await writeHistoryRecords({
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

  const manualOnce = req.query.mode === 'once';
  const startedAt = Date.now();
  const snapshots: CollectorSnapshotSummary[] = [];

  try {
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
      const snapshot = { timestamp, ...(await collectSnapshot(timestamp)) };
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
        const snapshot = { timestamp: nextSnapshot, ...(await collectSnapshot(nextSnapshot)) };
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
    await setCollectorStatus(status);
    await pushCollectorLog({
      ts: failedAt,
      level: 'error',
      event: 'run-failed',
      message,
      meta: status,
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'History collector failed' });
  } finally {
    await releaseCollectorLock();
  }
}