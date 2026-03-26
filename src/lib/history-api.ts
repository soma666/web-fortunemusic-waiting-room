/**
 * history-api.ts - 历史数据 API 客户端
 * 
 * 提供历史数据的 CRUD 操作和数据处理函数。
 * 主要功能：
 * 1. 与后端 API 通信（fetchHistory, saveBatchHistoryRecords, deleteHistory）
 * 2. 数据计算（calculateChartData, calculateMemberStats, calculateSummary）
 * 3. 设置管理（getSettings, saveSettings）
 */

import type {
  HistoryRecord,
  HistoryBatchRecord,
  HistoryFilter,
  HistorySummary,
  MemberStats,
  ChartDataPoint,
  HistorySettings,
} from './history-types';

/** API 基础路径 */
const API_BASE = '/api';

// ========== API 请求工具函数 ==========

/**
 * 通用 API 请求封装
 * @param endpoint - API 端点路径
 * @param options - fetch 选项
 * @returns 响应数据
 */
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

// ========== CRUD 操作 ==========

/**
 * 获取历史记录
 * 支持按活动、场次、成员、时间范围过滤
 * 
 * @param filter - 过滤条件
 * @returns 历史记录数组
 */
export async function fetchHistory(filter: HistoryFilter = {}): Promise<HistoryRecord[]> {
  // 构建查询参数
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

/**
 * 批量保存历史记录
 * 用于保存等待室快照数据
 * 
 * @param records - 批量记录数组
 * @returns 是否保存成功
 */
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

/**
 * 删除历史记录
 * 支持按时间或成员ID删除
 * 
 * @param options - 删除选项
 * @returns 删除的记录数量
 */
export async function deleteHistory(options: {
  beforeTimestamp?: number;    // 删除此时间之前的记录
  memberIds?: string[];        // 删除指定成员的记录
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

// ========== 数据计算函数 ==========

/**
 * 计算图表数据
 * 将历史记录转换为 Recharts 可用的格式
 * 
 * @param records - 历史记录数组
 * @param selectedMemberIds - 选中的成员ID列表
 * @param yAxisMode - Y轴显示模式
 * @returns 图表数据点数组
 */
export function calculateChartData(
  records: HistoryRecord[],
  selectedMemberIds: string[],
  yAxisMode: 'waitingCount' | 'waitingTime' | 'avgWaitingTime'
): ChartDataPoint[] {
  if (records.length === 0) return [];

  // 按时间戳分组
  const timestampMap = new Map<number, Map<string, HistoryRecord>>();

  records.forEach((record) => {
    if (!timestampMap.has(record.timestamp)) {
      timestampMap.set(record.timestamp, new Map());
    }
    timestampMap.get(record.timestamp)!.set(record.memberId, record);
  });

  // 按时间排序
  const sortedTimestamps = Array.from(timestampMap.keys()).sort((a, b) => a - b);

  // 构建图表数据点
  return sortedTimestamps.map((ts) => {
    const point: ChartDataPoint = {
      time: new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: ts,
    };

    // 填充每个成员的数据
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
            // 平均等候时间 = 总等候时间 / 排队人数
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

/**
 * 计算成员统计数据
 * 用于卡片和列表视图展示
 * 
 * @param records - 历史记录数组
 * @returns 成员统计数组
 */
export function calculateMemberStats(records: HistoryRecord[]): MemberStats[] {
  // 按成员+活动+场次分组
  const memberMap = new Map<string, HistoryRecord[]>();

  records.forEach((record) => {
    const key = `${record.memberId}:${record.eventId}:${record.sessionId}`;
    if (!memberMap.has(key)) {
      memberMap.set(key, []);
    }
    memberMap.get(key)!.push(record);
  });

  // 计算统计数据
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

/**
 * 计算历史数据摘要
 * 用于面板顶部的统计信息展示
 * 
 * @param records - 历史记录数组
 * @returns 摘要数据
 */
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

/**
 * 获取唯一活动列表
 * 用于活动过滤下拉框
 * 
 * @param records - 历史记录数组
 * @returns 活动列表
 */
export function getUniqueEvents(records: HistoryRecord[]): Array<{ id: number; name: string }> {
  const eventMap = new Map<number, string>();
  records.forEach((record) => {
    eventMap.set(record.eventId, record.eventName);
  });
  return Array.from(eventMap.entries()).map(([id, name]) => ({ id, name }));
}

/**
 * 获取唯一场次列表
 * 用于场次过滤下拉框
 * 
 * @param records - 历史记录数组
 * @param eventId - 可选的活动ID过滤
 * @returns 场次列表
 */
export function getUniqueSessions(records: HistoryRecord[], eventId?: number): Array<{ id: number; name: string }> {
  const sessionMap = new Map<number, string>();
  records.forEach((record) => {
    if (!eventId || record.eventId === eventId) {
      sessionMap.set(record.sessionId, record.sessionName);
    }
  });
  return Array.from(sessionMap.entries()).map(([id, name]) => ({ id, name }));
}

// ========== 设置管理 ==========

/** localStorage 存储键名 */
const SETTINGS_KEY = 'fortunemusic_history_settings';

/**
 * 获取历史面板设置
 * 从 localStorage 读取，失败则返回默认值
 * 
 * @returns 设置对象
 */
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

/**
 * 保存历史面板设置
 * 保存到 localStorage
 * 
 * @param settings - 设置对象
 */
export function saveSettings(settings: HistorySettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * 获取默认设置
 * 
 * @returns 默认设置对象
 */
export function defaultSettings(): HistorySettings {
  return {
    autoSave: true,       // 默认开启自动保存
    playbackSpeed: 1,     // 默认播放速度 1x
    retentionDays: 7,     // 默认保留 7 天
  };
}