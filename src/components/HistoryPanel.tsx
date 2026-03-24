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
import { format } from 'date-fns';

const CHART_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FF8042', '#A4DE6C'];
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  members: Map<string, { name: string; avatar?: string }>;
  eventInfo?: { id: number; name: string };
  sessionInfo?: { id: number; name: string };
}

export function HistoryPanel({
  isOpen,
  onClose,
  members,
  eventInfo,
  sessionInfo,
}: HistoryPanelProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [showMemberSelector, setShowMemberSelector] = useState(false);
  const [filterEventId, setFilterEventId] = useState<number | undefined>();
  const [filterSessionId, setFilterSessionId] = useState<number | undefined>();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [yAxisMode, setYAxisMode] = useState<'waitingCount' | 'waitingTime' | 'avgWaitingTime'>('waitingCount');
  const [viewMode, setViewMode] = useState<'chart' | 'cards' | 'list'>('chart');
  const [settings, setSettings] = useState<HistorySettings>(getSettings());

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
      setCurrentIndex(data.length > 0 ? data.length - 1 : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [filterEventId, filterSessionId, selectedMemberIds]);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  const chartData = useMemo(() => {
    return calculateChartData(records, selectedMemberIds, yAxisMode);
  }, [records, selectedMemberIds, yAxisMode]);

  const memberStats = useMemo(() => {
    return calculateMemberStats(records);
  }, [records]);

  const summary = useMemo(() => {
    return calculateSummary(records);
  }, [records]);

  const availableEvents = useMemo(() => {
    return getUniqueEvents(records);
  }, [records]);

  const availableSessions = useMemo(() => {
    return getUniqueSessions(records, filterEventId);
  }, [records, filterEventId]);

  const selectedMembers = useMemo(() => {
    return selectedMemberIds.map((id, index) => ({
      id,
      name: members.get(id)?.name || id,
      avatar: members.get(id)?.avatar,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [selectedMemberIds, members]);

  const togglePlayback = useCallback(() => {
    if (chartData.length <= 1) return;

    if (isPlaying) {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
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
      loadHistory();
    }
  };

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

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const imported = JSON.parse(json) as HistoryRecord[];
        if (Array.isArray(imported)) {
          loadHistory();
        }
      } catch {
        alert('Invalid file format');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle>历史数据面板</CardTitle>
            <Button variant="outline" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>

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
          <div className="flex-shrink-0 flex flex-wrap items-center gap-4 mb-4">
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

            <div className="flex items-center gap-2">
              <Switch
                checked={settings.autoSave}
                onCheckedChange={(checked) => handleSettingsChange({ autoSave: checked })}
              />
              <span className="text-sm">自动保存</span>
            </div>
          </div>

          <div className="flex-shrink-0 flex items-center gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={() => setShowMemberSelector(!showMemberSelector)}>
              选择成员 ({selectedMemberIds.length})
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeleteOld}>
              清理旧数据
            </Button>
          </div>

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
