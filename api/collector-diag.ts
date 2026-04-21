import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const COLLECTOR_LOGS_KEY = 'history:collector:logs';
const COLLECTOR_SNAPSHOTS_KEY = 'history:collector:snapshots';
const COLLECTOR_STATUS_KEY = 'history:collector:status';
const COLLECTOR_LAST_SUCCESS_KEY = 'history:collector:last-success';

function getKv(): Redis {
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

function parseJsonItem(item: unknown) {
  if (typeof item === 'string') {
    try {
      return JSON.parse(item);
    } catch {
      return item;
    }
  }
  return item;
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

  try {
    const logsLimit = Math.min(parseInt(getSingleQueryValue(req.query.logsLimit) ?? '30') || 30, 100);
    const snapshotsLimit = Math.min(parseInt(getSingleQueryValue(req.query.snapshotsLimit) ?? '20') || 20, 120);
    const kv = getKv();
    const [status, lastSuccess, logsRaw, snapshotsRaw] = await Promise.all([
      kv.get(COLLECTOR_STATUS_KEY),
      kv.get(COLLECTOR_LAST_SUCCESS_KEY),
      kv.lrange(COLLECTOR_LOGS_KEY, 0, logsLimit - 1),
      kv.lrange(COLLECTOR_SNAPSHOTS_KEY, 0, snapshotsLimit - 1),
    ]);

    res.status(200).json({
      mode: 'collector-diag',
      status,
      lastSuccess,
      logs: Array.isArray(logsRaw) ? logsRaw.map(parseJsonItem) : [],
      snapshots: Array.isArray(snapshotsRaw) ? snapshotsRaw.map(parseJsonItem) : [],
    });
  } catch (error) {
    console.error('Failed to fetch collector diag:', error);
    res.status(500).json({ error: 'Failed to fetch collector diag' });
  }
}