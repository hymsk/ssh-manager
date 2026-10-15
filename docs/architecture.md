# 架构设计

## 双层运行形态，一套前端

```
                    ┌──────────────────────────┐
                    │      React + Vite        │
                    │   （web/ 同一份代码）      │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
   ┌──────────▼──────────┐              ┌───────────▼──────────┐
   │   浏览器形态          │              │   桌面形态 (Tauri 2)  │
   │  HTTP/WS → Node      │              │  WebView 内嵌同一页面   │
   │  后端独立部署          │              │  sidecar 启动 Node 后端 │
   └──────────┬──────────┘              └───────────┬──────────┘
              │                                     │
              └──────────────────┬──────────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   SSH Manager 后端 (Node)  │
                    │  ┌────────────────────┐  │
                    │  │ Prober  每 30s 探测  │  │
                    │  ├────────────────────┤  │
                    │  │ Executor 并发批量执行 │  │
                    │  ├────────────────────┤  │
                    │  │ Scheduler Cron/间隔  │  │
                    │  ├────────────────────┤  │
                    │  │ SQLite + AES-GCM    │  │
                    │  └────────────────────┘  │
                    └────────────┬─────────────┘
                                 │ ssh2
                    ┌────────────▼─────────────┐
                    │      多台 SSH 主机         │
                    └──────────────────────────┘
```

浏览器无法直接建立 SSH/TCP 连接，因此 SSH 能力全部放在后端。桌面端复用同一后端二进制，
所以两种形态的界面、数据结构和接口完全一致。

## 后端模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 探测 | `src/ssh/prober.js` | 每 30s 探测全部主机，维护状态机与连续失败计数 |
| 连接 | `src/ssh/connect.js` | 构建 ssh2 配置、TOFU 指纹校验、命令执行、错误分类 |
| 执行 | `src/ssh/executor.js` | 批量任务、并发控制、超时、重试、逐机结果落库 |
| 调度 | `src/scheduler.js` | node-cron 注册、间隔计划、下次执行时间计算 |
| 加密 | `src/crypto.js` | AES-256-GCM 凭据加解密、主密钥加载 |
| 存储 | `src/db.js` | node:sqlite（WAL）表结构与序列化 |
| 实时 | `src/events.js` + `src/ws.js` | 事件总线、WebSocket 广播、交互式终端 |

## 主机状态机

```
unknown ──probe──▶ connecting ──ok──▶ online
                        │
                        └──fail──▶ (failures=1) unstable
                                        │
                                        └──▶ (failures>=2) offline
认证失败 / 指纹变化 ──▶ auth_failed / error   （不做抖动去抖，直接判定）
offline ──probe ok──▶ online （计数清零）
```

去抖的意义：单次网络抖动不会让主机的卡片变红，连续 2 次（约 60s）失败才判定离线。

## 批量执行时序

```
前端                后端 Executor              SSH 主机
 │  POST /api/runs    │                          │
 ├───────────────────▶│ 建 run + run_results     │
 │◀── runId ──────────┤ emit run_started         │
 │                    │                          │
 │   WS run_host ◀────┤ 逐台: connect ──────────▶│
 │   WS run_host ◀────┤       exec  ────────────▶│
 │   WS run_host ◀────┤       close ◀────────────│
 │                    │ recomputeCounters        │
 │   WS run_finished ◀┤ 汇总状态 success/partial/failed
 │  GET /api/runs/:id │
 ├───────────────────▶│ 返回逐机 stdout/stderr/exit_code
```

并发由 `mapLimit` 控制；`retryCount` 为**每台主机**的重试次数；
`continueOnError=false` 时首个确定失败会阻止尚未启动的主机。

## 数据表

- `hosts`：主机与状态（密钥密文、指纹、延迟、失败计数）
- `plans`：执行计划（目标、命令、调度、策略）
- `runs`：一次执行（汇总计数、状态、触发方式）
- `run_results`：一次执行中**每台主机**的结果（状态、退出码、stdout/stderr、耗时、重试）

## 安全模型

1. 凭据 AES-256-GCM 加密，密文形如 `v1:<iv>:<tag>:<ct>`。
2. 主密钥来源优先级：`SSH_MANAGER_KEY` → `DATA_DIR/key`（0600）→ 随机生成并落盘。
3. API 永不回传密钥，仅返回 `hasSecret`。
4. 首次连接记录主机指纹（TOFU），此后指纹不一致直接断开并标记 `error`。
5. 批量执行与计划复用同一套连接构造函数，因此同样受指纹校验保护。

## WebSocket 协议

所有帧都是 JSON。

事件（服务端 → 客户端）：

```json
{ "type": "event", "evt": { "type": "host_status", "payload": {...}, "at": "..." } }
{ "type": "event", "evt": { "type": "run_host",    "payload": {...} } }
```

终端：

| 方向 | 帧 |
| --- | --- |
| C→S | `{type:'term_open', hostId, cols, rows}` |
| C→S | `{type:'term_data', data}` |
| C→S | `{type:'term_resize', cols, rows}` |
| C→S | `{type:'term_close'}` |
| S→C | `{type:'term_status', status: 'connecting'\|'connected'\|'closed'}` |
| S→C | `{type:'term_data', data}` |
| S→C | `{type:'term_error', message}` |

> 事件帧刻意把真正的业务事件放在 `evt` 字段，避免业务字段覆盖外层 `type` 导致路由歧义。

## REST 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + 探测配置 |
| GET/POST | `/api/hosts` | 列表 / 新增 |
| PUT/DELETE | `/api/hosts/:id` | 修改 / 删除 |
| POST | `/api/hosts/:id/probe` | 立即探测 |
| POST | `/api/hosts/:id/test` | 连接测试 |
| POST | `/api/hosts/:id/exec` | 单机执行命令 |
| GET/POST | `/api/plans` | 计划列表 / 新增 |
| PUT/DELETE | `/api/plans/:id` | 修改 / 删除 |
| POST | `/api/plans/:id/run` | 立即执行 |
| POST | `/api/plans/:id/toggle` | 启用 / 暂停 |
| POST | `/api/plans/preview` | Cron 下次执行时间预览 |
| GET | `/api/runs` | 执行记录 |
| POST | `/api/runs` | 启动即时批量任务 |
| GET | `/api/runs/:id` | 任务详情（含逐机结果） |
| POST | `/api/runs/:id/cancel` | 取消 |
| POST | `/api/runs/:id/retry-failed` | 重试全部失败主机 |
| POST | `/api/runs/:id/retry-host` | 重试单台 |
| GET | `/api/templates` | 命令模板 |
