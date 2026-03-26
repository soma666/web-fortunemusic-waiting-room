/**
 * WaitingRoomGrid.tsx - 等待室网格组件
 * 
 * 显示当前场次所有成员的排队信息。
 * 以卡片网格形式展示：
 * - 成员头像和名称
 * - 排队人数（带颜色指示）
 * - 等候时间
 * - 平均等候时间（每人的平均等待时间）
 */

import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Clock } from 'lucide-react';
import { getPeopleCountColors, getWaitingTimeColors } from '@/lib/status-colors';
import { type WaitingRoom } from '@/api/fortunemusic/waitingRooms';
import { type Member } from '@/api/fortunemusic/events';

// ========== 组件接口 ==========

interface WaitingRoomGridProps {
  currentSessionID: number,                              // 当前场次ID
  waitingRooms: Map<number, WaitingRoom[]>,              // 等待室数据
  members: Map<string, Member>                           // 成员映射
}

/** 内部房间数据结构 */
interface room {
  id: string;
  order: number;
  name: string;
  thumbnailUrl: string;
  waitingCount: number;
  waitingTime: number;
  avgWaitTime: number;
}

// ========== 辅助函数 ==========

/**
 * 合并等待室数据和成员信息
 * 
 * @param currentSessionID - 当前场次ID
 * @param waitingRooms - 等待室数据
 * @param members - 成员信息
 * @returns 合并后的房间数组
 */
function joinMemberWaitingRoom(
  currentSessionID: number,
  waitingRooms: Map<number, WaitingRoom[]>,
  members: Map<string, Member>
): room[] {
  let result: room[] = [];
  
  for (let [sessionID, rooms] of waitingRooms) {
    // 只处理当前场次的数据
    if (currentSessionID === sessionID) {
      for (let room of rooms) {
        let roomId = room.ticketCode;
        if (members.has(roomId)) {
          let member = members.get(roomId)!;
          // 计算平均等候时间（等候时间 / 排队人数）
          const avgWaitTime = room.peopleCount > 0 
            ? Math.floor(room.waitingTime / room.peopleCount) 
            : 0;
          
          result.push({
            id: roomId,
            order: member.order,
            name: member.name,
            thumbnailUrl: member.thumbnailUrl,
            waitingCount: room.peopleCount,
            waitingTime: room.waitingTime,
            avgWaitTime: avgWaitTime,
          });
        }
      }
    }
  }
  return result;
}

// ========== 主组件 ==========

/**
 * 等待室网格组件
 * 以网格形式展示所有成员的排队状态
 */
export function WaitingRoomGrid({ currentSessionID, waitingRooms, members }: WaitingRoomGridProps) {
  console.log("WaitingRoomGrid Props:", { currentSessionID, waitingRooms, members });
  const rooms: room[] = joinMemberWaitingRoom(currentSessionID, waitingRooms, members);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5 gap-4">
      {rooms.map((room) => (
        <Card
          key={room.id}
          className="hover:shadow-md transition-all min-w-[200px] p-[5px]"
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between mb-2">
              {/* 成员名称 */}
              <CardTitle className="text-card-foreground text-sm truncate">{room.name}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* 排队人数 */}
            <div className="text-center mb-3">
              <div className={`text-3xl font-bold ${getPeopleCountColors(room.waitingCount).text}`}>
                {room.waitingCount}
              </div>
              <div className="text-sm text-muted-foreground">people</div>
            </div>
            
            {/* 总等候时间 */}
            <div className="text-center">
              <div className={`flex items-center justify-center gap-1 ${getWaitingTimeColors(room.waitingTime).text}`}>
                <Clock className="h-4 w-4" />
                <span className="text-lg font-semibold font-mono">
                  {(() => {
                    const totalSeconds = Math.floor(room.waitingTime);
                    const minutes = Math.floor(totalSeconds / 60);
                    const seconds = totalSeconds % 60;
                    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                  })()}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">wait time</div>
            </div>
            
            {/* 平均等候时间（每人） */}
            <div className="text-center mt-3 pt-3 border-t border-dashed">
              <div className={`flex items-center justify-center gap-1 text-sm ${room.waitingCount > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                <span className="font-semibold font-mono">
                  {room.waitingCount > 0 
                    ? (() => {
                        const totalSeconds = Math.floor(room.avgWaitTime);
                        const minutes = Math.floor(totalSeconds / 60);
                        const seconds = totalSeconds % 60;
                        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                      })()
                    : '--:--'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">avg time/person</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}