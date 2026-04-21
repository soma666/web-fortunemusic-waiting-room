/**
 * HistoryPanel.tsx - 历史数据面板组件
 * 
 * 显示历史排队数据的弹窗面板，支持三层浏览：
 * 1. 日期列表 - 展示有历史数据的日期
 * 2. 活动列表 - 展示某日内的活动/场次
 * 3. 活动详情 - 图表/卡片/列表三种视图展示时间序列
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { HistoryChart } from './HistoryChart';
import {
  fetchAvailableDays,
  fetchCollectorDiag,
  fetchDayEvents,
  fetchDayDetails,
  fetchHistory,
  saveBatchHistoryRecords,
  deleteHistory,
  calculateChartData,
  calculateMemberStats,
  calculateSummary,
  getSettings,
  saveSettings,
} from '@/lib/history-api';
import type {
  HistorySettings,
  HistoryRecord,
  DaySummary,
  DayEventSummary,
  HistoryBrowsePhase,
  CollectorDiag,
} from '@/lib/history-types';
import { CHART_COLORS } from '@/lib/constants';
import { format } from 'date-fns';

/** 播放速度选项 */
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

// ========== 组件接口 ==========

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  members: Map<string, { name: string; avatar?: string }>;
  eventInfo?: { id: number; name: string };
  sessionInfo?: { id: number; name: string };
}

// ========== 主组件 ==========

