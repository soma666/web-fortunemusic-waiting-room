// History data storage using localStorage (with Vercel KV support planned)
// Data structure: { memberId: { timestamp: { waitingCount, waitingTime } } }

const STORAGE_KEY = 'fortunemusic_history';

export interface HistoryRecord {
  timestamp: number;
  waitingCount: number;
  waitingTime: number;
}

export interface MemberHistory {
  [timestamp: number]: {
    waitingCount: number;
    waitingTime: number;
  };
}

export interface HistoryData {
  [memberId: string]: MemberHistory;
}

// Save history record for a member
export function saveHistoryRecord(
  memberId: string,
  waitingCount: number,
  waitingTime: number
): void {
  const timestamp = Date.now();
  
  const data = getHistoryData();
  
  if (!data[memberId]) {
    data[memberId] = {};
  }
  
  // Use timestamp as key
  data[memberId][timestamp] = {
    waitingCount,
    waitingTime,
  };
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Save multiple records at once (for batch refresh)
export function saveBatchHistoryRecords(
  records: Array<{
    memberId: string;
    waitingCount: number;
    waitingTime: number;
  }>
): void {
  const timestamp = Date.now();
  const data = getHistoryData();
  
  records.forEach(({ memberId, waitingCount, waitingTime }) => {
    if (!data[memberId]) {
      data[memberId] = {};
    }
    data[memberId][timestamp] = {
      waitingCount,
      waitingTime,
    };
  });
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Get all history data
export function getHistoryData(): HistoryData {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

// Get history for a specific member
export function getMemberHistory(memberId: string): HistoryRecord[] {
  const data = getHistoryData();
  const memberData = data[memberId] || {};
  
  return Object.entries(memberData)
    .map(([timestamp, values]) => ({
      timestamp: parseInt(timestamp),
      waitingCount: values.waitingCount,
      waitingTime: values.waitingTime,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

// Get all unique timestamps across all members
export function getAllTimestamps(): number[] {
  const data = getHistoryData();
  const timestampSet = new Set<number>();
  
  Object.values(data).forEach((memberData) => {
    Object.keys(memberData).forEach((ts) => {
      timestampSet.add(parseInt(ts));
    });
  });
  
  return Array.from(timestampSet).sort((a, b) => a - b);
}

// Export history data as JSON string
export function exportHistoryData(): string {
  const data = getHistoryData();
  return JSON.stringify(data, null, 2);
}

// Import history data from JSON string
// Returns: { imported: number, skipped: number, conflicts: number }
export function importHistoryData(
  jsonString: string,
  options: { overwrite: boolean } = { overwrite: false }
): { imported: number; skipped: number; conflicts: number } {
  let imported = 0;
  let skipped = 0;
  let conflicts = 0;
  
  try {
    const importedData = JSON.parse(jsonString) as HistoryData;
    const currentData = getHistoryData();
    
    Object.entries(importedData).forEach(([memberId, memberData]) => {
      if (!currentData[memberId]) {
        currentData[memberId] = {};
      }
      
      Object.entries(memberData).forEach(([timestamp, values]) => {
        const ts = parseInt(timestamp);
        
        if (currentData[memberId][ts]) {
          // Conflict: same member + same timestamp
          conflicts++;
          if (options.overwrite) {
            currentData[memberId][ts] = values;
            imported++;
          } else {
            skipped++;
          }
        } else {
          currentData[memberId][ts] = values;
          imported++;
        }
      });
    });
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentData));
    
  } catch (error) {
    console.error('Failed to import history data:', error);
    throw new Error('Invalid JSON format');
  }
  
  return { imported, skipped, conflicts };
}

// Clear all history data
export function clearHistoryData(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Get history data summary
export function getHistorySummary(): {
  memberCount: number;
  recordCount: number;
  timeRange: { start: number | null; end: number | null };
} {
  const data = getHistoryData();
  const memberCount = Object.keys(data).length;
  
  let recordCount = 0;
  let earliest: number | null = null;
  let latest: number | null = null;
  
  Object.values(data).forEach((memberData) => {
    Object.entries(memberData).forEach(([ts, values]) => {
      recordCount++;
      const timestamp = parseInt(ts);
      if (!earliest || timestamp < earliest) earliest = timestamp;
      if (!latest || timestamp > latest) latest = timestamp;
    });
  });
  
  return {
    memberCount,
    recordCount,
    timeRange: { start: earliest, end: latest },
  };
}
