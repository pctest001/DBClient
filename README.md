# DBClient MVP

对标 [Chat2DB](https://github.com/chat2db/Chat2DB) 的轻量级 Web 数据库客户端 MVP，支持 MySQL / PostgreSQL 连接管理、SQL 编辑器执行与结果展示、AI 自然语言生成 SQL（OpenAI 兼容接口），连接密码与 API Key 本地加密存储。

## 技术栈

- **前端**：Vite + React + TypeScript + MUI + Tailwind CSS + `@uiw/react-codemirror`（SQL 编辑器）+ `zustand`（状态）
- **后端**：Node + Express + TypeScript（`tsx` 开发运行，`tsc` 构建），无 ORM，直接参数化 SQL
- **数据库驱动**：`mysql2/promise`、`pg`
- **加密**：Node 原生 `crypto`（AES-256-GCM），主密钥取自环境变量 `DB_CLIENT_MASTER_KEY`
- **AI**：OpenAI Chat Completions 协议（`POST {baseUrl}/chat/completions`），兼容 GPT / 通义 / Ollama

## 目录结构

```
dbclient-mvp/
├── package.json          # 根：concurrently 串联前后端
├── server/               # 后端（Node + Express + TS）
└── web/                  # 前端（Vite + React + MUI）
```

## 快速开始

### 1. 配置环境变量

复制 `server/.env.example` 为 `server/.env` 并填写主密钥（缺失则后端启动失败）：

```bash
cp server/.env.example server/.env
# 编辑 server/.env，设置 DB_CLIENT_MASTER_KEY（建议 ≥16 位随机串）
```

示例：

```
DB_CLIENT_MASTER_KEY=dev-only-master-key-change-me
PORT=4000
```

### 2. 安装依赖

```bash
npm install          # 根目录（含 concurrently）
cd server && npm install
cd ../web && npm install
```

或在根目录一键安装（部分包管理器）：

```bash
npm install && npm install --prefix server && npm install --prefix web
```

### 3. 启动开发环境

```bash
npm run dev
```

- 后端：http://localhost:4000
- 前端：http://localhost:5173 （Vite 已将 `/api` 代理到后端 4000）

### 4. 生产构建 / 启动

```bash
npm run build        # 先构建 server 再构建 web
npm run start        # 仅启动后端（server/dist）
```

## 功能范围

| 优先级 | 功能 |
| --- | --- |
| P0-1 | 数据库连接管理（增删改查 + 测试连接） |
| P0-2 | SQL 编辑器执行 + 结果表格（耗时 / 行数） |
| P0-3 | AI 自然语言生成 SQL（结合表结构上下文） |
| P0-4 | 连接密码加密存储（AES-256-GCM） |
| P0-5 | AI 生成 SQL 仅回填编辑器，绝不自动执行 |
| P1-1 | 执行历史记录 |
| P1-2 | 结果表格排序 + 导出 CSV |
| P1-3 | AI 接口配置页 + 连通测试 |
| P1-4 | 友好错误处理 |
| P1-5 | 结果集默认 LIMIT 1000（可「取消限制」） |

## 接口约定

统一响应：`{ code, data, message }`，`code=0` 成功。错误码：

- `40001` 请求参数校验失败
- `40101` 加密/解密失败 / 主密钥缺失
- `40401` 资源不存在
- `40901` 连接名冲突
- `50001` 数据库连接/建连失败
- `50002` SQL 执行失败
- `50003` AI 服务调用失败
- `50004` 内部错误

REST API 前缀 `/api`，详见 `docs/architecture.md`。
