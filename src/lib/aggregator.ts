import type { Event, Session } from "@/api/fortunemusic/events";

function getSessionDistance(session: Session, targetTime: Date): number {
    const target = targetTime.getTime();
    const start = session.startTime.getTime();
    const end = session.endTime.getTime();

    if (target < start) {
        return start - target;
    }
    if (target > end) {
        return target - end;
    }
    return 0;
}

export function findNearestSession(event: Event, targetTime: Date): Session | null {
    let nearestSession: Session | null = null;
    let smallestTimeDiff = Number.MAX_SAFE_INTEGER;

    event.sessions.forEach((session) => {
        const timeDiff = getSessionDistance(session, targetTime);
        if (
            timeDiff < smallestTimeDiff ||
            (
                timeDiff === smallestTimeDiff &&
                (
                    nearestSession === null ||
                    session.startTime.getTime() < nearestSession.startTime.getTime()
                )
            )
        ) {
            smallestTimeDiff = timeDiff;
            nearestSession = session;
        }
    });

    return nearestSession;
}

export function findNearestEvent(eventMap: Map<number, Event[]>, targetTime: Date): Event | null {
    let nearestEvent: Event | null = null;
    let smallestTimeDiff = Number.MAX_SAFE_INTEGER;
    let nearestSessionStart = Number.MAX_SAFE_INTEGER;

    eventMap.forEach((events) => {
        events.forEach((event) => {
            const session = findNearestSession(event, targetTime);
            if (!session) {
                return;
            }

            const timeDiff = getSessionDistance(session, targetTime);
            const sessionStart = session.startTime.getTime();
            if (
                timeDiff < smallestTimeDiff ||
                (timeDiff === smallestTimeDiff && sessionStart < nearestSessionStart)
            ) {
                smallestTimeDiff = timeDiff;
                nearestSessionStart = sessionStart;
                nearestEvent = event;
            }
        });
    });

    return nearestEvent;
}
