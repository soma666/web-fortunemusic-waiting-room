/**
 * HistoryChart.tsx - 历史数据图表组件
 * 
 * 使用 Recharts 库渲染历史数据的折线图。
 * 支持多成员数据对比，显示当前时间位置的参考线。
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { CHART_COLORS } from '@/lib/constants';

// ========== 组件接口 ==========

interface ChartProps {
  data: Array<{
    time: string;
    timestamp: number;
    [memberId: string]: string | number | null;
  }>;
  selectedMembers: Array<{ id: string; name: string; color?: string }>;
  currentIndex: number;       // 当前播放位置
  yAxisMode: 'waitingCount' | 'waitingTime' | 'avgWaitingTime';
}

// ========== 常量定义 ==========

/** Y轴标签映射 */
const yAxisLabels = {
  waitingCount: '排队人数',
  waitingTime: '等候时间 (秒)',
  avgWaitingTime: '平均等候时间 (秒)',
};

// ========== 主组件 ==========

/**
 * 历史数据图表组件
 */
export function HistoryChart({ data, selectedMembers, currentIndex, yAxisMode }: ChartProps) {
  // 无数据时显示提示
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        暂无数据
      </div>
    );
  }

  /** Recharts Tooltip 的 payload 条目 */
  interface TooltipEntry {
    name: string;
    value: number | null;
    color: string;
  }

  /**
   * 自定义 Tooltip 组件
   * 鼠标悬停时显示详细数据
   */
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium mb-2">{label}</p>
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}:</span>
              <span className="font-mono font-medium">
                {entry.value !== null ? entry.value : '-'}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 10 }}
      >
        {/* 网格线 */}
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        
        {/* X轴 - 时间 */}
        <XAxis
          dataKey="time"
          tick={{ fontSize: 12 }}
          tickMargin={10}
        />
        
        {/* Y轴 - 数值 */}
        <YAxis
          label={{
            value: yAxisLabels[yAxisMode],
            angle: -90,
            position: 'insideLeft',
            style: { fontSize: 12 },
          }}
          tick={{ fontSize: 12 }}
        />
        
        {/* 鼠标悬停提示 */}
        <Tooltip content={<CustomTooltip />} />

        {/* 图例 */}
        {selectedMembers.length > 0 && (
          <Legend
            formatter={(value) => {
              const member = selectedMembers.find(
                (m) => m.name === value || m.id === value
              );
              return (
                <span className="text-sm">
                  {member?.name || value}
                </span>
              );
            }}
          />
        )}

        {/* 当前时间参考线 */}
        {data[currentIndex] && (
          <ReferenceLine
            x={data[currentIndex]?.time}
            stroke="#666"
            strokeDasharray="5 5"
            label={{
              value: '现在',
              position: 'top',
              fontSize: 12,
              fill: '#666',
            }}
          />
        )}

        {/* 各成员的数据线 */}
        {selectedMembers.map((member, index) => (
          <Line
            key={member.id}
            type="monotone"
            dataKey={member.id}
            name={member.name}
            stroke={member.color || CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls  // 连接空值，避免断开
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}