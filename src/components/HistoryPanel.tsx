/**
 * HistoryPanel.tsx - 历史数据面板组件
 * 
 * 显示历史排队数据的弹窗面板。
 * 主要功能：
 * 1. 图表视图 - 使用 Recharts 展示时间序列数据
 * 2. 卡片视图 - 显示各成员的统计数据
 * 3. 列表视图 - 详细的数据列表
 * 4. 播放功能 - 自动播放时间轴
 * 5. 数据导入/导出
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { HistoryChart } from './HistoryChart';
import {
  fetchHistory,
  saveBatchHistoryRecords,
  deleteHistory,
  calculateChartData,
  calculateMemberStats,
  calculateSummary,
  getUniqueEvents,
  getUniqueSessions,
  getSettings,
  saveSettings,
} from '@/lib/history-api';
import type { HistorySettings, HistoryRecord, MemberStats } from '@/lib/history-types';
import { CHART_COLORS } from '@/lib/constants';
import { format } from 'date-fns';

/** 播放速度选项 */
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

// ========== 组件接口 ==========

interface HistoryPanelProps {
  isOpen: boolean;                                  // 是否打开面板
  onClose: () => void;                              // 关闭回调
  members: Map<string, { name: string; avatar?: string }>;  // 成员映射
  eventInfo?: { id: number; name: string };         // 当前活动信息
  sessionInfo?: { id: number; name: string };       // 当前场次信息
}

// ========== 主组件 ==========

