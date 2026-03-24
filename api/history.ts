import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

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

interface HistoryFilter {
  eventId?: number;
  sessionId?: number;
  memberIds?: string[];
  startTime?: number;
  endTime?: number;
}

function isValidKvConfig(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

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

async function handleGet(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { eventId, sessionId, memberIds, startTime, endTime, limit = '1000' } = req.query;

  try {
    const keys = await kv.keys('history:*');
    const records: HistoryRecord[] = [];
    const filter: HistoryFilter = {
      eventId: eventId ? parseInt(eventId as string) : undefined,
      sessionId: sessionId ? parseInt(sessionId as string) : undefined,
      memberIds: memberIds ? (Array.isArray(memberIds) ? memberIds as string[] : [memberIds as string]) : undefined,
      startTime: startTime ? parseInt(startTime as string) : undefined,
      endTime: endTime ? parseInt(endTime as string) : undefined,
    };

    const maxRecords = parseInt(limit as string);
    let count = 0;

    for (const key of keys) {
      if (count >= maxRecords) break;

      const data = await kv.get<HistoryRecord>(key as string);
      if (data) {
        if (filter.eventId && data.eventId !== filter.eventId) continue;
        if (filter.sessionId && data.sessionId !== filter.sessionId) continue;
        if (filter.memberIds && !filter.memberIds.includes(data.memberId)) continue;
        if (filter.startTime && data.timestamp < filter.startTime) continue;
        if (filter.endTime && data.timestamp > filter.endTime) continue;

        records.push(data);
        count++;
      }
    }

    records.sort((a, b) => a.timestamp - b.timestamp);

    res.status(200).json({ records, count: records.length });
  } catch (error) {
    console.error('KV get error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: 'Invalid records' });
    return;
  }

  try {
    const timestamp = Date.now();
    let success = 0;
    let failed = 0;

    for (const record of records) {
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

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  if (!isValidKvConfig()) {
    res.status(503).json({ error: 'KV not configured' });
    return;
  }

  const { beforeTimestamp, memberIds } = req.body;

  try {
    const keys = await kv.keys('history:*');
    let deleted = 0;

    for (const key of keys) {
      const data = await kv.get<HistoryRecord>(key as string);
      if (data) {
        let shouldDelete = false;

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