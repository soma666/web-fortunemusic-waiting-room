/**
 * App.tsx - 主应用组件
 * 
 * Sidebar + Main 布局，支持桌面端可调整侧边栏和移动端覆盖式侧边栏。
 */

import { fetchEvents, type Session, type Event, type Member } from "@/api/fortunemusic/events";
import { fetchWaitingRooms, type WaitingRoom } from "@/api/fortunemusic/waitingRooms";
import { useCallback, useEffect, useRef, useState } from "react";
import { SessionSelector } from "@/components/SessionSelector";
import { findNearestEvent } from "@/lib/aggregator";
import { EventCard } from "@/components/EventCard";
import { StatsBar } from "@/components/StatsBar";
import { WaitingRoomGrid } from "@/components/WaitingRoomGrid";
import { Sidebar } from "@/components/Sidebar";
import { saveBatchHistoryRecords } from "@/lib/history-api";
import type { HistoryBatchRecord } from "@/lib/history-types";
import { HistoryPanel } from "@/components/HistoryPanel";
import { REFRESH_INTERVAL_MS, POLL_CHECK_INTERVAL_MS } from "@/lib/constants";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Menu, X } from 'lucide-react';

import "./index.css";

const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 300;
const REFRESH_INTERVAL = 10; // seconds

function extractMembers(sessions: Map<number, Session>): Map<string, Member> {
  let members = new Map<string, Member>();
  sessions.forEach((session) => {
    session.members.forEach((member, memberId) => {
      members.set(memberId, member);
    });
  });
  return members;
}

function calculateTotalWaitingPeople(waitingRooms: Map<number, WaitingRoom[]>): number {
  let total = 0;
  waitingRooms.forEach((rooms) => {
    rooms.forEach((room) => {
      total += room.peopleCount;
    });
  });
  return total;
}

