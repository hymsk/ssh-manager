import express from 'express'

/** Built-in command templates. {var} placeholders are filled by the UI. */
const TEMPLATES = [
  {
    id: 'disk-usage',
    name: '查看磁盘空间',
    category: '巡检',
    type: 'command',
    command: 'df -h',
    description: '查看各分区磁盘使用情况',
  },
  {
    id: 'memory-usage',
    name: '查看内存信息',
    category: '巡检',
    type: 'command',
    command: 'free -m && uptime',
    description: '查看内存使用与系统负载',
  },
  {
    id: 'system-info',
    name: '获取系统信息',
    category: '巡检',
    type: 'command',
    command: 'hostname && uname -a && cat /etc/os-release | head -3',
    description: '获取主机名、内核与发行版信息',
  },
  {
    id: 'top-process',
    name: 'CPU 占用前 10 进程',
    category: '巡检',
    type: 'command',
    command: 'ps aux --sort=-%cpu | head -11',
    description: '查看 CPU 占用最高的进程',
  },
  {
    id: 'restart-nginx',
    name: '重启 Nginx',
    category: '服务',
    type: 'command',
    command: 'systemctl restart nginx && systemctl status nginx --no-pager',
    description: '重启 Nginx 并输出状态',
  },
  {
    id: 'restart-service',
    name: '重启服务',
    category: '服务',
    type: 'command',
    command: 'systemctl restart {service} && systemctl status {service} --no-pager',
    description: '重启指定 systemd 服务',
    variables: [{ key: 'service', label: '服务名', default: 'nginx' }],
  },
  {
    id: 'clean-logs',
    name: '清理 7 天前日志',
    category: '维护',
    type: 'command',
    command: 'find {logDir} -type f -name "*.log" -mtime +7 -delete && echo "清理完成"',
    description: '删除指定目录下 7 天前的 .log 文件',
    variables: [{ key: 'logDir', label: '日志目录', default: '/var/log/app' }],
  },
  {
    id: 'backup-app',
    name: '备份应用目录',
    category: '备份',
    type: 'script',
    command: `#!/bin/bash
set -e
APP_DIR="{appDir}"
BACKUP_DIR="{backupDir}"
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/app-$(date +%F-%H%M).tar.gz" "$APP_DIR"
find "$BACKUP_DIR" -name "app-*.tar.gz" -mtime +7 -delete
echo "备份完成：$BACKUP_DIR"`,
    description: '打包应用目录并保留 7 天',
    variables: [
      { key: 'appDir', label: '应用目录', default: '/opt/app' },
      { key: 'backupDir', label: '备份目录', default: '/backup' },
    ],
  },
  {
    id: 'deploy-app',
    name: '发布应用',
    category: '发布',
    type: 'script',
    command: `#!/bin/bash
set -e
cd {appDir}
git fetch --all
git reset --hard origin/{branch}
{installCmd}
systemctl restart {service}
echo "发布完成"`,
    description: '拉取代码、安装依赖并重启服务',
    variables: [
      { key: 'appDir', label: '应用目录', default: '/opt/app' },
      { key: 'branch', label: '分支', default: 'main' },
      { key: 'installCmd', label: '依赖安装命令', default: 'npm ci --omit=dev' },
      { key: 'service', label: '服务名', default: 'app' },
    ],
  },
]

export function templatesRouter() {
  const router = express.Router()
  router.get('/', (req, res) => {
    res.json({ templates: TEMPLATES })
  })
  return router
}
