/**
 * App.tsx - 主应用组件
 * 
 * 这是 FortuneMusic 等待室应用的核心组件，负责：
 * 1. 获取和管理活动事件数据
 * 2. 处理用户选择的活动/场次
 * 3. 定时刷新等待室数据
 * 4. 保存历史记录到后端
 * 5. 根据艺人切换背景图片
 */

import { fetchEvents, type Session, type Event, type Member } from "@/api/fortunemusic/events";
import { fetchWaitingRooms, type WaitingRoom, type WaitingRooms } from "@/api/fortunemusic/waitingRooms";
import { use, useEffect, useState } from "react";
import { SessionSelector } from "@/components/SessionSelector";
import { findNearestEvent } from "@/lib/aggregator";
import { EventCard } from "@/components/EventCard";
import { StatsCards } from "@/components/StatsCards";
import { WaitingRoomGrid } from "@/components/WaitingRoomGrid";
import { formatDate } from "@/utils/date";
import { saveBatchHistoryRecords } from "@/lib/history-api";
import type { HistoryBatchRecord } from "@/lib/history-types";
import { HistoryPanel } from "@/components/HistoryPanel";

import {
  Banner,
  BannerClose,
  BannerIcon,
  BannerTitle,
} from '@/components/ui/shadcn-io/banner';
import { CircleAlert } from 'lucide-react';

import "./index.css";
import nogizaka46Logo from "./assets/nogizaka46_logo.svg";
import sakurazaka46Logo from "./assets/sakurazaka46_logo.svg";
import hinatazaka46Logo from "./assets/hinatazaka46_logo.svg";
import { Navbar02 } from "./components/ui/shadcn-io/navbar-02";

/**
 * 从多个场次中提取所有成员信息
 * @param sessions - 场次映射表
 * @returns 成员映射表（key: 成员ID, value: 成员信息）
 */
function extractMembers(sessions: Map<number, Session>): Map<string, Member> {
  let members = new Map<string, Member>();
  sessions.forEach((session) => {
    session.members.forEach((member, memberId) => {
      members.set(memberId, member);
    });
  });
  return members;
}

/**
 * 计算所有等待室的总排队人数
 * @param waitingRooms - 等待室映射表
 * @returns 总排队人数
 */
function calculateTotalWaitingPeople(waitingRooms: Map<number, WaitingRoom[]>): number {
  let total = 0;
  waitingRooms.forEach((rooms) => {
    rooms.forEach((room) => {
      total += room.peopleCount;
    });
  });
  return total;
}

/**
 * 根据艺人名称获取对应的 Logo 图片 URL
 * @param artistName - 艺人名称
 * @returns Logo URL 或 null
 */
function getArtistLogo(artistName: string): string | null {
  const logoMap: Record<string, string> = {
    '乃木坂46': nogizaka46Logo,
    '櫻坂46': sakurazaka46Logo,
    '日向坂46': hinatazaka46Logo,
  };
  return logoMap[artistName] || null;
}

/**
 * 更新页面背景图片
 * 通过设置 CSS 自定义属性来切换背景
 * @param logoUrl - Logo URL 或 null（清除背景）
 */
function updateBackgroundImage(logoUrl: string | null) {
  if (logoUrl) {
    document.documentElement.style.setProperty('--background-logo', `url("${logoUrl}")`);
  } else {
    document.documentElement.style.setProperty('--background-logo', 'none');
  }
}

/**
 * 主应用组件
 */
