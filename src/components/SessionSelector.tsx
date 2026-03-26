/**
 * SessionSelector.tsx - 场次选择器组件
 * 
 * 显示当前活动的所有场次，允许用户选择查看不同场次。
 * 以单选按钮组的形式展示，支持响应式布局。
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Session } from '@/api/fortunemusic/events';

// ========== 组件接口 ==========

interface SessionSelectorProps {
  id: number | null;                      // 当前选中的场次ID
  sessions: Map<number, Session>;         // 所有场次
  onEventSelect: (eventId: number) => void;  // 选择回调
}

// ========== 主组件 ==========

/**
 * 场次选择器
 * 以单选按钮组形式展示场次列表
 */
export function SessionSelector({
  id,
  sessions,
  onEventSelect,
}: SessionSelectorProps) {
  /**
   * 获取场次显示名称
   */
  const getDisplayName = (sessionID: number) => {
    return sessions.get(sessionID)?.sessionName || "Unknown Session";
  };

  // 无场次时不显示
  if (sessions.size === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Sessions</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          {Array.from(sessions.entries()).map(([sessionID]) => (
            <label
              key={sessionID}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all min-w-[180px] ${id === sessionID
                ? 'bg-primary/10 border-primary text-primary'
                : 'border-border hover:bg-accent hover:text-accent-foreground'
                }`}
            >
              {/* 隐藏的原生单选按钮 */}
              <input
                type="radio"
                name="selectedSession"
                value={sessionID}
                checked={id === sessionID}
                onChange={() => onEventSelect(sessionID)}
                className="sr-only"
              />
              {/* 自定义单选按钮样式 */}
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${id === sessionID
                ? 'bg-primary border-primary'
                : 'border-border'
                }`}>
                {id === sessionID && (
                  <div className="w-2 h-2 bg-primary-foreground rounded-full" />
                )}
              </div>
              {/* 场次名称 */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{getDisplayName(sessionID)}</div>
              </div>
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}