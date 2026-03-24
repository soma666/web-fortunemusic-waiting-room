import { test, expect, describe } from "bun:test";
import {
    concatEventTime,
    flatternMemberArray,
} from "./events";

describe("concatEventTime", () => {
    test("should correctly concatenate date and time", () => {
        const result = concatEventTime("2025-11-05", "14:30:45");
        expect(result.toISOString()).toBe(new Date("2025-11-05T14:30:45+09:00").toISOString());
    });

    test("should handle midnight time", () => {
        const result = concatEventTime("2025-11-05", "00:00:00");
        expect(result.toISOString()).toBe(new Date("2025-11-05T00:00:00+09:00").toISOString());
    });

    test("should handle end of day time", () => {
        const result = concatEventTime("2025-11-05", "23:59:59");
        expect(result.toISOString()).toBe(new Date("2025-11-05T23:59:59+09:00").toISOString());
    });

    test("should handle empty date string", () => {
        const result = concatEventTime("", "10:00:00");
        expect(result).toBeDefined();
    });
});

describe("flatternMemberArray", () => {
    test("should convert member array to map", () => {
        const memberArray = [
            {
                mbName: "Member 1",
                mbSortNo: 1,
                mbPhotoUrl: "https://example.com/member1.jpg",
                mbPhotoUpdate: "2025-11-01",
                shCode: "M001",
                shName: "Member 1 Slot",
                isShowApp: true,
                ticketNumberLimit: 10,
                showSerial: true
            },
            {
                mbName: "Member 2",
                mbSortNo: 2,
                mbPhotoUrl: "https://example.com/member2.jpg",
                mbPhotoUpdate: "2025-11-01",
                shCode: "M002",
                shName: "Member 2 Slot",
                isShowApp: true,
                ticketNumberLimit: 5,
                showSerial: false
            }
        ];

        const result = flatternMemberArray(memberArray);

        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(2);

        const member1 = result.get("M001");
        expect(member1).toBeDefined();
        expect(member1?.name).toBe("Member 1");
        expect(member1?.order).toBe(1);
        expect(member1?.thumbnailUrl).toBe("https://example.com/member1.jpg");
        expect(member1?.ticketCode).toBe("M001");

        const member2 = result.get("M002");
        expect(member2).toBeDefined();
        expect(member2?.name).toBe("Member 2");
        expect(member2?.order).toBe(2);
    });

    test("should handle empty member array", () => {
        const result = flatternMemberArray([]);
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });
});
