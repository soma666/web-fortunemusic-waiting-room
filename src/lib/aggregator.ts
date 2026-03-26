/**
 * aggregator.ts - 数据聚合工具
 * 
 * 提供数据聚合和查找功能。
 */

import type { Event } from "@/api/fortunemusic/events";

/**
 * 查找距离目标时间最近的活动
 * 
 * 用于自动选择当前最相关的活动：
 * - 如果有正在进行的活动，返回该活动
 * - 否则返回时间上最接近的活动
 * 
 * @param eventMap - 活动映射表
 * @param targetTime - 目标时间
 * @returns 最近的活动，如果没有则返回 null
 */
export function findNearestEvent(eventMap: Map<number, Event[]>, targetTime: Date): Event | null {
    let nearestEvent: Event | null = null;
    let smallestTimeDiff = Number.MAX_SAFE_INTEGER;
    
    // 遍历所有活动，找到时间差最小的
    eventMap.forEach((events) => {
        events.forEach((event) => {
            const timeDiff = Math.abs(event.date.getTime() - targetTime.getTime());
            if (timeDiff < smallestTimeDiff) {
                smallestTimeDiff = timeDiff;
                nearestEvent = event;
            }
        });
    });
    
    return nearestEvent;
}