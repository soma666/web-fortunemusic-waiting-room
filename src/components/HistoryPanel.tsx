import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { 
  getHistoryData, 
  getAllTimestamps, 
  exportHistoryData, 
  importHistoryData,
  clearHistoryData,
  getHistorySummary,
  type HistoryRecord 
} from '@/lib/history';
import { type Member } from '@/api/fortunemusic/events';
import { format } from 'date-fns';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  members: Map<string, Member>;
}

export function HistoryPanel({ isOpen, onClose, members }: HistoryPanelProps) {
  const [historyData, setHistoryData] = useState<Record<string, Record<number, { waitingCount: number; waitingTime: number }>>>({});
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [selectedTimestampIndex, setSelectedTimestampIndex] = useState<number>(0);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [showMemberSelector, setShowMemberSelector] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; conflicts: number } | null>(null);
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const PLAY_DURATION_MS = 30000; // 30 seconds to play entire timeline

  // Load history data
  useEffect(() => {
    if (isOpen) {
      const data = getHistoryData();
      setHistoryData(data);
      const ts = getAllTimestamps();
      setTimestamps(ts);
      setSelectedTimestampIndex(ts.length - 1); // Default to latest
      setIsPlaying(false);
      
      // Auto-select first 3 members if none selected
      if (selectedMembers.size === 0) {
        const memberIds = Object.keys(data).slice(0, 3);
        setSelectedMembers(new Set(memberIds));
      }
    }
  }, [isOpen]);

  // Playback logic
  const startPlayback = useCallback(() => {
    if (timestamps.length <= 1) return;
    
    setIsPlaying(true);
    const intervalMs = PLAY_DURATION_MS / timestamps.length;
    
    playIntervalRef.current = setInterval(() => {
      setSelectedTimestampIndex((prev) => {
        if (prev >= timestamps.length - 1) {
          // Reached end, stop playback
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
  }, [timestamps.length]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      // If at the end, restart from beginning
      if (selectedTimestampIndex >= timestamps.length - 1) {
        setSelectedTimestampIndex(0);
      }
      startPlayback();
    }
  }, [isPlaying, selectedTimestampIndex, timestamps.length, startPlayback, stopPlayback]);

  // Handle slider drag events
  const handleSliderDragStart = () => {
    setIsDragging(true);
    stopPlayback();
  };

  const handleSliderDragEnd = () => {
    setIsDragging(false);
    // User can manually start playback again after dragging
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  // Get current timestamp
  const currentTimestamp = timestamps[selectedTimestampIndex] || 0;

  // Get data at current timestamp
  const currentData = useMemo(() => {
    return timestamps.map((ts) => {
      const dataAtTs: Record<string, { waitingCount: number; waitingTime: number }> = {};
      Object.entries(historyData).forEach(([memberId, memberHistory]) => {
        if (memberHistory[ts]) {
          dataAtTs[memberId] = memberHistory[ts];
        }
      });
      return { timestamp: ts, data: dataAtTs };
    });
  }, [timestamps, historyData]);

  // Calculate time range for timeline
  const timeRange = useMemo(() => {
    if (timestamps.length === 0) return { start: 0, end: 0 };
    return { start: timestamps[0], end: timestamps[timestamps.length - 1] };
  }, [timestamps]);

  // Format timestamp to readable time
  const formatTime = (ts: number) => {
    return format(new Date(ts), 'HH:mm:ss');
  };

  // Handle export
  const handleExport = () => {
    const data = exportHistoryData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fortunemusic-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle import
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const result = importHistoryData(json, { overwrite: false });
        setImportResult(result);
        
        // Refresh data
        const data = getHistoryData();
        setHistoryData(data);
        const ts = getAllTimestamps();
        setTimestamps(ts);
        
        // Clear result after 5 seconds
        setTimeout(() => setImportResult(null), 5000);
      } catch (error) {
        alert('导入失败: Invalid JSON format');
      }
    };
    reader.readAsText(file);
  };

  // Handle clear
  const handleClear = () => {
    if (confirm('确定要清空所有历史数据吗？此操作不可恢复。')) {
      clearHistoryData();
      setHistoryData({});
      setTimestamps([]);
    }
  };

  // Toggle member selection
  const toggleMember = (memberId: string) => {
    const newSelected = new Set(selectedMembers);
    if (newSelected.has(memberId)) {
      newSelected.delete(memberId);
    } else {
      newSelected.add(memberId);
    }
    setSelectedMembers(newSelected);
  };

  // Get member name by ID
  const getMemberName = (memberId: string) => {
    const member = members.get(memberId);
    return member?.name || memberId;
  };

  if (!isOpen) return null;

  const summary = getHistorySummary();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle>📊 历史数据面板</CardTitle>
            <Button variant="outline" size="sm" onClick={onClose}>✕ 关闭</Button>
          </div>
          
          {/* Summary */}
          <div className="text-sm text-muted-foreground mt-2">
            共 {summary.memberCount} 位成员，{summary.recordCount} 条记录
            {summary.timeRange.start && summary.timeRange.end && (
              <span className="ml-2">
                ({format(new Date(summary.timeRange.start), 'MM-dd HH:mm')} - {format(new Date(summary.timeRange.end), 'HH:mm:ss')})
              </span>
            )}
          </div>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Timeline Slider */}
          {timestamps.length > 0 && (
            <div className="flex-shrink-0">
              <div className="flex items-center gap-4">
                {/* Play/Pause Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={togglePlayback}
                  disabled={timestamps.length <= 1}
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? '⏸️' : '▶️'}
                </Button>
                
                <span className="text-sm text-muted-foreground w-16">时间轴:</span>
                <input
                  type="range"
                  min={0}
                  max={timestamps.length - 1}
                  value={selectedTimestampIndex}
                  onChange={(e) => setSelectedTimestampIndex(parseInt(e.target.value))}
                  onMouseDown={handleSliderDragStart}
                  onMouseUp={handleSliderDragEnd}
                  onTouchStart={handleSliderDragStart}
                  onTouchEnd={handleSliderDragEnd}
                  className="flex-1 cursor-pointer"
                />
                <span className="text-sm font-mono w-24 text-right">
                  {formatTime(currentTimestamp)}
                </span>
              </div>
            </div>
          )}
          
          {/* Data Display */}
          <div className="flex-1 overflow-auto">
            {selectedMembers.size === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                请选择要查看的成员
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from(selectedMembers).map((memberId) => {
                  const record = historyData[memberId]?.[currentTimestamp];
                  const allRecords = historyData[memberId] || {};
                  const hasData = Object.keys(allRecords).length > 0;
                  
                  return (
                    <Card key={memberId} className="p-4">
                      <div className="font-semibold mb-2">{getMemberName(memberId)}</div>
                      {record ? (
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">排队人数:</span>
                            <span className="font-mono">{record.waitingCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">等候时间:</span>
                            <span className="font-mono">
                              {Math.floor(record.waitingTime / 60)}:{(record.waitingTime % 60).toString().padStart(2, '0')}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {hasData ? '该时间点无数据' : '暂无历史数据'}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* Controls */}
          <div className="flex-shrink-0 flex items-center justify-between gap-4 pt-4 border-t">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowMemberSelector(!showMemberSelector)}>
                👥 选择成员 ({selectedMembers.size})
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                📥 导出
              </Button>
              <label>
                <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                <Button variant="outline" size="sm" as="span">
                  📤 导入
                </Button>
              </label>
              <Button variant="outline" size="sm" onClick={handleClear}>
                🗑️ 清空
              </Button>
            </div>
            
            {/* Import Result */}
            {importResult && (
              <div className="text-sm text-muted-foreground">
                导入完成: +{importResult.imported} 条，忽略 {importResult.skipped} 条冲突 {importResult.conflicts} 条
              </div>
            )}
          </div>
          
          {/* Member Selector */}
          {showMemberSelector && (
            <div className="flex-shrink-0 p-4 bg-muted rounded-lg max-h-40 overflow-auto">
              <div className="flex flex-wrap gap-2">
                {Object.keys(historyData).map((memberId) => (
                  <Button
                    key={memberId}
                    variant={selectedMembers.has(memberId) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleMember(memberId)}
                  >
                    {getMemberName(memberId)}
                  </Button>
                ))}
                {Object.keys(historyData).length === 0 && (
                  <span className="text-muted-foreground">暂无历史数据</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
