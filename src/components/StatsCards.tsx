/**
 * StatsCards.tsx - 统计卡片组件
 * 
 * 显示活动相关的统计信息：
 * 1. 活动计时器 - 显示距离活动开始/结束的倒计时
 * 2. 参与人数 - 当前总排队人数
 * 3. 刷新计时器 - 显示下次自动刷新时间和手动刷新按钮
 */

import { Card, CardHeader, CardTitle } from './ui/card';
import { Users, Clock } from 'lucide-react';
import type { Session } from '@/api/fortunemusic/events';
import { EventTimer } from './ui/timer-event';
import { TimerProgress } from './ui/timer-progress';

// ========== 组件接口 ==========

interface StatsCardsProps {
  session: Session;                // 当前场次信息
  lastUpdate: Date;                // 上次更新时间
  nextRefreshTime: Date;           // 下次刷新时间
  loading: boolean;                // 加载状态
  onManualRefresh: () => void;     // 手动刷新回调
  totalWaitingPeople: number;      // 总排队人数
}

// ========== 主组件 ==========

/**
 * 统计卡片组件
 * 以卡片形式展示活动状态和统计数据
 */
export function StatsCards({ session, lastUpdate, nextRefreshTime, loading, onManualRefresh, totalWaitingPeople }: StatsCardsProps) {

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
      {/* 活动计时器 */}
      {!loading && session && (
        <EventTimer
          startAt={session.startTime}
          endAt={session.endTime}
          variant="event"
        />
      )}

      {/* 总排队人数 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-card-foreground flex flex-auto items-center justify-between">
            <div className="flex items-center justify-between gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              Participants
            </div>
            <span className="text-2xl font-bold text-blue-500">
              {totalWaitingPeople.toLocaleString()}
            </span>
          </CardTitle>
        </CardHeader>
      </Card>
      
      {/* 刷新计时器 */}
      {!loading && session && (
        <TimerProgress
          targetTime={nextRefreshTime}
          startTime={lastUpdate}
          variant="refresh"
          onRefreshClick={onManualRefresh}
          eventStartTime={session.startTime}
          eventEndTime={session.endTime}
        />
      )}
    </div>
  );
}