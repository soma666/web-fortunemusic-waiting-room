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

interface ChartProps {
  data: Array<{
    time: string;
    timestamp: number;
    [memberId: string]: string | number | null;
  }>;
  selectedMembers: Array<{ id: string; name: string; color?: string }>;
  currentIndex: number;
  yAxisMode: 'waitingCount' | 'waitingTime' | 'avgWaitingTime';
}

const CHART_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FF8042', '#A4DE6C'];

const yAxisLabels = {
  waitingCount: '排队人数',
  waitingTime: '等候时间 (秒)',
  avgWaitingTime: '平均等候时间 (秒)',
};

export function HistoryChart({ data, selectedMembers, currentIndex, yAxisMode }: ChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        暂无数据
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
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
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 12 }}
          tickMargin={10}
        />
        <YAxis
          label={{
            value: yAxisLabels[yAxisMode],
            angle: -90,
            position: 'insideLeft',
            style: { fontSize: 12 },
          }}
          tick={{ fontSize: 12 }}
        />
        <Tooltip content={<CustomTooltip />} />

        {selectedMembers.length > 0 && (
          <Legend
            formatter={(value, entry: any) => {
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
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
