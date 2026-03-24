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



function extractMembers(sessions: Map<number, Session>): Map<string, Member> {
  let members = new Map<string, Member>();
  sessions.forEach((session) => {
    session.members.forEach((member, memberId) => {
      members.set(memberId, member);
    });
  });
  return members;
}

// Calculate total waiting people from waiting rooms
function calculateTotalWaitingPeople(waitingRooms: Map<number, WaitingRoom[]>): number {
  let total = 0;
  waitingRooms.forEach((rooms) => {
    rooms.forEach((room) => {
      total += room.peopleCount;
    });
  });
  return total;
}

// Map artist name to logo URL
function getArtistLogo(artistName: string): string | null {
  const logoMap: Record<string, string> = {
    '乃木坂46': nogizaka46Logo,
    '櫻坂46': sakurazaka46Logo,
    '日向坂46': hinatazaka46Logo,
  };
  return logoMap[artistName] || null;
}

// Update background image
function updateBackgroundImage(logoUrl: string | null) {
  // Update CSS custom property with the imported logo URL or clear it for blank background
  if (logoUrl) {
    document.documentElement.style.setProperty('--background-logo', `url("${logoUrl}")`);
  } else {
    document.documentElement.style.setProperty('--background-logo', 'none');
  }
}



export function App() {
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
  const [nextRefreshTime, setNextRefreshTime] = useState<Date>(new Date(Date.now() + 20 * 1000));
  const [showHistory, setShowHistory] = useState(false);

  // Init Events Data (only once on mount)
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        let current = new Date();
        let events = await fetchEvents();
        setEvents(events);
        console.log("Fetched Events:", events);

        let defaultEvent = findNearestEvent(events, current)!
        setSelectedEvent(defaultEvent);
        setSessions(defaultEvent.sessions);

        let k = defaultEvent.sessions.keys().next().value!;
        let defaultSessions = defaultEvent.sessions.get(k)!;
        setSelectedSession(defaultSessions);
        console.log("Selected Default Event:", defaultEvent);

        let existedMembers = extractMembers(defaultEvent.sessions);
        setMembers(existedMembers);
        console.log("Extracted Members:", existedMembers);

        let wr = await fetchWaitingRooms(defaultSessions.id);
        if (wr.message) {
          setNotice(wr.message)
        } else {
          setNotice(null);
        };

        setWaitingRooms(wr.waitingRooms);
        setTotalWaitingPeople(calculateTotalWaitingPeople(wr.waitingRooms));
        console.log("Fetched Waiting Rooms:", wr);

        // Update refresh times (every 20 seconds)
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

  // Function to refresh only waiting rooms data
  const refreshWaitingRooms = async (sessionId?: number) => {
    const targetSessionId = sessionId || selectedSession?.id;
    if (!targetSessionId) return;

    try {
      console.log("Refreshing waiting rooms at:", new Date());
      const wr = await fetchWaitingRooms(targetSessionId);

      if (wr.message) {
        setNotice(wr.message)
      } else {
        setNotice(null);
      };

      setWaitingRooms(wr.waitingRooms);
      setTotalWaitingPeople(calculateTotalWaitingPeople(wr.waitingRooms));
      console.log("Refreshed Waiting Rooms:", wr);

      // Save to history
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
      if (records.length > 0) {
        saveBatchHistoryRecords(records);
        console.log("Saved history records:", records.length);
      }

      // Update refresh times (every 20 seconds)
      setLastUpdate(new Date());
      setNextRefreshTime(new Date(Date.now() + 20 * 1000));
    } catch (err) {
      console.error("Failed to refresh waiting rooms:", err);
    }
  };

  // Handle event selection from navbar
  const handleEventSelect = (eventId: string) => {
    // Find the event with the matching ID
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

      // Extract and update members from the new event's sessions
      const updatedMembers = extractMembers(selectedEventData.sessions);
      setMembers(updatedMembers);

      // Auto-select the first session of the selected event
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

  // Update background when event changes
  useEffect(() => {
    if (selectedEvent) {
      const logoFileName = getArtistLogo(selectedEvent.artistName);
      updateBackgroundImage(logoFileName);
      console.log("Background updated to:", logoFileName);
    }
  }, [selectedEvent?.id]);

  // Fetch waiting rooms when session changes
  useEffect(() => {
    if (selectedSession && !loading) {
      refreshWaitingRooms(selectedSession.id);
    }
  }, [selectedSession?.id]);

  // Auto-refresh timer for waiting rooms only - DISABLED for stability
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     const now = new Date();
  //     if (now >= nextRefreshTime && !loading && selectedSession) {
  //       refreshWaitingRooms();
  //     }
  //   }, 5000);
  //   return () => clearInterval(interval);
  // }, [nextRefreshTime, loading, selectedSession]);

  return (
    <div className="min-h-screen relative">
      {/* Navigation Bar - Full width, no padding */}
      <Navbar02 
        events={events} 
        onEventSelect={handleEventSelect}
        onOpenHistory={() => setShowHistory(true)}
      />

      {/* Main Content Container - With appropriate padding */}
      <div className="container mx-auto px-4 md:px-6 lg:px-8 max-w-7xl">
        {/* Error Message */}
        {error && (
          <div className="mt-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            <p className="font-semibold">Error loading events:</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Loading Message */}
        {loading && (
          <div className="mt-6 p-4">
            <p className="text-muted-foreground">Loading events...</p>
          </div>
        )}

        {/* Notice Banner */}
        {notice && (
          <div className="mt-6">
            <Banner>
              <BannerIcon icon={CircleAlert} />
              <BannerTitle>{notice}</BannerTitle>
              <BannerClose />
            </Banner>
          </div>
        )}

        {/* Event Info Card */}
        <div className="mt-6">
          <EventCard
            name={selectedEvent?.name!}
            date={selectedEvent?.date ? formatDate(selectedEvent.date) : ''}
          />
        </div>

        {/* Session Selector */}
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

        {/* Stats Cards */}
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

        {/* Waiting Room Grid */}
        <div className="mt-6 mb-8">
          <WaitingRoomGrid
            currentSessionID={selectedSession?.id || 0}
            waitingRooms={waitingRooms}
            members={members}
          />
        </div>
      </div>

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