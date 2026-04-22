export interface HistoryRecord {
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

export interface HistoryBatchRecord {
  memberId: string;
  memberName: string;
  memberAvatar?: string;
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  waitingCount: number;
  waitingTime: number;
  avgWaitTime: number;
}

export interface HistoryBatchWritePayload {
  records: HistoryBatchRecord[];
  eventDay?: string;
  snapshotTimestamp?: number;
}

export interface HistoryExportPayload {
  version: 1;
  exportedAt: number;
  day: string | null;
  event: { id: number; name: string } | null;
  session: { id: number; name: string } | null;
  records: HistoryRecord[];
}

export interface HistoryFilter {
  eventId?: number;
  sessionId?: number;
  memberIds?: string[];
  startTime?: number;
  endTime?: number;
}

export interface HistorySummary {
  memberCount: number;
  recordCount: number;
  eventCount: number;
  sessionCount: number;
  timeRange: {
    start: number | null;
    end: number | null;
  };
}

export interface MemberStats {
  memberId: string;
  memberName: string;
  memberAvatar?: string;
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  peakWaitingCount: number;
  minWaitingCount: number;
  avgWaitingCount: number;
  peakWaitingTime: number;
  minWaitingTime: number;
  avgWaitingTime: number;
  dataPoints: number;
}

export interface ChartDataPoint {
  time: string;
  timestamp: number;
  [memberId: string]: string | number | null;
}

export interface HistorySettings {
  playbackSpeed: number;
  retentionDays: number;
}

export interface DaySummary {
  day: string;
  eventCount: number;
  sessionCount: number;
  totalRecords: number;
}

export interface DayEventSummary {
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  recordCount: number;
  memberCount: number;
  lastUpdated: number;
}

export interface HistoryDetailFilter {
  day: string;
  eventId?: number;
  sessionId?: number;
  memberIds?: string[];
  limit?: number;
}

export interface CollectorLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface CollectorSnapshotSummary {
  timestamp: number;
  events: number;
  sessions: number;
  records: number;
}

export interface CollectorStatus {
  state: 'running' | 'idle' | 'error';
  startedAt?: number;
  finishedAt?: number;
  failedAt?: number;
  mode?: 'once' | 'cron';
  totalRecords?: number;
  totalSessions?: number;
  snapshotCount?: number;
  lastSnapshotAt?: number | null;
  error?: string;
}

export interface CollectorDiag {
  status: CollectorStatus | null;
  lastSuccess: CollectorStatus | null;
  logs: CollectorLogEntry[];
  snapshots: CollectorSnapshotSummary[];
}

export type HistoryBrowsePhase = 'days' | 'events' | 'details';
