/**
 * events.ts - FortuneMusic 活动事件 API
 * 
 * 获取和处理 FortuneMusic 平台的活动事件数据。
 * 主要功能：
 * 1. 从 API 获取活动事件列表
 * 2. 解析和转换 JSON 数据为结构化类型
 * 3. 处理时区转换（JST -> 本地时区）
 */

import { parseISO, isAfter } from 'date-fns';
import { toZonedTime } from "date-fns-tz";

// ========== 导出类型定义 ==========

/** 活动事件 - 应用层使用的结构化数据 */
export interface Event {
    id: number;
    name: string;
    artistName: string;
    photoUrl: string;
    date: Date;
    sessions: Map<number, Session>;
}

/** 场次 - 包含时间段和成员信息 */
export interface Session {
    id: number;
    name: string;
    sessionName: string;
    startTime: Date;
    endTime: Date;
    members: Map<string, Member>;
}

/** 成员 - 参与活动的艺人信息 */
export interface Member {
    order: number;           // 排序序号
    name: string;            // 成员名称
    thumbnailUrl: string;    // 头像图片 URL
    ticketCode: string;      // 票务代码（用于匹配等待室数据）
}

// ========== API 原始数据类型定义 ==========

/** API 返回的活动数组元素 */
interface EventArray {
    evtId: number
    evtCode: string
    evtName: string
    evtIsOnline: boolean
    evtDisplayFrom: string
    evtDisplayTo: string
    evtSortNo: number
    evtPhotUrl: string
    evtPhotoUpdate: string
    evtWebUrl: string
    dateArray: DateArray[]
}

/** API 返回的日期数组元素 */
interface DateArray {
    datePrefecture?: string
    datePlace: string
    dateDate: string
    dateDayOfWeek: string
    timeZoneArray: TimeZoneArray[]
}

/** API 返回的时区（场次）数组元素 */
interface TimeZoneArray {
    tzId: number
    tzName: string
    tzStart: string
    tzEnd: string
    tzDisplay: string
    tzUpdate: string
    memberArray: MemberArray[]
    hideWaitingInfo: boolean
}

/** API 返回的成员数组元素 */
interface MemberArray {
    mbName: string
    mbSortNo: number
    mbPhotoUrl: string
    mbPhotoUpdate: string
    shCode: string
    shName: string
    shUseMulti?: number
    showControlNo?: boolean
    ticketArray?: TicketArray[]
    isShowApp: boolean
    ticketNumberLimit: number
    showSerial: boolean
    nextLane?: string
    nicknameInputLimit?: number
    nicknameInputText?: string
    nicknameLabel?: string
}

/** API 返回的票务数组元素 */
interface TicketArray {
    tkCode: string
    tkName: string
}

// ========== 常量定义 ==========

/** 目标艺人列表 - 只获取这些艺人的活动 */
const targetArtistNames = ["乃木坂46", "櫻坂46", "日向坂46", "=LOVE"];

// ========== API 请求函数 ==========

/**
 * 获取活动事件数据
 * 
 * 开发环境：通过本地代理 /api/events 访问
 * 生产环境：通过 corsproxy.io 绕过 CORS 限制
 * 
 * @returns 活动事件映射表（key: 活动ID, value: 活动列表）
 */
