# SSH Manager

多主机 SSH 管理、批量执行与定时计划平台。

同一套前端代码，支持两种运行形态：

| 形态 | 说明 |
| --- | --- |
| 浏览器 | `npm run dev` 打开 `http://localhost:5173`，后端为 Node 服务 |
| 桌面端 | Tauri 2 内嵌 WebView，复用同一套前端构建产物 |

## 功能

- 左侧 SSH 主机**小卡片**管理，显示连接状态、延迟、最后探测时间
- 每 **30 秒**自动探测一次连接状态（后端定时，不怕浏览器后台节流）
- 主机状态机：未知 / 连接中 / 在线 / 不稳定 / 离线 / 认证失败 / 超时
- 连续 2 次失败才判定离线，避免网络抖动误报
- 卡片内直接：终端 / 执行 / 配置
- 多选主机 → **批量执行**（命令、多条命令、Shell 脚本、命令模板）
- 并发数、单机超时、失败重试、失败后是否继续
- **每台机器独立汇报**：状态、耗时、返回码、stdout、stderr
- 失败/超时机器可单独重试
- 右侧**执行计划小卡片**：Cron / 间隔 / 一次，立即执行、暂停、启用
- 执行记录与日志
- 凭据 AES-256-GCM 加密落库，接口永不回传明文

## 目录结构

```
ssh-manager/
├── server/             # Node 后端：REST + WebSocket + SSH + 调度
│   └── src/
│       ├── ssh/        # 连接、探测、批量执行
│       ├── routes/     # REST 路由
│       ├── db.js       # node:sqlite
│       ├── crypto.js   # 凭据加密
│       ├── scheduler.js
│       └── ws.js       # 事件推送 + 交互式终端
├── web/                # React + Vite 前端（三栏卡片界面）
├── desktop/            # Tauri 2 桌面壳
└── docs/               # 设计文档
```

## 快速开始

### 1. 后端

```bash
cd server
npm install
npm run dev          # http://localhost:8899
```

### 2. 前端

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

浏览器打开 `http://localhost:5173`。

### 3. 单进程部署（可选）

前端构建后，后端会直接托管 `web/dist`，只需跑一个进程：

```bash
cd web && npm run build
cd ../server && npm start        # 访问 http://localhost:8899
```

### 3. 桌面端（需要 Rust 工具链）

```bash
cd desktop
cargo tauri dev      # 或 cargo tauri build
```

> 若本机没有 Rust，请先安装：https://rustup.rs

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8899` | 后端端口 |
| `DATA_DIR` | `server/data` | 数据与密钥目录 |
| `PROBE_INTERVAL_MS` | `30000` | 探测间隔（毫秒） |
| `PROBE_CONNECT_TIMEOUT_MS` | `5000` | 探测连接超时 |
| `OFFLINE_AFTER_FAILURES` | `2` | 连续失败几次判定离线 |
| `SSH_MANAGER_KEY` | 自动生成 | 32 字节密钥（hex/base64），不设置则写入 `DATA_DIR/key` |
| `VITE_API_BASE` | `/api` | 前端 API 基地址（构建期） |
| `VITE_WS_BASE` | 当前 host 的 `/ws` | 前端 WebSocket 地址（构建期） |

## 本地联调（无需真实 SSH 服务器）

仓库自带一个模拟 SSH 服务器，账号 `root / test1234`：

```bash
# 终端 1
npm run mock:ssh            # 监听 127.0.0.1:2222

# 终端 2
npm run dev:server

# 终端 3
npm run dev:web
```

然后在界面添加主机 `127.0.0.1:2222`，用户名 `root`，密码 `test1234`。

## 测试

```bash
cd server && npm test
cd web && npm run build
```

## 安全说明

- 密码与私钥使用 AES-256-GCM 加密存储，密钥默认落盘在 `DATA_DIR/key`（权限 600）
- API 只返回 `hasSecret` 布尔值，不回传任何密钥内容
- 首次连接会记录主机指纹；指纹变化时状态标为 `error` 并在卡片提示
- 建议生产环境通过 `SSH_MANAGER_KEY` 注入密钥，并给数据目录设置严格权限