export function HistoryPanel({
  isOpen,
  onClose,
  members,
  eventInfo,
  sessionInfo,
}: HistoryPanelProps) {
  // ========== 浏览层级状态 ==========

  /** 当前浏览阶段 */
  const [browsePhase, setBrowsePhase] = useState<HistoryBrowsePhase>('days');
  /** 可用日期列表 */
  const [availableDays, setAvailableDays] = useState<DaySummary[]>([]);
  /** 选中的日期 */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  /** 选中日期的活动列表 */
  const [dayEvents, setDayEvents] = useState<DayEventSummary[]>([]);
  /** 选中的活动/场次（用于详情查询） */
  const [selectedEvent, setSelectedEvent] = useState<{ eventId: number; eventName: string; sessionId: number; sessionName: string } | null>(null);

  // ========== 详情态状态（原有） ==========

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
  /** 采集器诊断信息 */
  const [collectorDiag, setCollectorDiag] = useState<CollectorDiag | null>(null);

  // ========== 数据加载 ==========

  /** 加载可用日期列表 */
  const loadDays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [days, diag] = await Promise.all([
        fetchAvailableDays(),
        fetchCollectorDiag(),
      ]);
      setAvailableDays(days);
      setCollectorDiag(diag);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取日期列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  /** 加载某日的活动列表 */
  const loadDayEvents = useCallback(async (day: string) => {
    setLoading(true);
    setError(null);
    try {
      const events = await fetchDayEvents(day);
      setDayEvents(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取活动列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  /** 加载活动详情 */
  const loadDetails = useCallback(async (day: string, eventId: number, sessionId: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDayDetails({ day, eventId, sessionId });
      setRecords(data);
      setCurrentIndex(data.length > 0 ? data.length - 1 : 0);

      // 自动选中所有出现的成员
      const memberIdSet = new Set<string>();
      data.forEach((r) => memberIdSet.add(r.memberId));
      setSelectedMemberIds(Array.from(memberIdSet));
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取详情失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 面板打开时加载日期列表
  useEffect(() => {
    if (isOpen) {
      // 重置到日期列表态
      setBrowsePhase('days');
      setSelectedDay(null);
      setSelectedEvent(null);
      setDayEvents([]);
      setRecords([]);
      setSelectedMemberIds([]);
      setShowMemberSelector(false);
      setIsPlaying(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      loadDays();
    }
  }, [isOpen, loadDays]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  // ========== 浏览导航 ==========

  /** 选择日期 → 进入活动列表 */
  const handleSelectDay = useCallback(async (day: string) => {
    setSelectedDay(day);
    setBrowsePhase('events');
    await loadDayEvents(day);
  }, [loadDayEvents]);

  /** 选择活动 → 进入详情 */
  const handleSelectEvent = useCallback(async (event: DayEventSummary) => {
    setSelectedEvent({
      eventId: event.eventId,
      eventName: event.eventName,
      sessionId: event.sessionId,
      sessionName: event.sessionName,
    });
    setBrowsePhase('details');
    await loadDetails(selectedDay!, event.eventId, event.sessionId);
  }, [selectedDay, loadDetails]);

  /** 返回日期列表 */
  const handleBackToDays = useCallback(() => {
    setBrowsePhase('days');
    setSelectedDay(null);
    setSelectedEvent(null);
    setDayEvents([]);
    setRecords([]);
    setSelectedMemberIds([]);
    setShowMemberSelector(false);
    // 停止播放
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  /** 返回活动列表 */
  const handleBackToEvents = useCallback(() => {
    setBrowsePhase('events');
    setSelectedEvent(null);
    setRecords([]);
    setSelectedMemberIds([]);
    setShowMemberSelector(false);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // ========== 详情态：派生数据 ==========

  const chartData = useMemo(() => {
    return calculateChartData(records, selectedMemberIds, yAxisMode);
  }, [records, selectedMemberIds, yAxisMode]);

  const memberStats = useMemo(() => {
    return calculateMemberStats(records);
  }, [records]);

  const summary = useMemo(() => {
    return calculateSummary(records);
  }, [records]);

  /** 详情中所有出现的成员（用于成员选择器） */
  const detailMembers = useMemo(() => {
    const map = new Map<string, { name: string; avatar?: string }>();
    records.forEach((r) => {
      if (!map.has(r.memberId)) {
        map.set(r.memberId, {
          name: members.get(r.memberId)?.name || r.memberName,
          avatar: members.get(r.memberId)?.avatar || r.memberAvatar,
        });
      }
    });
    return map;
  }, [records, members]);

  const selectedMembers = useMemo(() => {
    return selectedMemberIds.map((id, index) => ({
      id,
      name: detailMembers.get(id)?.name || id,
      avatar: detailMembers.get(id)?.avatar,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [selectedMemberIds, detailMembers]);

  // ========== 播放控制 ==========

  const togglePlayback = useCallback(() => {
    if (chartData.length <= 1) return;

    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (currentIndex >= chartData.length - 1) {
        setCurrentIndex(0);
      }
      setIsPlaying(true);

      const intervalMs = 30000 / chartData.length / settings.playbackSpeed;
      playIntervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= chartData.length - 1) {
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

  const handleSettingsChange = (newSettings: Partial<HistorySettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleDeleteOld = async () => {
    const daysAgo = settings.retentionDays * 24 * 60 * 60 * 1000;
    const beforeTimestamp = Date.now() - daysAgo;
    const deleted = await deleteHistory({ beforeTimestamp });
    if (deleted > 0) {
      // 刷新当前阶段数据
      if (browsePhase === 'days') await loadDays();
      else if (browsePhase === 'events' && selectedDay) await loadDayEvents(selectedDay);
      else if (browsePhase === 'details' && selectedDay && selectedEvent) {
        await loadDetails(selectedDay, selectedEvent.eventId, selectedEvent.sessionId);
      }
    }
  };

  // ========== 导入/导出 ==========

  const handleExport = () => {
    const data = JSON.stringify(records, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history-${selectedDay || format(new Date(), 'yyyy-MM-dd')}-${selectedEvent?.eventName || 'all'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          // 刷新日期列表
          await loadDays();
        } else {
          alert('导入数据保存失败');
        }
      } catch {
        alert('Invalid file format');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // ========== 渲染 ==========

  if (!isOpen) return null;

  /** 面包屑导航 */
  const renderBreadcrumb = () => (
    <div className="flex items-center gap-1 text-sm">
      <Button
        variant={browsePhase === 'days' ? 'default' : 'ghost'}
        size="sm"
        className="h-7 px-2"
        onClick={handleBackToDays}
      >
        日期列表
      </Button>
      {(browsePhase === 'events' || browsePhase === 'details') && selectedDay && (
        <>
          <span className="text-muted-foreground">/</span>
          <Button
            variant={browsePhase === 'events' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            onClick={handleBackToEvents}
          >
            {selectedDay}
          </Button>
        </>
      )}
      {browsePhase === 'details' && selectedEvent && (
        <>
          <span className="text-muted-foreground">/</span>
          <Badge variant="secondary" className="font-normal">
            {selectedEvent.eventName} - {selectedEvent.sessionName}
          </Badge>
        </>
      )}
    </div>
  );

  /** 日期列表视图 */
  const renderDaysList = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          加载日期列表...
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center h-full text-red-500">
          {error}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {collectorDiag && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">采集器状态</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadDays()}
                    disabled={loading}
                  >
                    刷新状态
                  </Button>
                  <Badge
                    variant={collectorDiag.status?.state === 'error' ? 'destructive' : 'secondary'}
                  >
                    {collectorDiag.status?.state === 'running'
                      ? '运行中'
                      : collectorDiag.status?.state === 'error'
                        ? '异常'
                        : '空闲'}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="text-sm text-muted-foreground">最近成功</div>
                  <div className="mt-1 text-sm font-medium">
                    {collectorDiag.lastSuccess?.finishedAt
                      ? format(new Date(collectorDiag.lastSuccess.finishedAt), 'MM-dd HH:mm:ss')
                      : '暂无'}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-sm text-muted-foreground">最近采样数</div>
                  <div className="mt-1 text-sm font-medium">
                    {collectorDiag.lastSuccess?.snapshotCount ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-sm text-muted-foreground">最近写入记录</div>
                  <div className="mt-1 text-sm font-medium">
                    {collectorDiag.lastSuccess?.totalRecords ?? 0}
                  </div>
                </div>
              </div>

              {collectorDiag.status?.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {collectorDiag.status.error}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-medium">最近采样</div>
                  <div className="space-y-2">
                    {Array.isArray(collectorDiag.snapshots) && collectorDiag.snapshots.length > 0 ? collectorDiag.snapshots.slice(0, 6).map((snapshot) => (
                      <div key={snapshot.timestamp} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                        <span className="font-mono">{format(new Date(snapshot.timestamp), 'HH:mm:ss')}</span>
                        <span className="text-muted-foreground">活动 {snapshot.events} · 场次 {snapshot.sessions} · 记录 {snapshot.records}</span>
                      </div>
                    )) : (
                      <div className="rounded-lg border p-3 text-sm text-muted-foreground">暂无采样摘要</div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">最近日志</div>
                  <div className="space-y-2">
                    {Array.isArray(collectorDiag.logs) && collectorDiag.logs.length > 0 ? collectorDiag.logs.slice(0, 6).map((log) => (
                      <div key={`${log.ts}-${log.event}`} className="rounded-lg border p-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono">{format(new Date(log.ts), 'HH:mm:ss')}</span>
                          <Badge variant={log.level === 'error' ? 'destructive' : 'outline'}>{log.level}</Badge>
                        </div>
                        <div className="mt-1 font-medium">{log.event}</div>
                        <div className="text-muted-foreground">{log.message}</div>
                      </div>
                    )) : (
                      <div className="rounded-lg border p-3 text-sm text-muted-foreground">暂无运行日志</div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {availableDays.length === 0 && (
          <div className="flex items-center justify-center rounded-lg border border-dashed p-8 text-muted-foreground">
            暂无历史数据
          </div>
        )}

        {availableDays.map((daySummary) => (
          <Card
            key={daySummary.day}
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => handleSelectDay(daySummary.day)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">{daySummary.day}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {daySummary.eventCount} 个活动 · {daySummary.sessionCount} 个场次
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant="secondary">
                    {daySummary.totalRecords} 条记录
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  /** 活动列表视图 */
  const renderEventsList = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          加载活动列表...
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center h-full text-red-500">
          {error}
        </div>
      );
    }
    if (dayEvents.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          该日无采集记录
        </div>
      );
    }

    // 按 eventId 分组展示
    const eventGroups = new Map<number, DayEventSummary[]>();
    dayEvents.forEach((ev) => {
      const group = eventGroups.get(ev.eventId) || [];
      group.push(ev);
      eventGroups.set(ev.eventId, group);
    });

    return (
      <div className="space-y-4">
        {Array.from(eventGroups.entries()).map(([eventId, sessions]) => (
          <Card key={eventId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{sessions[0].eventName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessions.map((session) => {
                const isHighlighted =
                  eventInfo?.id === session.eventId && sessionInfo?.id === session.sessionId;
                return (
                  <div
                    key={`${session.eventId}-${session.sessionId}`}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      isHighlighted
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-accent/50'
                    }`}
                    onClick={() => handleSelectEvent(session)}
                  >
                    <div>
                      <div className="font-medium">{session.sessionName}</div>
                      <div className="text-sm text-muted-foreground">
                        {session.memberCount} 名成员 · {session.recordCount} 条记录
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isHighlighted && (
                        <Badge variant="outline" className="text-xs">
                          当前
                        </Badge>
                      )}
                      <span className="text-muted-foreground text-sm">→</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  /** 详情视图（复用原有 chart/cards/list） */
  const renderDetails = () => {
    return (
      <>
        {/* 详情工具栏 */}
        <div className="flex-shrink-0 flex flex-wrap items-center gap-4 mb-4">
          {/* 数据摘要 */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">成员 {summary.memberCount}</Badge>
            <Badge variant="secondary">记录 {summary.recordCount}</Badge>
            {summary.timeRange.start && (
              <Badge variant="secondary">
                {format(new Date(summary.timeRange.start), 'HH:mm')} ~{' '}
                {summary.timeRange.end ? format(new Date(summary.timeRange.end!), 'HH:mm') : '-'}
              </Badge>
            )}
          </div>

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
        </div>

        {/* 成员选择器 */}
        <div className="flex-shrink-0 flex items-center gap-2 mb-4">
          <Button variant="outline" size="sm" onClick={() => setShowMemberSelector(!showMemberSelector)}>
            选择成员 ({selectedMemberIds.length}/{detailMembers.size})
          </Button>
        </div>

        {showMemberSelector && (
          <div className="flex-shrink-0 p-3 bg-muted rounded-lg max-h-32 overflow-auto mb-4">
            <div className="flex flex-wrap gap-2">
              {Array.from(detailMembers.entries()).map(([id, member]) => (
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
          ) : records.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              该活动当天暂无快照
            </div>
          ) : viewMode === 'chart' ? (
            <div className="h-full">
              <HistoryChart
                data={chartData}
                selectedMembers={selectedMembers}
                currentIndex={currentIndex}
                yAxisMode={yAxisMode}
              />
            </div>
          ) : viewMode === 'cards' ? (
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
      </>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <CardHeader className="flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle>历史数据</CardTitle>
            <Button variant="outline" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>

          {/* 面包屑导航 */}
          {renderBreadcrumb()}
        </CardHeader>

        <CardContent className="flex-1 flex flex-col overflow-hidden">
          {/* 主内容：按阶段渲染 */}
          <div className="flex-1 overflow-auto">
            {browsePhase === 'days' && renderDaysList()}
            {browsePhase === 'events' && renderEventsList()}
            {browsePhase === 'details' && renderDetails()}
          </div>

          {/* 底部操作栏 */}
          <div className="flex-shrink-0 flex items-center justify-between gap-4 pt-4 border-t mt-4">
            <div className="flex gap-2">
              {browsePhase === 'details' && (
                <Button variant="outline" size="sm" onClick={handleExport}>
                  导出
                </Button>
              )}
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
              <Button variant="outline" size="sm" onClick={handleDeleteOld}>
                清理旧数据
              </Button>
              {browsePhase === 'days' && (
                <Button variant="outline" size="sm" onClick={loadDays}>
                  刷新
                </Button>
              )}
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
        </CardContent>
      </Card>
    </div>
  );
}