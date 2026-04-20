import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const DIAG_KEY = 'diag:waitingrooms';
const DIAG_MAX = 50;

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

interface MemberInfo {
  totalCount: number;
  totalWait: number;
  firebaseDbUrl?: string;
}

interface TimezoneInfo {
  e_id: string;
  members: Record<string, MemberInfo>;
  firebase_db_url?: string;
  [key: string]: unknown;
}

/** Build a compact diagnostic snapshot from raw upstream response */
function buildDiagSnapshot(eventId: string, data: { timezones?: TimezoneInfo[] }) {
  const timezones = data.timezones || [];
  let totalMembers = 0;
  let nonZeroCount = 0;
  let nonZeroWait = 0;
  let hasFirebase = false;
  const samples: { eid: string; mid: string; count: number; wait: number }[] = [];

  for (const tz of timezones) {
    if (tz.firebase_db_url) hasFirebase = true;
    for (const [mid, info] of Object.entries(tz.members || {})) {
      totalMembers++;
      if (info.firebaseDbUrl) hasFirebase = true;
      if (info.totalCount > 0) nonZeroCount++;
      if (info.totalWait > 0) nonZeroWait++;
      // Keep first 3 non-zero samples
      if ((info.totalCount > 0 || info.totalWait > 0) && samples.length < 3) {
        samples.push({ eid: tz.e_id, mid, count: info.totalCount, wait: info.totalWait });
      }
    }
  }

  return {
    ts: Date.now(),
    eventId,
    sessions: timezones.length,
    totalMembers,
    nonZeroCount,
    nonZeroWait,
    hasFirebase,
    samples,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const response = await fetch('https://fm.proxies.n46.io/lapi/v5/app/dateTimezoneMessages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      console.error('Waiting rooms proxy upstream error', {
        status: response.status,
        statusText: response.statusText,
        body: responseText.slice(0, 500),
        requestBody: req.body,
      });
      res.status(response.status).json({
        error: `Upstream API returned ${response.status} ${response.statusText}`,
        source: 'waitingrooms-proxy',
        upstream: 'fm.proxies.n46.io',
        status: response.status,
      });
      return;
    }

    const data = await response.json();

    // Save diagnostic snapshot to Redis (fire-and-forget)
    try {
      const redis = getRedis();
      if (redis) {
        const eventId = req.body?.eventId || 'unknown';
        const snap = buildDiagSnapshot(eventId, data);
        const pipeline = redis.pipeline();
        pipeline.lpush(DIAG_KEY, JSON.stringify(snap));
        pipeline.ltrim(DIAG_KEY, 0, DIAG_MAX - 1);
        pipeline.exec().catch(() => {});
      }
    } catch { /* diagnostic is best-effort */ }

    res.status(200).json(data);
  } catch (error) {
    console.error('Waiting rooms proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch from upstream waiting rooms API',
      source: 'waitingrooms-proxy',
      upstream: 'fm.proxies.n46.io',
    });
  }
}