export function App() {
  // ========== 状态定义 ==========
  
  /** 加载状态 */
  const [loading, setLoading] = useState(true);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);

  /** 所有活动事件（按事件ID分组） */
  const [events, setEvents] = useState<Map<number, Event[]>>(new Map());
  /** 当前选中的活动事件 */
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  /** 当前活动的所有场次 */
  const [sessions, setSessions] = useState<Map<number, Session>>(new Map());
  /** 当前选中的场次 */
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  /** 等待室数据（按场次ID分组） */
  const [waitingRooms, setWaitingRooms] = useState<Map<number, WaitingRoom[]>>(new Map());
  /** 总排队人数 */
  const [totalWaitingPeople, setTotalWaitingPeople] = useState<number>(0);

  /** 所有成员信息 */
  const [members, setMembers] = useState<Map<string, Member>>(new Map());

  /** 公告消息（如活动取消等通知） */
  const [notice, setNotice] = useState<string | null>(null);

  /** 上次更新时间 */
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  /** 下次刷新时间 */
  const [nextRefreshTime, setNextRefreshTime] = useState<Date>(new Date(Date.now() + 20 * 1000));
  /** 是否显示历史面板 */
  const [showHistory, setShowHistory] = useState(false);

  // ========== 初始化数据加载 ==========
  
  /**
   * 组件挂载时加载初始数据
   * 1. 获取所有活动事件
   * 2. 自动选择最近的活动
   * 3. 加载默认场次的等待室数据
   */
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        let current = new Date();
        
        // 获取所有活动事件
        let events = await fetchEvents();
        setEvents(events);
        console.log("Fetched Events:", events);

        // 自动选择最近的活动
        let defaultEvent = findNearestEvent(events, current)!
        setSelectedEvent(defaultEvent);
        setSessions(defaultEvent.sessions);

        // 选择第一个场次
        let k = defaultEvent.sessions.keys().next().value!;
        let defaultSessions = defaultEvent.sessions.get(k)!;
        setSelectedSession(defaultSessions);
        console.log("Selected Default Event:", defaultEvent);

        // 提取所有成员信息
        let existedMembers = extractMembers(defaultEvent.sessions);
        setMembers(existedMembers);
        console.log("Extracted Members:", existedMembers);

        // 获取等待室数据
        let wr = await fetchWaitingRooms(defaultSessions.id);
        if (wr.message) {
          setNotice(wr.message)
        } else {
          setNotice(null);
        };

        setWaitingRooms(wr.waitingRooms);
        setTotalWaitingPeople(calculateTotalWaitingPeople(wr.waitingRooms));
        console.log("Fetched Waiting Rooms:", wr);

        // 设置刷新时间（每20秒刷新一次）
        setLastUpdate(new Date());
        setNextRefreshTime(new Date(Date.now() + 20 * 1000));

      } catch (err) {
        console.error("Failed to load events:", err);
        setError(err instanceof Error ? err.message : "Failed to load events");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // ========== 数据刷新逻辑 ==========
  
  /**
   * 刷新等待室数据
   * 同时保存历史记录到后端存储
   * @param sessionId - 可选的场次ID，不传则使用当前选中场次
   */
  const refreshWaitingRooms = async (sessionId?: number) => {
    const targetSessionId = sessionId || selectedSession?.id;
    if (!targetSessionId) return;

    try {
      console.log("Refreshing waiting rooms at:", new Date());
      const wr = await fetchWaitingRooms(targetSessionId);

      // 更新公告消息
      if (wr.message) {
        setNotice(wr.message)
      } else {
        setNotice(null);
      };

      setWaitingRooms(wr.waitingRooms);
      setTotalWaitingPeople(calculateTotalWaitingPeople(wr.waitingRooms));
      console.log("Refreshed Waiting Rooms:", wr);

      // 构建历史记录并保存
      const records: HistoryBatchRecord[] = [];
      wr.waitingRooms.forEach((rooms, sessionId) => {
        rooms.forEach((room) => {
          const member = members.get(room.ticketCode);
          records.push({
            memberId: room.ticketCode,
            memberName: member?.name || room.ticketCode,
            memberAvatar: member?.thumbnailUrl,
            eventId: selectedEvent?.id || 0,
            eventName: selectedEvent?.name || '',
            sessionId: sessionId,
            sessionName: selectedSession?.name || '',
            waitingCount: room.peopleCount,
            waitingTime: room.waitingTime,
          });
        });
      });
      
      // 异步保存历史记录
      if (records.length > 0) {
        saveBatchHistoryRecords(records);
        console.log("Saved history records:", records.length);
      }

      // 更新刷新时间
      setLastUpdate(new Date());
      setNextRefreshTime(new Date(Date.now() + 20 * 1000));
    } catch (err) {
      console.error("Failed to refresh waiting rooms:", err);
    }
  };

  // ========== 事件选择处理 ==========
  
  /**
   * 处理导航栏中的活动选择
   * 切换活动后自动选择第一个场次
   * @param eventId - 活动ID字符串
   */
  const handleEventSelect = (eventId: string) => {
    // 在所有活动中查找匹配的事件
    let foundEvent: Event | null = null;
    events.forEach((eventList: Event[]) => {
      const event = eventList.find((e: Event) => e.id.toString() === eventId);
      if (event) {
        foundEvent = event;
      }
    });

    if (foundEvent) {
      const selectedEventData: Event = foundEvent;
      setSelectedEvent(selectedEventData);
      setSessions(selectedEventData.sessions);

      // 更新成员列表
      const updatedMembers = extractMembers(selectedEventData.sessions);
      setMembers(updatedMembers);

      // 自动选择第一个场次
      const firstSessionKey = selectedEventData.sessions.keys().next().value;
      if (firstSessionKey !== undefined) {
        const firstSession = selectedEventData.sessions.get(firstSessionKey);
        if (firstSession) {
          setSelectedSession(firstSession);
        }
      }

      console.log("Selected Event from Navbar:", selectedEventData);
      console.log("Updated Members:", updatedMembers);
    }
  };

  // ========== 副作用处理 ==========
  
  /**
   * 活动切换时更新背景图片
   */
  useEffect(() => {
    if (selectedEvent) {
      const logoFileName = getArtistLogo(selectedEvent.artistName);
      updateBackgroundImage(logoFileName);
      console.log("Background updated to:", logoFileName);
    }
  }, [selectedEvent?.id]);

  /**
   * 场次切换时刷新等待室数据
   */
  useEffect(() => {
    if (selectedSession && !loading) {
      refreshWaitingRooms(selectedSession.id);
    }
  }, [selectedSession?.id]);

  /**
   * 自动刷新定时器 - 已禁用以提高稳定性
   * 用户可通过手动刷新按钮触发刷新
   */
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     const now = new Date();
  //     if (now >= nextRefreshTime && !loading && selectedSession) {
  //       refreshWaitingRooms();
  //     }
  //   }, 5000);
  //   return () => clearInterval(interval);
  // }, [nextRefreshTime, loading, selectedSession]);

  // ========== 渲染 ==========
  
  return (
    <div className="min-h-screen relative">
      {/* 导航栏 */}
      <Navbar02 
        events={events} 
        onEventSelect={handleEventSelect}
        onOpenHistory={() => setShowHistory(true)}
      />

      {/* 主内容区域 */}
      <div className="container mx-auto px-4 md:px-6 lg:px-8 max-w-7xl">
        {/* 错误提示 */}
        {error && (
          <div className="mt-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            <p className="font-semibold">Error loading events:</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* 加载提示 */}
        {loading && (
          <div className="mt-6 p-4">
            <p className="text-muted-foreground">Loading events...</p>
          </div>
        )}

        {/* 公告横幅 */}
        {notice && (
          <div className="mt-6">
            <Banner>
              <BannerIcon icon={CircleAlert} />
              <BannerTitle>{notice}</BannerTitle>
              <BannerClose />
            </Banner>
          </div>
        )}

        {/* 活动信息卡片 */}
        <div className="mt-6">
          <EventCard
            name={selectedEvent?.name!}
            date={selectedEvent?.date ? formatDate(selectedEvent.date) : ''}
          />
        </div>

        {/* 场次选择器 */}
        <div className="mt-6">
          <SessionSelector
            id={selectedSession?.id || null}
            sessions={sessions}
            onEventSelect={(eventId: number) => {
              setSelectedSession(sessions.get(eventId) || null);
              console.log("Selected Event ID:", eventId);
            }}
          />
        </div>

        {/* 统计卡片 */}
        <div className="mt-6">
          <StatsCards
            session={selectedSession!}
            lastUpdate={lastUpdate}
            nextRefreshTime={nextRefreshTime}
            loading={loading}
            onManualRefresh={() => {
              console.log("Manual refresh triggered");
              refreshWaitingRooms();
            }}
            totalWaitingPeople={totalWaitingPeople}
          />
        </div>

        {/* 等待室网格 */}
        <div className="mt-6 mb-8">
          <WaitingRoomGrid
            currentSessionID={selectedSession?.id || 0}
            waitingRooms={waitingRooms}
            members={members}
          />
        </div>
      </div>

      {/* 历史数据面板（弹窗） */}
      <HistoryPanel
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        members={new Map(Array.from(members.entries()).map(([id, m]) => [id, { name: m.name, avatar: m.thumbnailUrl }]))}
        eventInfo={{ id: selectedEvent?.id || 0, name: selectedEvent?.name || '' }}
        sessionInfo={{ id: selectedSession?.id || 0, name: selectedSession?.name || '' }}
      />
    </div>
  );
}

export default App;