export async function fetchEvents(): Promise<Map<number, Event[]>> {
    const isProduction = process.env.NODE_ENV === 'production';
    const link = isProduction
        ? "https://corsproxy.io/?https://api.fortunemusic.app/v1/appGetEventData/"
        : "/api/events"

    try {
        const response = await fetch(link);

        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        let results: Map<number, Event[]> = new Map<number, Event[]>();

        // 遍历所有艺人，只处理目标艺人
        for (const artist of data.appGetEventResponse.artistArray) {
            if (targetArtistNames.includes(artist.artName)) {
                let events = flatternEventArray(artist.artName, artist.eventArray);
                events.forEach((event, id) => {
                    results.set(id, event);
                });
            }
        }
        return results;

    } catch (error) {
        console.error("Error fetching events:", error);
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new Error('Network error: Unable to connect to FortuneMusic API. This may be due to CORS restrictions.');
        }
        throw new Error(`Failed to fetch sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// ========== 数据转换函数 ==========

/**
 * 合并日期和时间字符串，转换为本地时区
 * 
 * FortuneMusic API 返回的时间是 JST（日本标准时间，UTC+9），
 * 需要转换为用户本地时区。
 * 
 * @param dt - 日期字符串 (YYYY-MM-DD)
 * @param t - 时间字符串 (HH:mm)
 * @returns 本地时区的 Date 对象
 */
export function concatEventTime(dt: string, t: string): Date {
    const dateTimeString = dt ? `${dt} ${t}` : dt;
    // 解析为 JST 时间（+09:00）
    const jstDate = parseISO(`${dateTimeString}+09:00`);
    // 获取用户本地时区
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // 转换为本地时区
    return toZonedTime(jstDate, tz);
}

/**
 * 扁平化成员数组
 * 将 API 返回的成员数组转换为 Map 结构
 * 
 * @param memberArray - API 返回的成员数组
 * @returns 成员映射表（key: 成员票务代码, value: 成员信息）
 */
export function flatternMemberArray(memberArray: MemberArray[]): Map<string, Member> {
    let membersMap: Map<string, Member> = new Map<string, Member>();
    memberArray.forEach((member) => {
        membersMap.set(member.shCode, {
            order: member.mbSortNo,
            name: member.mbName,
            thumbnailUrl: member.mbPhotoUrl,
            ticketCode: member.shCode,
        });
    });

    return membersMap;
}

/**
 * 扁平化时区（场次）数组
 * 将 API 返回的时区数据转换为 Session 结构
 * 
 * @param dateDate - 日期字符串 (YYYY-MM-DD)
 * @param timezoneArray - API 返回的时区数组
 * @returns 场次映射表（key: 场次ID, value: 场次信息）
 */
export function flatternTimezoneArray(dateDate: string, timezoneArray: TimeZoneArray[]): Map<number, Session> {
    let sessions: Map<number, Session> = new Map<number, Session>();
    timezoneArray.forEach((timezone) => {
        // 合并日期和时间，转换时区
        let startAt = concatEventTime(dateDate, timezone.tzStart);
        let endAt = concatEventTime(dateDate, timezone.tzEnd);
        let session: Session = {
            id: timezone.tzId,
            name: timezone.tzName,
            sessionName: timezone.tzName,
            startTime: startAt,
            endTime: endAt,
            members: flatternMemberArray(timezone.memberArray),
        }
        sessions.set(timezone.tzId, session);
    });
    return sessions;
}

/**
 * 扁平化活动数组
 * 将 API 返回的活动数据转换为 Event 结构
 * 
 * 过滤逻辑：
 * - 只保留今天或未来的活动
 * 
 * @param artistName - 艺人名称
 * @param eventArray - API 返回的活动数组
 * @returns 活动映射表（key: 活动ID, value: 同一活动的不同日期列表）
 */
export function flatternEventArray(artistName: string, eventArray: EventArray[]): Map<number, Event[]> {
    let eventMap: Map<number, Event[]> = new Map<number, Event[]>();

    eventArray.forEach((event) => {
        let events: Event[] = [];
        let eventName = event.evtName;
        let eventPhotoUrl = event.evtPhotUrl;
        
        // 遍历每个日期
        event.dateArray.forEach((date) => {
            let eventDt = parseISO(date.dateDate);
            const now = new Date();
            
            // 只保留今天或未来的活动
            if (isAfter(eventDt, now) || eventDt.toDateString() === now.toDateString()) {
                let sessions = flatternTimezoneArray(date.dateDate, date.timeZoneArray);
                let currentEvent: Event = {
                    id: event.evtId,
                    name: eventName,
                    artistName: artistName,
                    photoUrl: eventPhotoUrl,
                    date: parseISO(date.dateDate),
                    sessions: sessions,
                };
                events.push(currentEvent);
            }
        });
        eventMap.set(event.evtId, events);
    });
    return eventMap;
}