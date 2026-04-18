import { format } from 'date-fns';

/**
 * Date formatting utilities for consistent date display across the application.
 */

export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Format total seconds as "HH:MM:SS" */
export function formatHMS(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** Format total seconds as "MM:SS" */
export function formatMS(totalSeconds: number): string {
  const minutes = Math.floor(Math.floor(totalSeconds) / 60);
  const seconds = Math.floor(totalSeconds) % 60;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

