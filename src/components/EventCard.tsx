/**
 * EventCard.tsx - 活动信息卡片组件
 * 
 * 显示当前选中活动的基本信息：
 * - 活动名称（带闪烁动画效果）
 * - 活动日期
 */

import { Card } from '@/components/ui/card';
import { ShimmeringText } from "@/components/ui/shadcn-io/shimmering-text";

// ========== 组件接口 ==========

interface EventCardProps {
    name: string;       // 活动名称
    date: string;       // 活动日期（格式化后的字符串）
}

// ========== 主组件 ==========

/**
 * 活动信息卡片
 * 使用闪烁文字效果突出显示活动名称
 */
export function EventCard({ name, date }: EventCardProps) {
    return (
        <Card>
            <div className="flex flex-col items-start justify-center gap-2 p-6 text-left">
                {/* 活动名称（带波浪动画） */}
                <div className="text-left">
                    <ShimmeringText
                        text={name}
                        duration={2}
                        wave={true}
                        shimmeringColor="hsl(var(--primary))"
                    />
                </div>
                {/* 活动日期 */}
                <div className="text-left text-muted-foreground">
                    <ShimmeringText
                        text={date}
                        duration={2}
                        wave={false}
                        shimmeringColor="hsl(var(--primary))"
                    />
                </div>
            </div>
        </Card>
    );
}