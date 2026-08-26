# DBClient MVP — 增量架构设计：连接导入/导出（P2-5）

> 文档版本：v0.1 ｜ 角色：架构师（高见远）*（降级代执行：Agent 调度不可用，主理人代笔）* ｜ 语言：中文
> 配套：本迭代 PRD `docs/prd-conn-io.md`、基线 `docs/architecture.md`

---

## 1. 实现方案

- 复用 `connectionService` 的加密与冲突判定，**不新增加密实现**。
- 导出：`GET /api/connections/export` 直接读 `connections.json` 全量记录；`plain` 参数控制返回密文还是明文（明文需 `decrypt` 每条密码）。
- 导入：`POST /api/connections/import` 解析 JSON 数组，逐条校验 + 加密/校验密文 + 按 `onConflict` 落库，汇总成败。
- 前端：`ConnectionManager` 增加「导出」「导入」按钮；导入走 `Mui Dialog`（选文件 + 冲突策略 + 结果摘要）。

## 2. 类型（server/src/models/types.ts 追加）

```typescript
/** 导出单条：默认含密文 passwordEnc；plain 模式含明文 password 且不含 passwordEnc。 */
export interface ConnectionExportItem extends ConnectionRecord {
  password?: string; // 仅 plain 模式出现
}
export interface ConnectionExport {
  version: number;            // 1
  exportedAt: string;         // ISO8601
  connections: ConnectionExportItem[];
}
/** 导入单条：二选一提供 passwordEnc（密文）或 password（明文）。 */
export interface ConnectionImportItem {
  name: string;
  type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  passwordEnc?: string;       // 密文（须当前密钥可解）
  password?: string;          // 明文（将被 encrypt）
}
export type ImportConflictStrategy = 'skip' | 'overwrite' | 'rename';
export interface ConnectionImportReq {
  connections: ConnectionImportItem[];
  onConflict?: ImportConflictStrategy; // 默认 skip
}
export interface ConnectionImportError {
  name: string;
  error: string;
}
export interface ConnectionImportResult {
  imported: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  errors: ConnectionImportError[];
}
```

## 3. 端点（追加到 connections 路由）

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| GET | `/api/connections/export?plain=0\|1` | — | `ConnectionExport` |
| POST | `/api/connections/import` | `ConnectionImportReq` | `ConnectionImportResult` |

> 路由注册顺序：`/export` 与 `/import` 必须注册在 `/:id` 之前，避免被param 路由捕获。

## 4. 程序调用流程

```
导出：前端[导出] → GET /api/connections/export?plain= → connectionService.exportAll(plain)
      → 全量记录（plain 时 decrypt 密码）→ 返回 ConnectionExport → 前端 Blob 下载 .json

导入：前端[导入对话框]选文件+策略 → POST /api/connections/import
      → connectionService.importMany(items, onConflict)
      → 逐条：校验字段 → (有 passwordEnc? decrypt 校验 : 有 password? encrypt)
              → 按 onConflict 处理同名 → 落盘 → 汇总 imported/skipped/overwritten/renamed/errors
      → 返回 ConnectionImportResult → 前端刷新列表 + 展示摘要
```

## 5. 任务列表（实现顺序）

| 任务 | 文件 | 内容 |
| --- | --- | --- |
| T1 类型 | `server/src/models/types.ts`, `web/src/types/index.ts` | 追加导出/导入相关接口，前后端对齐 |
| T2 服务 | `server/src/services/connectionService.ts` | 追加 `exportAll(plain)`、`importMany(items, onConflict)` |
| T3 路由 | `server/src/routes/connections.ts` | 追加 `GET /export`、`POST /import`（注册于 `/:id` 前） |
| T4 前端 API | `web/src/api/client.ts` | 追加 `exportConnections`、`importConnections` |
| T5 前端 UI | `web/src/components/ConnectionManager.tsx` (+ 内联 `ImportDialog`) | 导出按钮 + 导入对话框 + 结果摘要 |
| T6 测试 | `server/tests/connIo.test.js` | 导出密文/明文、导入明文、密文跨密钥错误、同名 skip/overwrite/rename |

## 6. 约束与复用

- 加密只用 `cryptoService.encrypt/decrypt`；导入密文校验失败计入 `errors`，不抛 500 中断整批。
- 错误码：参数缺失 `40001`、同名冲突 `40901`（仅作为 `errors[].error` 文案，不上升到顶层）、解密失败 `40101`。
- 导入后 `connections.json` 结构与既有 `ConnectionRecord` 完全一致。

## 7. 待确认（已闭环，见 PRD §6）

导出默认密文、导入默认跳过、密文跨密钥进 errors、仅连接不含 AI Key。
