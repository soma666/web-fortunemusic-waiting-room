/**
 * history-types.ts - 历史数据类型定义
 * 
 * 定义历史记录相关的 TypeScript 类型。
 * 用于前端和后端 API 的数据交换。
 */

/**
 * 历史记录 - 完整记录结构（包含 ID 和时间戳）
 * 存储在 Vercel KV 中的数据格式
 */
export interface HistoryRecord {
  id: string;                  // 记录唯一标识
  memberId: string;            // 成员票务代码
  memberName: string;          // 成员名称
  memberAvatar?: string;       // 成员头像 URL
  eventId: number;             // 活动ID
  eventName: string;           // 活动名称
  sessionId: number;           // 场次ID
  sessionName: string;         // 场次名称
  timestamp: number;           // 记录时间戳（毫秒）
  waitingCount: number;        // 排队人数
  waitingTime: number;         // 等候时间（秒）
}

/**
 * 批量历史记录 - 用于批量保存
 * 不包含 id 和 timestamp（由后端生成）
 */
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

/**
 * 历史记录过滤条件
 * 用于查询历史数据
 */
export interface HistoryFilter {
  eventId?: number;            // 按活动ID过滤
  sessionId?: number;          // 按场次ID过滤
  memberIds?: string[];        // 按成员ID列表过滤
  startTime?: number;          // 开始时间戳
  endTime?: number;            // 结束时间戳
}

/**
 * 历史数据摘要
 * 用于显示统计信息
 */
export interface HistorySummary {
  memberCount: number;         // 成员数量
  recordCount: number;         // 记录数量
  eventCount: number;          // 活动数量
  sessionCount: number;        // 场次数量
  timeRange: { 
    start: number | null;      // 最早记录时间
    end: number | null;        // 最新记录时间
  };
}

/**
 * 成员统计数据
 * 用于卡片和列表视图展示
 */
export interface MemberStats {
  memberId: string;
  memberName: string;
  memberAvatar?: string;
  eventId: number;
  eventName: string;
  sessionId: number;
  sessionName: string;
  peakWaitingCount: number;    // 峰值排队人数
  minWaitingCount: number;     // 最小排队人数
  avgWaitingCount: number;     // 平均排队人数
  peakWaitingTime: number;     // 峰值等候时间
  minWaitingTime: number;      // 最小等候时间
  avgWaitingTime: number;      // 平均等候时间
  dataPoints: number;          // 数据点数量
}

/**
 * 图表数据点
 * 用于 Recharts 图表渲染
 */
export interface ChartDataPoint {
  time: string;                // 显示时间（格式化后）
  timestamp: number;           // 原始时间戳
  [memberId: string]: string | number | null;  // 各成员的数值
}

/**
 * 历史面板设置
 * 保存在 localStorage 中
 */
export interface HistorySettings {
  autoSave: boolean;           // 是否自动保存
  playbackSpeed: number;       // 播放速度倍数
  retentionDays: number;       // 数据保留天数
}