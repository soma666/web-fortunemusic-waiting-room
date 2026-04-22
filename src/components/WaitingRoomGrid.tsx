import { useMemo } from 'react';
import { Card, CardTitle } from './ui/card';
import { Clock, Users, Timer } from 'lucide-react';
import { getPeopleCountColors, getWaitingTimeColors } from '@/lib/status-colors';
import { formatMS } from '@/utils/date';
import { type WaitingRoom } from '@/api/fortunemusic/waitingRooms';
import { type Member } from '@/api/fortunemusic/events';

interface WaitingRoomGridProps {
  currentSessionID: number,
  waitingRooms: Map<number, WaitingRoom[]>,
  members: Map<string, Member>
}

interface Room {
  id: string;
  order: number;
  name: string;
  waitingCount: number;
  waitingTime: number;
  avgWaitTime: number;
}

function joinMemberWaitingRoom(
  currentSessionID: number,
  waitingRooms: Map<number, WaitingRoom[]>,
  members: Map<string, Member>
): Room[] {
  const rooms = waitingRooms.get(currentSessionID);
  if (!rooms) return [];

  const result: Room[] = [];
  for (const room of rooms) {
    const member = members.get(room.ticketCode);
    if (member) {
      const avgWaitTime = room.peopleCount > 0
        ? Math.floor(room.waitingTime / room.peopleCount)
        : 0;
      result.push({
        id: room.ticketCode,
        order: member.order,
        name: member.name,
        waitingCount: room.peopleCount,
        waitingTime: room.waitingTime,
        avgWaitTime,
      });
    }
  }
  return result.sort((left, right) => left.order - right.order);
}

export function WaitingRoomGrid({ currentSessionID, waitingRooms, members }: WaitingRoomGridProps) {
  const rooms = useMemo(
    () => joinMemberWaitingRoom(currentSessionID, waitingRooms, members),
    [currentSessionID, waitingRooms, members],
  );

  return (
    <div className="w-full grid gap-[5px] p-[5px] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
      {rooms.map((room) => (
        <Card
          key={room.id}
          className="aspect-square hover:shadow-md transition-all flex flex-col items-center justify-between p-2 lg:p-3"
        >
          <CardTitle className="text-sm truncate text-center w-full text-text-muted">{room.name}</CardTitle>
          <div className={`flex items-center justify-center gap-1 ${getPeopleCountColors(room.waitingCount).text}`}>
            <Users className="h-5 w-5" />
            <span className="text-2xl lg:text-3xl font-bold">
              {room.waitingCount}
            </span>
          </div>
          <div className={`flex items-center justify-center gap-1 ${getWaitingTimeColors(room.waitingTime).text}`}>
            <Clock className="h-4 w-4" />
            <span className="text-base lg:text-lg font-semibold font-mono">
              {formatMS(room.waitingTime)}
            </span>
          </div>
          <div className={`flex items-center justify-center gap-1 text-xs ${room.waitingCount > 0 ? 'text-status-yellow' : 'text-text-subtitle'}`}>
            <Timer className="h-3 w-3" />
            <span className="font-semibold font-mono">
              {room.waitingCount > 0 ? formatMS(room.avgWaitTime) : '--:--'}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
