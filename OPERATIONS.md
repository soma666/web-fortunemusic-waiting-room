# Operations Log

## 2026-03-31 项目分析与优化

### 项目概述

**FortuneMusic 等待室监控** Web 应用，用于监控日本偶像团体（乃木坂46、樱坂46、日向坂46）的活动/演唱会等待室排队情况。

**技术栈**: Bun + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui

---

### 操作记录

#### 1. 项目分析

**文件阅读**:
- `README.md` - 项目概述和开发指南
- `package.json` - 依赖和脚本配置
- `src/App.tsx` - 主应用组件（429行）
- `src/index.tsx` - Bun 开发服务器入口
- `src/frontend.tsx` - React 入口
- `src/api/fortunemusic/events.ts` - 活动事件 API
- `src/api/fortunemusic/waitingRooms.ts` - 等待室 API
- `src/components/WaitingRoomGrid.tsx` - 等待室网格组件
- `src/components/StatsCards.tsx` - 统计卡片组件
- `src/components/SessionSelector.tsx` - 场次选择器
- `src/components/HistoryPanel.tsx` - 历史数据面板
- `src/lib/aggregator.ts` - 数据聚合工具
- `src/lib/history-api.ts` - 历史数据 API 客户端
- `api/history.ts` - Vercel Serverless Function

**发现的优化点**:

| 类别 | 问题 | 位置 |
|------|------|------|
| 性能 | `refreshWaitingRooms` 未用 `useCallback` | `App.tsx:205` |
| 性能 | `handleEventSelect` 未用 `useCallback` | `App.tsx:264` |
| 性能 | `joinMemberWaitingRoom` 每次渲染重新执行 | `WaitingRoomGrid.tsx:90` |
| 性能 | 状态过多（12个 useState） | `App.tsx` |
| 类型安全 | 使用 `any` 类型 | `waitingRooms.ts:58,82` |
| API 效率 | `kv.keys('history:*')` 全量扫描 | `api/history.ts:96` |
| API 效率 | 循环中单个 `kv.get` | `api/history.ts:115` |
| API 效率 | 批量写入未用 pipeline | `api/history.ts:168` |
| 代码质量 | 时间格式化重复代码 | `WaitingRoomGrid.tsx:119-124,135-140` |
| 功能 | 自动刷新被禁用 | `App.tsx:323-331` |

---

#### 2. 自动刷新功能修复

**修改文件**: `src/App.tsx`

**修改内容**:

1. **导入优化** (行14):
   - 移除未使用的 `use` 和 `useRef`
   - 添加 `useCallback`

2. **`refreshWaitingRooms` 改用 `useCallback`** (行205-251):
   ```typescript
   const refreshWaitingRooms = useCallback(async (sessionId?: number) => {
     // ... 函数体保持不变
   }, [selectedSession?.id, selectedEvent?.id, selectedEvent?.name, selectedSession?.name, members]);
   ```

3. **`handleEventSelect` 改用 `useCallback`** (行260-288):
   ```typescript
   const handleEventSelect = useCallback((eventId: string) => {
     // ... 函数体保持不变
   }, [events]);
   ```

4. **重新启用自动刷新定时器** (行316-326):
   ```typescript
   useEffect(() => {
     if (loading || !selectedSession) return;
     
     const interval = setInterval(() => {
       const now = new Date();
       if (now >= nextRefreshTime) {
         refreshWaitingRooms();
       }
     }, 5000);
     return () => clearInterval(interval);
   }, [nextRefreshTime, loading, selectedSession, refreshWaitingRooms]);
   ```

**测试结果**: 9 tests pass

---

### 待优化事项（未完成）

以下优化点已识别但尚未实施：

1. **性能优化**:
   - `WaitingRoomGrid` 的 `joinMemberWaitingRoom` 用 `useMemo` 缓存
   - 组件添加 `React.memo`（EventCard、WaitingRoomGrid）
   - 状态管理改用 `useReducer` 或拆分自定义 hook

2. **类型安全**:
   - `waitingRooms.ts` 中定义完整的 API 响应类型替代 `any`

3. **API 效率**:
   - 使用索引结构按 eventId/sessionId 分桶存储
   - 使用 `kv.mget` 批量获取
   - 使用 `kv.multi()` 批量写入

4. **代码质量**:
   - 提取时间格式化工具函数 `formatTime()`
   - 添加 `AbortController` 请求取消
   - 增加骨架屏加载状态
   - 增加测试覆盖

---

### 常用命令

```bash
# 开发
bun dev

# 构建
bun run build

# 测试
bun test

# 生产运行
bun start
```

---

## 2026-04-21 Cron 部署检查步骤

历史采集现在由 Vercel Cron 触发 `/api/collect-history`，部署后应按下面顺序验证。

### 目标

- 确认 cron 已被平台识别
- 确认 collector 实际执行过
- 确认执行状态、日志、采样摘要能被看到

### 检查步骤

1. 推送到 `main`，等待 Vercel 部署完成。
2. 打开部署后的站点，进入 History 面板首页。
3. 确认顶部出现“采集器状态”卡片。
4. 等待 1 到 2 分钟后刷新页面，检查卡片中的以下字段是否更新：
   - 最近成功
   - 最近采样数
   - 最近写入记录
   - 最近采样
   - 最近日志
5. 如果页面未更新，直接访问部署环境的诊断接口：

```text
/api/history?mode=collector-diag
```

### 成功判定

- `status.state` 为 `idle` 或短暂为 `running`
- `lastSuccess.finishedAt` 有值
- `logs` 中能看到 `run-start`、`snapshot-complete`、`run-complete`
- `snapshots` 中至少有一条最近采样记录

### 异常判定

- `status.state = error`
- `logs` 中出现 `run-failed`
- 持续只有 `lock-conflict`
- 2 分钟后仍然没有 `lastSuccess`

### 异常时优先检查

1. Vercel 项目是否已配置 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`
2. 是否配置了 `CRON_SECRET`
3. `vercel.json` 中的 `crons` 配置是否已随本次部署生效
4. Vercel Function Logs 中 `/api/collect-history` 是否有调用记录

### 手动补验

如果需要绕过等待 cron，可以手动请求一次 collector：

```text
GET /api/collect-history?mode=once
Authorization: Bearer <CRON_SECRET>
```

然后再次访问：

```text
/api/history?mode=collector-diag
```

如果手动触发成功而 cron 无记录，问题通常在平台 cron 配置或部署生效阶段，而不是 collector 本身。

---

### 文件结构关键路径

```
src/
├── App.tsx                 # 主组件（已修改）
├── frontend.tsx            # React 入口
├── index.tsx               # Bun 服务器
├── api/fortunemusic/
│   ├── events.ts           # 活动 API
│   └── waitingRooms.ts     # 等待室 API
├── components/
│   ├── WaitingRoomGrid.tsx
│   ├── StatsCards.tsx
│   ├── SessionSelector.tsx
│   └ HistoryPanel.tsx
└── lib/
    ├── aggregator.ts
    ├── history-api.ts
    └── history-types.ts

api/
└── history.ts              # Vercel KV 存储
```