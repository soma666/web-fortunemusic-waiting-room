import { describe, expect, test } from "bun:test";
import type { Event, Session } from "../api/fortunemusic/events";
import { findNearestEvent, findNearestSession } from "./aggregator";

function createSession(id: number, start: string, end: string): Session {
  return {
    id,
    name: `Session ${id}`,
    sessionName: `Session ${id}`,
    startTime: new Date(start),
    endTime: new Date(end),
    members: new Map(),
  };
}

function createEvent(id: number, sessions: Session[]): Event {
  return {
    id,
    uniqueId: String(id),
    name: `Event ${id}`,
    artistName: "Artist",
    photoUrl: "",
    date: sessions[0]?.startTime ?? new Date("2026-01-01T00:00:00.000Z"),
    sessions: new Map(sessions.map((session) => [session.id, session])),
  };
}

describe("findNearestSession", () => {
  test("prefers the active session over earlier sessions on the same day", () => {
    const morning = createSession(1, "2026-04-22T01:00:00.000Z", "2026-04-22T02:00:00.000Z");
    const afternoon = createSession(2, "2026-04-22T05:00:00.000Z", "2026-04-22T06:00:00.000Z");
    const event = createEvent(1, [morning, afternoon]);

    const selected = findNearestSession(event, new Date("2026-04-22T05:30:00.000Z"));

    expect(selected?.id).toBe(2);
  });

  test("falls back to the closest upcoming session when nothing is active", () => {
    const morning = createSession(1, "2026-04-22T01:00:00.000Z", "2026-04-22T02:00:00.000Z");
    const evening = createSession(2, "2026-04-22T09:00:00.000Z", "2026-04-22T10:00:00.000Z");
    const event = createEvent(1, [morning, evening]);

    const selected = findNearestSession(event, new Date("2026-04-22T06:00:00.000Z"));

    expect(selected?.id).toBe(2);
  });
});

describe("findNearestEvent", () => {
  test("selects the event that has a currently active session", () => {
    const earlyEvent = createEvent(1, [
      createSession(11, "2026-04-22T01:00:00.000Z", "2026-04-22T02:00:00.000Z"),
    ]);
    const activeEvent = createEvent(2, [
      createSession(21, "2026-04-22T05:00:00.000Z", "2026-04-22T06:00:00.000Z"),
    ]);

    const eventMap = new Map<number, Event[]>([
      [earlyEvent.id, [earlyEvent]],
      [activeEvent.id, [activeEvent]],
    ]);

    const selected = findNearestEvent(eventMap, new Date("2026-04-22T05:30:00.000Z"));

    expect(selected?.id).toBe(2);
  });
});
