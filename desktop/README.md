# 桌面端（Tauri 2）

前端与浏览器版**完全复用** `web/` 的代码，桌面壳只负责窗口与内嵌后端进程。

## 前置条件

- Rust 工具链（rustup）
- Windows：WebView2 Runtime（Win10/11 通常已内置）
- Linux：`webkit2gtk-4.1`、`libayatana-appindicator3-dev` 等

安装 Rust：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## 开发

```bash
cd desktop
cargo tauri dev
```

`tauri.conf.json` 的 `beforeDevCommand` 会自动启动后端（`server/`），前端由 `devUrl` 指向 Vite。

## 打包

```bash
cd desktop
cargo tauri build
```

产物：

| 平台 | 产物 |
| --- | --- |
| Windows | `.exe` 安装包（NSIS） |
| Linux | `.deb` / `.AppImage` |

## 后端随包发布（sidecar）

生产模式下 `src-tauri/src/main.rs` 会在应用目录旁查找后端可执行文件并启动：

- Windows：`server-x86_64-pc-windows-msvc.exe`
- Linux：`server-x86_64-unknown-linux-gnu`

使用 [pkg](https://github.com/vercel/pkg) 或 `node --experimental-sea-config` 将 `server/` 打包为独立二进制，
放入 `src-tauri/binaries/` 并在 `tauri.conf.json` 的 `bundle.externalBin` 中声明即可。

示例（Node SEA，仅供参考）：

```bash
cd server
npm run build:sea        # 需自行配置 SEA 脚本
```

## 与浏览器版的差异

| 能力 | 浏览器 | 桌面端 |
| --- | --- | --- |
| 界面 | 相同 | 相同 |
| 后端 | 独立部署的 Node 服务 | 随应用启动的 sidecar |
| 数据目录 | 服务器 `DATA_DIR` | 用户数据目录 |
| 更新 | 重新部署 | 应用内更新（可选 tauri-plugin-updater） |
