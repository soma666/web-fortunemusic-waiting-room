import type {
  HistoryRecord,
  HistoryBatchRecord,
  HistoryFilter,
  HistorySummary,
  MemberStats,
  ChartDataPoint,
  HistorySettings,
} from './history-types';

const API_BASE = '/api';

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
}

export async function fetchHistory(filter: HistoryFilter = {}): Promise<HistoryRecord[]> {
  const params = new URLSearchParams();
  if (filter.eventId) params.set('eventId', filter.eventId.toString());
  if (filter.sessionId) params.set('sessionId', filter.sessionId.toString());
  if (filter.memberIds?.length) params.set('memberIds', filter.memberIds.join(','));
  if (filter.startTime) params.set('startTime', filter.startTime.toString());
  if (filter.endTime) params.set('endTime', filter.endTime.toString());

  const query = params.toString();
  const endpoint = `/history${query ? `?${query}` : ''}`;

  try {
    const result = await apiRequest<{ records: HistoryRecord[]; count: number }>(endpoint);
    return result.records;
  } catch {
    return [];
  }
}

export async function saveBatchHistoryRecords(records: HistoryBatchRecord[]): Promise<boolean> {
  if (records.length === 0) return false;

  try {
    await apiRequest('/history', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
    return true;
  } catch (error) {
    console.error('Failed to save history:', error);
    return false;
  }
}

export async function deleteHistory(options: {
  beforeTimestamp?: number;
  memberIds?: string[];
} = {}): Promise<number> {
  try {
    const result = await apiRequest<{ success: boolean; deleted: number }>('/history', {
      method: 'DELETE',
      body: JSON.stringify(options),
    });
    return result.deleted;
  } catch {
    return 0;
  }
}

export function calculateChartData(
  records: HistoryRecord[],
  selectedMemberIds: string[],
  yAxisMode: 'waitingCount' | 'waitingTime' | 'avgWaitingTime'
): ChartDataPoint[] {
  if (records.length === 0) return [];

  const timestampMap = new Map<number, Map<string, HistoryRecord>>();

  records.forEach((record) => {
    if (!timestampMap.has(record.timestamp)) {
      timestampMap.set(record.timestamp, new Map());
    }
    timestampMap.get(record.timestamp)!.set(record.memberId, record);
  });

  const sortedTimestamps = Array.from(timestampMap.keys()).sort((a, b) => a - b);

  return sortedTimestamps.map((ts) => {
    const point: ChartDataPoint = {
      time: new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: ts,
    };

    selectedMemberIds.forEach((memberId) => {
      const record = timestampMap.get(ts)?.get(memberId);
      if (record) {
        switch (yAxisMode) {
          case 'waitingCount':
            point[memberId] = record.waitingCount;
            break;
          case 'waitingTime':
            point[memberId] = record.waitingTime;
            break;
          case 'avgWaitingTime':
            point[memberId] = record.waitingCount > 0
              ? Math.round(record.waitingTime / record.waitingCount)
              : 0;
            break;
        }
      } else {
        point[memberId] = null;
      }
    });

    return point;
  });
}

export function calculateMemberStats(records: HistoryRecord[]): MemberStats[] {
  const memberMap = new Map<string, HistoryRecord[]>();

  records.forEach((record) => {
    const key = `${record.memberId}:${record.eventId}:${record.sessionId}`;
    if (!memberMap.has(key)) {
      memberMap.set(key, []);
    }
    memberMap.get(key)!.push(record);
  });

  return Array.from(memberMap.entries()).map(([key, memberRecords]) => {
    const first = memberRecords[0]!;
    const waitingCounts = memberRecords.map((r) => r.waitingCount);
    const waitingTimes = memberRecords.map((r) => r.waitingTime);

    return {
      memberId: first.memberId,
      memberName: first.memberName,
      memberAvatar: first.memberAvatar,
      eventId: first.eventId,
      eventName: first.eventName,
      sessionId: first.sessionId,
      sessionName: first.sessionName,
      peakWaitingCount: Math.max(...waitingCounts),
      minWaitingCount: Math.min(...waitingCounts),
      avgWaitingCount: Math.round(waitingCounts.reduce((a, b) => a + b, 0) / waitingCounts.length),
      peakWaitingTime: Math.max(...waitingTimes),
      minWaitingTime: Math.min(...waitingTimes),
      avgWaitingTime: Math.round(waitingTimes.reduce((a, b) => a + b, 0) / waitingTimes.length),
      dataPoints: memberRecords.length,
    };
  });
}

export function calculateSummary(records: HistoryRecord[]): HistorySummary {
  if (records.length === 0) {
    return {
      memberCount: 0,
      recordCount: 0,
      eventCount: 0,
      sessionCount: 0,
      timeRange: { start: null, end: null },
    };
  }

  const eventIds = new Set<number>();
  const sessionIds = new Set<number>();
  const memberIds = new Set<string>();
  let earliest: number | null = null;
  let latest: number | null = null;

  records.forEach((record) => {
    eventIds.add(record.eventId);
    sessionIds.add(record.sessionId);
    memberIds.add(record.memberId);

    if (!earliest || record.timestamp < earliest) earliest = record.timestamp;
    if (!latest || record.timestamp > latest) latest = record.timestamp;
  });

  return {
    memberCount: memberIds.size,
    recordCount: records.length,
    eventCount: eventIds.size,
    sessionCount: sessionIds.size,
    timeRange: { start: earliest, end: latest },
  };
}

export function getUniqueEvents(records: HistoryRecord[]): Array<{ id: number; name: string }> {
  const eventMap = new Map<number, string>();
  records.forEach((record) => {
    eventMap.set(record.eventId, record.eventName);
  });
  return Array.from(eventMap.entries()).map(([id, name]) => ({ id, name }));
}

export function getUniqueSessions(records: HistoryRecord[], eventId?: number): Array<{ id: number; name: string }> {
  const sessionMap = new Map<number, string>();
  records.forEach((record) => {
    if (!eventId || record.eventId === eventId) {
      sessionMap.set(record.sessionId, record.sessionName);
    }
  });
  return Array.from(sessionMap.entries()).map(([id, name]) => ({ id, name }));
}

const SETTINGS_KEY = 'fortunemusic_history_settings';

export function getSettings(): HistorySettings {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return defaultSettings();
    }
  }
  return defaultSettings();
}

export function saveSettings(settings: HistorySettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function defaultSettings(): HistorySettings {
  return {
    autoSave: true,
    playbackSpeed: 1,
    retentionDays: 7,
  };
}