export function App() {
  const isMobile = useIsMobile();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDragging = useRef(false);

  // ========== Sidebar resize logic ==========
  const handleDragStart = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (isMobile) return;

    const handleMove = (clientX: number) => {
      if (!isDragging.current) return;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, clientX));
      setSidebarWidth(newWidth);
    };

    const handleEnd = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', onTouchMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isMobile]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, sidebarOpen]);

  // ========== Data state ==========
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Map<number, Event[]>>(new Map());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<Map<number, Session>>(new Map());
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [waitingRooms, setWaitingRooms] = useState<Map<number, WaitingRoom[]>>(new Map());
  const [totalWaitingPeople, setTotalWaitingPeople] = useState<number>(0);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [nextRefreshTime, setNextRefreshTime] = useState<Date>(new Date(Date.now() + REFRESH_INTERVAL_MS));
  const nextRefreshTimeRef = useRef<Date>(nextRefreshTime);
  const [refreshCountdown, setRefreshCountdown] = useState<number>(REFRESH_INTERVAL);
  const [showHistory, setShowHistory] = useState(false);

  // ========== Initial data load ==========
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        let current = new Date();
        let events = await fetchEvents();
        setEvents(events);
        let defaultEvent = findNearestEvent(events, current)!;
        setSelectedEvent(defaultEvent);
        setSessions(defaultEvent.sessions);
        let k = defaultEvent.sessions.keys().next().value!;
        let defaultSessions = defaultEvent.sessions.get(k)!;
        setSelectedSession(defaultSessions);
        let existedMembers = extractMembers(defaultEvent.sessions);
        setMembers(existedMembers);
        let wr = await fetchWaitingRooms(defaultSessions.id);
        if (wr.message) { setNotice(wr.message); } else { setNotice(null); }
        setWaitingRooms(wr.waitingRooms);
        setTotalWaitingPeople(calculateTotalWaitingPeople(wr.waitingRooms));
        setLastUpdate(new Date());
        const nextTime = new Date(Date.now() + REFRESH_INTERVAL_MS);
        setNextRefreshTime(nextTime);
        nextRefreshTimeRef.current = nextTime;
        setRefreshCountdown(REFRESH_INTERVAL);
      } catch (err) {
        console.error("Failed to load events:", err);
        setError(err instanceof Error ? err.message : "Failed to load events");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // ========== Refresh waiting rooms ==========
  const refreshWaitingRooms = useCallback(async (sessionId?: number) => {
    const targetSessionId = sessionId || selectedSession?.id;
    if (!targetSessionId) return;

    try {
      const wr = await fetchWaitingRooms(targetSessionId);
      if (wr.message) { setNotice(wr.message); } else { setNotice(null); }
      setWaitingRooms(wr.waitingRooms);
      setTotalWaitingPeople(calculateTotalWaitingPeople(wr.waitingRooms));

      const records: HistoryBatchRecord[] = [];
      wr.waitingRooms.forEach((rooms, sid) => {
        rooms.forEach((room) => {
          const member = members.get(room.ticketCode);
          records.push({
            memberId: room.ticketCode,
            memberName: member?.name || room.ticketCode,
            memberAvatar: member?.thumbnailUrl,
            eventId: selectedEvent?.id || 0,
            eventName: selectedEvent?.name || '',
            sessionId: sid,
            sessionName: selectedSession?.name || '',
            waitingCount: room.peopleCount,
            waitingTime: room.waitingTime,
            avgWaitTime: room.peopleCount > 0 ? Math.floor(room.waitingTime / room.peopleCount) : 0,
          });
        });
      });

      if (records.length > 0) {
        // Only save when the event session is currently active (between startTime and endTime)
        const now = new Date();
        const isSessionActive = selectedSession
          && now >= selectedSession.startTime
          && now <= selectedSession.endTime;

        if (isSessionActive) {
          const nonZero = records.filter(r => r.waitingCount > 0 || r.waitingTime > 0);
          console.log(`[DIAG] Session active, saving ${records.length} records (${nonZero.length} non-zero)`);

          // Use event date to determine storage day, preventing cross-midnight misclassification
          const eventDay = selectedEvent?.date
            ? `${selectedEvent.date.getFullYear()}-${String(selectedEvent.date.getMonth() + 1).padStart(2, '0')}-${String(selectedEvent.date.getDate()).padStart(2, '0')}`
            : undefined;
          const saved = await saveBatchHistoryRecords(records, eventDay);
          if (!saved) console.warn("Failed to save history records");
        } else {
          console.log(`[DIAG] Session not active, skipping save (now=${now.toISOString()}, start=${selectedSession?.startTime?.toISOString()}, end=${selectedSession?.endTime?.toISOString()})`);
        }
      }

      setLastUpdate(new Date());
      const nextTime = new Date(Date.now() + REFRESH_INTERVAL_MS);
      setNextRefreshTime(nextTime);
      nextRefreshTimeRef.current = nextTime;
      setRefreshCountdown(REFRESH_INTERVAL);
    } catch (err) {
      console.error("Failed to refresh waiting rooms:", err);
    }
  }, [selectedSession?.id, selectedEvent?.id, selectedEvent?.name, selectedSession?.name, members]);

  // ========== Event selection (sidebar) ==========
  const handleEventSelect = useCallback((uniqueId: string) => {
    let foundEvent: Event | null = null;
    events.forEach((eventList: Event[]) => {
      const event = eventList.find((e: Event) => e.uniqueId === uniqueId);
      if (event) foundEvent = event;
    });

    if (foundEvent) {
      const selectedEventData: Event = foundEvent;
      setSelectedEvent(selectedEventData);
      setSessions(selectedEventData.sessions);
      const updatedMembers = extractMembers(selectedEventData.sessions);
      setMembers(updatedMembers);
      const firstSessionKey = selectedEventData.sessions.keys().next().value;
      if (firstSessionKey !== undefined) {
        const firstSession = selectedEventData.sessions.get(firstSessionKey);
        if (firstSession) setSelectedSession(firstSession);
      }
    }
  }, [events]);

  const handleEventSelectMobile = useCallback((uniqueId: string) => {
    handleEventSelect(uniqueId);
    if (isMobile) setSidebarOpen(false);
  }, [handleEventSelect, isMobile]);

  const handleSessionSelect = useCallback((sessionId: number) => {
    setSelectedSession(sessions.get(sessionId) || null);
  }, [sessions]);

  // ========== Session change → refresh ==========
  useEffect(() => {
    if (selectedSession && !loading) {
      refreshWaitingRooms(selectedSession.id);
    }
  }, [selectedSession?.id]);

  // ========== Auto-refresh countdown ==========
  useEffect(() => {
    if (loading || !selectedSession) return;

    const interval = setInterval(() => {
      const now = new Date();
      if (now >= nextRefreshTimeRef.current) {
        refreshWaitingRooms();
      } else {
        const remaining = Math.max(0, Math.ceil((nextRefreshTimeRef.current.getTime() - now.getTime()) / 1000));
        setRefreshCountdown(remaining);
      }
    }, POLL_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loading, selectedSession, refreshWaitingRooms]);

  // ========== Render ==========
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile: overlay sidebar + backdrop */}
      {isMobile && (
        <>
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={`fixed inset-y-0 left-0 z-50 w-[280px] transform transition-transform duration-200 ease-in-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar
              events={events}
              activeEventId={selectedEvent?.uniqueId}
              onEventSelect={handleEventSelectMobile}
              width={280}
              onOpenHistory={() => { setSidebarOpen(false); setShowHistory(true); }}
            />
          </div>
        </>
      )}

      {/* Desktop: sidebar + resize handle */}
      {!isMobile && (
        <>
          <Sidebar
            events={events}
            activeEventId={selectedEvent?.uniqueId}
            onEventSelect={handleEventSelect}
            width={sidebarWidth}
            onOpenHistory={() => setShowHistory(true)}
          />
          <div
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
            className="shrink-0 w-1 cursor-col-resize bg-border hover:bg-accent/25 active:bg-accent/40 transition-colors"
          />
        </>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center overflow-y-auto bg-bg-primary">
        {/* Mobile top bar */}
        {isMobile && (
          <div className="sticky top-0 z-30 flex items-center w-full px-4 py-3 bg-bg-secondary border-b border-border">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="flex items-center justify-center w-11 h-11 rounded-lg bg-bg-card border border-border cursor-pointer"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X size={20} className="text-text-primary" /> : <Menu size={20} className="text-text-primary" />}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 lg:mx-8 mt-4 lg:mt-8 p-4 rounded-lg bg-error-bg border border-error text-error">
            <p className="font-semibold">Error loading events:</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mx-4 lg:mx-8 mt-4 lg:mt-8 p-4">
            <p className="text-text-muted">Loading events...</p>
          </div>
        )}

        {/* Notice */}
        {notice && (
          <div className="mx-4 lg:mx-8 mt-4 lg:mt-6 p-3 rounded-lg text-sm bg-active-bg border border-accent/25 text-accent">
            {notice}
          </div>
        )}

        {/* Event Card */}
        <div className="px-4 lg:px-12 pt-4 lg:pt-8 w-full max-w-[1100px]">
          <EventCard
            name={selectedEvent?.name || ''}
            date={selectedEvent?.date}
          />
        </div>

        {/* Grid Section */}
        <div className="flex-1 flex flex-col items-center gap-3 lg:gap-4 px-3 lg:px-8 py-4 lg:py-6 mt-3 lg:mt-6 w-full max-w-[1100px]">
          {/* Session + Stats row */}
          <div className="flex flex-col-reverse lg:flex-row items-center lg:justify-between gap-2 w-full max-w-[1030px]">
            <SessionSelector
              id={selectedSession?.id || null}
              sessions={sessions}
              onSessionSelect={handleSessionSelect}
            />
            <StatsBar
              session={selectedSession}
              participant={totalWaitingPeople}
              refreshCountdown={refreshCountdown}
            />
          </div>

          {/* Waiting Room Grid */}
          <WaitingRoomGrid
            currentSessionID={selectedSession?.id || 0}
            waitingRooms={waitingRooms}
            members={members}
          />
        </div>
      </main>

      {/* History Panel */}
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