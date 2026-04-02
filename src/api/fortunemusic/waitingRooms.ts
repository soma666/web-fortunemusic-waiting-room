/**
 * waitingRooms.ts - FortuneMusic 等待室 API
 * 
 * 获取等待室的实时排队数据。
 * 主要功能：
 * 1. 根据活动 ID 获取等待室信息
 * 2. 解析 API 返回的等待室数据
 * 3. 提供公告消息（如活动取消通知）
 */

// ========== 类型定义 ==========

/** 等待室数据结构 */
export interface WaitingRooms {
    message: string;                              // 公告消息
    waitingRooms: Map<number, WaitingRoom[]>;     // 等待室数据（按场次ID分组）
}

/** 单个等待室信息 */
export interface WaitingRoom {
    ticketCode: string;     // 成员票务代码（用于匹配成员）
    peopleCount: number;    // 排队人数
    waitingTime: number;    // 等候时间（秒）
}

// ========== API 响应类型定义 ==========

/** 等待室 API 响应中单个成员的信息 */
interface MemberWaitInfo {
    totalCount: number;
    totalWait: number;
}

/** 等待室 API 响应中的时区（场次）信息 */
interface TimezoneData {
    e_id: string;
    members: Record<string, MemberWaitInfo>;
}

/** 等待室 API 的原始响应结构 */
interface WaitingRoomsAPIResponse {
    timezones: TimezoneData[];
    dateMessage: string;
}

// ========== API 请求函数 ==========

/**
 * 获取等待室数据
 * 
 * 开发环境：通过本地代理 /api/waitingrooms 访问
 * 生产环境：通过 corsproxy.io 绕过 CORS 限制
 * 
 * @param eventID - 活动ID（场次ID）
 * @returns 等待室数据，包含公告消息和各成员的排队信息
 */
export async function fetchWaitingRooms(eventID: number): Promise<WaitingRooms> {
    // 根据环境选择 API 端点
    const isProduction = process.env.NODE_ENV === 'production';
    const link = isProduction 
        ? "https://corsproxy.io/?https://meets.fortunemusic.app/lapi/v5/app/dateTimezoneMessages"
        : "/api/waitingrooms"

    try {
        const response = await fetch(link, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
            },
            // API 要求 eventId 格式为 "e" + 数字，如 "e12345"
            body: JSON.stringify({ "eventId": "e" + eventID })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch waiting rooms: ${response.status} ${response.statusText}`);
        }

        let resp = await response.json() as WaitingRoomsAPIResponse;
        let waitingRooms: WaitingRooms = flattenWaitingRooms(resp);
        return waitingRooms;
    } catch (error) {
        console.error("Error fetching waiting rooms:", error);
        throw new Error(`Failed to fetch waiting rooms: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// ========== 数据转换函数 ==========

/**
 * 扁平化等待室数据
 * 
 * 将 API 返回的嵌套结构转换为 Map 结构，
 * 以场次 ID 为键，便于后续查询。
 * 
 * @param data - API 返回的原始数据
 * @returns 结构化的等待室数据
 */
function flattenWaitingRooms(data: WaitingRoomsAPIResponse): WaitingRooms {
    let waitingRooms: Map<number, WaitingRoom[]> = new Map<number, WaitingRoom[]>();
    
    // 遍历所有时区（场次）
    data.timezones.forEach((timezone) => {
        // 提取场次 ID（格式为 "e12345"，需要去掉前缀 "e"）
        let eventIDStr = timezone.e_id;
        let eventID = +(eventIDStr.slice(1));

        // 获取或创建该场次的等待室列表
        let rooms: WaitingRoom[] = waitingRooms.get(eventID) || [];

        // 遍历所有成员的等待信息
        Object.keys(timezone.members).forEach((key) => {
            const memberInfo = timezone.members[key];
            rooms.push({
                ticketCode: key,
                peopleCount: memberInfo.totalCount,
                waitingTime: memberInfo.totalWait,
            });
        });
        waitingRooms.set(eventID, rooms);
    });

    // 组装返回结果
    let wr: WaitingRooms = { 
        message: data.dateMessage,
        waitingRooms: waitingRooms 
    };
    return wr;
};