export function HistoryPanel({
  isOpen,
  onClose,
  members,
  eventInfo,
  sessionInfo,
}: HistoryPanelProps) {
  // ========== 状态定义 ==========
  
  /** 历史记录数据 */
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  /** 加载状态 */
  const [loading, setLoading] = useState(false);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);

  /** 选中的成员ID列表 */
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  /** 是否显示成员选择器 */
  const [showMemberSelector, setShowMemberSelector] = useState(false);
  /** 活动过滤ID */
  const [filterEventId, setFilterEventId] = useState<number | undefined>();
  /** 场次过滤ID */
  const [filterSessionId, setFilterSessionId] = useState<number | undefined>();

  /** 当前播放位置索引 */
  const [currentIndex, setCurrentIndex] = useState(0);
  /** 是否正在播放 */
  const [isPlaying, setIsPlaying] = useState(false);
  /** 播放定时器引用 */
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Y轴显示模式 */
  const [yAxisMode, setYAxisMode] = useState<'waitingCount' | 'waitingTime' | 'avgWaitingTime'>('waitingCount');
  /** 视图模式 */
  const [viewMode, setViewMode] = useState<'chart' | 'cards' | 'list'>('chart');
  /** 面板设置 */
  const [settings, setSettings] = useState<HistorySettings>(getSettings());

  // ========== 数据加载 ==========
  
  /**
   * 加载历史数据
   * 根据过滤条件从 API 获取数据
   */
  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory({
        eventId: filterEventId,
        sessionId: filterSessionId,
        memberIds: selectedMemberIds.length > 0 ? selectedMemberIds : undefined,
      });
      setRecords(data);
      // 默认定位到最新数据
      setCurrentIndex(data.length > 0 ? data.length - 1 : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [filterEventId, filterSessionId, selectedMemberIds]);

  // 面板打开时加载数据
  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  // ========== 派生数据 ==========
  
  /** 图表数据（根据选中的成员和Y轴模式计算） */
  const chartData = useMemo(() => {
    return calculateChartData(records, selectedMemberIds, yAxisMode);
  }, [records, selectedMemberIds, yAxisMode]);

  /** 成员统计数据 */
  const memberStats = useMemo(() => {
    return calculateMemberStats(records);
  }, [records]);

  /** 数据摘要 */
  const summary = useMemo(() => {
    return calculateSummary(records);
  }, [records]);

  /** 可选的活动列表 */
  const availableEvents = useMemo(() => {
    return getUniqueEvents(records);
  }, [records]);

  /** 可选的场次列表 */
  const availableSessions = useMemo(() => {
    return getUniqueSessions(records, filterEventId);
  }, [records, filterEventId]);

  /** 选中的成员信息（包含颜色） */
  const selectedMembers = useMemo(() => {
    return selectedMemberIds.map((id, index) => ({
      id,
      name: members.get(id)?.name || id,
      avatar: members.get(id)?.avatar,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [selectedMemberIds, members]);

  // ========== 播放控制 ==========
  
  /**
   * 切换播放状态
   * 播放时自动推进时间轴，30秒完成整个时间轴
   */
  const togglePlayback = useCallback(() => {
    if (chartData.length <= 1) return;

    // 始终先清理旧定时器，防止竞争条件
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    if (isPlaying) {
      // 停止播放
      setIsPlaying(false);
    } else {
      // 开始播放
      if (currentIndex >= chartData.length - 1) {
        setCurrentIndex(0);  // 从头开始
      }
      setIsPlaying(true);
      
      // 计算播放间隔（30秒完成整个时间轴）
      const intervalMs = 30000 / chartData.length / settings.playbackSpeed;

      playIntervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= chartData.length - 1) {
            // 播放完成
            if (playIntervalRef.current) {
              clearInterval(playIntervalRef.current);
              playIntervalRef.current = null;
            }
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
  }, [chartData.length, currentIndex, isPlaying, settings.playbackSpeed]);

  // ========== 设置管理 ==========
  
  /**
   * 更新设置
   */
  const handleSettingsChange = (newSettings: Partial<HistorySettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    saveSettings(updated);
  };

  /**
   * 删除旧数据
   * 根据保留天数设置删除过期数据
   */
  const handleDeleteOld = async () => {
    const daysAgo = settings.retentionDays * 24 * 60 * 60 * 1000;
    const beforeTimestamp = Date.now() - daysAgo;
    const deleted = await deleteHistory({ beforeTimestamp });
    if (deleted > 0) {
      loadHistory();
    }
  };

  // ========== 导入/导出 ==========
  
  /**
   * 导出历史数据为 JSON 文件
   */
  const handleExport = () => {
    const data = JSON.stringify(records, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 导入历史数据
   */
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = e.target?.result as string;
        const imported = JSON.parse(json) as HistoryRecord[];
        if (!Array.isArray(imported) || imported.length === 0) {
          alert('导入文件为空或格式不正确');
          return;
        }
        // 将导入的数据写入后端
        const saved = await saveBatchHistoryRecords(
          imported.map((r) => ({
            memberId: r.memberId,
            memberName: r.memberName,
            memberAvatar: r.memberAvatar,
            eventId: r.eventId,
            eventName: r.eventName,
            sessionId: r.sessionId,
            sessionName: r.sessionName,
            waitingCount: r.waitingCount,
            waitingTime: r.waitingTime,
          }))
        );
        if (saved) {
          await loadHistory();
        } else {
          alert('导入数据保存失败');
        }
      } catch {
        alert('Invalid file format');
      }
    };
    reader.readAsText(file);
    event.target.value = '';  // 重置 input
  };

  // ========== 渲染 ==========
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <CardHeader className="flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle>历史数据面板</CardTitle>
            <Button variant="outline" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>

          {/* 数据摘要 */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              成员数: {summary.memberCount}
            </Badge>
            <Badge variant="secondary">
              记录数: {summary.recordCount}
            </Badge>
            {summary.timeRange.start && (
              <Badge variant="secondary">
                {format(new Date(summary.timeRange.start), 'MM-dd HH:mm')} ~{' '}
                {summary.timeRange.end ? format(new Date(summary.timeRange.end!), 'MM-dd HH:mm') : '-'}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col overflow-hidden">
          {/* 工具栏 */}
          <div className="flex-shrink-0 flex flex-wrap items-center gap-4 mb-4">
            {/* 视图切换 */}
            <div className="flex items-center gap-2">
              <span className="text-sm">视图:</span>
              <div className="flex gap-1">
                {(['chart', 'cards', 'list'] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant={viewMode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode(mode)}
                  >
                    {mode === 'chart' ? '图表' : mode === 'cards' ? '卡片' : '列表'}
                  </Button>
                ))}
              </div>
            </div>

            {/* Y轴模式选择 */}
            <div className="flex items-center gap-2">
              <span className="text-sm">Y轴:</span>
              <Select
                value={yAxisMode}
                onValueChange={(v) => setYAxisMode(v as typeof yAxisMode)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="waitingCount">排队人数</SelectItem>
                  <SelectItem value="waitingTime">等候时间</SelectItem>
                  <SelectItem value="avgWaitingTime">平均等候时间</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 播放速度选择 */}
            <div className="flex items-center gap-2">
              <span className="text-sm">速度:</span>
              <Select
                value={settings.playbackSpeed.toString()}
                onValueChange={(v) => handleSettingsChange({ playbackSpeed: parseFloat(v) })}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAYBACK_SPEEDS.map((speed) => (
                    <SelectItem key={speed} value={speed.toString()}>
                      {speed}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 自动保存开关 */}
            <div className="flex items-center gap-2">
              <Switch
                checked={settings.autoSave}
                onCheckedChange={(checked) => handleSettingsChange({ autoSave: checked })}
              />
              <span className="text-sm">自动保存</span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex-shrink-0 flex items-center gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={() => setShowMemberSelector(!showMemberSelector)}>
              选择成员 ({selectedMemberIds.length})
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeleteOld}>
              清理旧数据
            </Button>
          </div>

          {/* 成员选择器 */}
          {showMemberSelector && (
            <div className="flex-shrink-0 p-3 bg-muted rounded-lg max-h-32 overflow-auto mb-4">
              <div className="flex flex-wrap gap-2">
                {Array.from(members.entries()).map(([id, member]) => (
                  <Button
                    key={id}
                    variant={selectedMemberIds.includes(id) ? 'default' : 'secondary'}
                    size="sm"
                    onClick={() => {
                      setSelectedMemberIds((prev) =>
                        prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
                      );
                    }}
                  >
                    {member.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* 播放控制（仅图表和卡片视图显示） */}
          {viewMode !== 'list' && chartData.length > 0 && (
            <div className="flex-shrink-0 flex items-center gap-3 mb-4">
              <Button variant="outline" size="sm" onClick={togglePlayback} disabled={chartData.length <= 1}>
                {isPlaying ? '暂停' : '播放'}
              </Button>
              <input
                type="range"
                min={0}
                max={chartData.length - 1}
                value={currentIndex}
                onChange={(e) => setCurrentIndex(parseInt(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-mono w-20">
                {chartData[currentIndex]?.time || '-'}
              </span>
            </div>
          )}

          {/* 主内容区域 */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                加载中...
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-red-500">
                {error}
              </div>
            ) : viewMode === 'chart' ? (
              /* 图表视图 */
              <div className="h-full">
                <HistoryChart
                  data={chartData}
                  selectedMembers={selectedMembers}
                  currentIndex={currentIndex}
                  yAxisMode={yAxisMode}
                />
              </div>
            ) : viewMode === 'cards' ? (
              /* 卡片视图 */
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {memberStats.map((stat) => (
                  <Card key={`${stat.memberId}-${stat.sessionId}`} className="p-4">
                    <div className="font-semibold mb-2">{stat.memberName}</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">峰值:</span>
                        <span className="font-mono">{stat.peakWaitingCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">平均:</span>
                        <span className="font-mono">{stat.avgWaitingCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">最小:</span>
                        <span className="font-mono">{stat.minWaitingCount}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              /* 列表视图 */
              <div className="space-y-4">
                {memberStats.map((stat) => (
                  <Card key={`${stat.memberId}-${stat.sessionId}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">{stat.memberName}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">峰值人数</div>
                          <div className="text-xl font-mono">{stat.peakWaitingCount}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">平均人数</div>
                          <div className="text-xl font-mono">{stat.avgWaitingCount}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">数据点</div>
                          <div className="text-xl font-mono">{stat.dataPoints}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* 底部操作栏 */}
          <div className="flex-shrink-0 flex items-center justify-between gap-4 pt-4 border-t mt-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                导出
              </Button>
              <input
                id="import-input"
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
              <Button variant="outline" size="sm" onClick={() => document.getElementById('import-input')?.click()}>
                导入
              </Button>
              <Button variant="outline" size="sm" onClick={loadHistory}>
                刷新
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}