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
  timeRange: { start: number | null; end: number | null };
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
  autoSave: boolean;
  playbackSpeed: number;
  retentionDays: number;
}
