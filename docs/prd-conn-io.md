# DBClient MVP — 增量迭代 PRD：连接配置导入/导出 JSON（简单 PRD）

> 迭代功能名：**连接配置导入/导出（P2-5）**
> 文档版本：v0.1 ｜ 角色：产品经理（许清楚）*（降级代执行：本会话 Agent 调度不可用，由主理人代笔）* ｜ 语言：中文
> 配套基线：`docs/prd.md`（v0.1）、`docs/architecture.md`（v0.1）、`docs/requirement-status.md`
> 落盘路径：`C:\Users\Administrator\myproject\dbclient-mvp`

---

## 0. 现状确认（基于代码事实）

| 现状点 | 代码事实 | 来源 |
| --- | --- | --- |
| 连接持久化 | `connectionService` 负责 `connections.json` 增删改查；密码明文入参 → `encrypt()` 落 `passwordEnc` | `server/src/services/connectionService.ts:23-37,54-124` |
| 对外类型剔除密码 | `ConnectionPublic = Omit<ConnectionRecord,'passwordEnc'>`，List/GET 绝不回传密文 | `server/src/models/types.ts:34`；`connectionService.ts:40-44` |
| 加密 | `cryptoService.encrypt/decrypt` 用 `DB_CLIENT_MASTER_KEY` 派生密钥做 AES-256-GCM；解密失败抛 `40101` | `server/src/services/cryptoService.ts` |
| 连接路由 | `GET/POST/PUT/DELETE /api/connections` + `/:id/test` + `/:id/tables` | `server/src/routes/connections.ts` |
| 前端列表 | `ConnectionManager.tsx` 提供新建/编辑/删除/测试/打开；无导入导出入口 | `web/src/components/ConnectionManager.tsx` |
| 前端 API | `client.ts` 的 `api` 对象封装连接相关请求 | `web/src/api/client.ts:109-125` |

结论：本迭代新增**导出**（把全部连接序列化为 JSON 供备份/迁移）与**导入**（从 JSON 批量恢复），复用现有 `connectionService` 的加密与冲突判定，不破坏既有安全红线。

---

## 1. 产品目标

1. **可备份/可迁移**：用户能把当前所有连接配置一键导出为 JSON 文件，换机器/重装后一键导入恢复，避免重复手工录入。
2. **安全不降级**：导出默认只含密文 `passwordEnc`（仅本工具、同密钥环境可再导入）；可选导出明文密码（用户自担泄露风险，UI 明确警告）。常规 List/GET 接口仍绝不出现明文/密文。
3. **导入稳健**：批量导入时同名冲突可配置处理（默认跳过已存在），单条非法/不可解密的数据不影响其余条目，返回逐项成败报告。

---

## 2. 用户故事

1. **作为运维**，我希望把生产环境的十几个数据库连接导出成一个文件备份，以便重装环境或交接时快速恢复。
2. **作为开发**，我希望把家里的连接配置导出，带到公司机器上导入，省得逐个手敲主机/端口/账号。
3. **作为安全负责人**，我希望导出文件默认不含明文密码，即使文件泄露也不会直接暴露数据库凭据。
4. **作为用户**，我希望导入时遇到同名连接不要整批失败，而是能选择跳过/覆盖/重命名，并看到每条导入成功与否。

---

## 3. 需求池

### P0 — 必须

**P0-1 导出连接（默认密文）**
- 描述：新增 `GET /api/connections/export`，返回 JSON 结构 `{ version, exportedAt, connections: ConnectionExportItem[] }`。`ConnectionExportItem` 默认含 `passwordEnc`（密文），不含明文 `password`。
- 验收标准：返回的每条连接字段含 `id/name/type/host/port/database/username/passwordEnc/createdAt/updatedAt`；响应体为正常 JSON，`code=0`；导出动作不在服务端日志打印任何密码/密文。

**P0-2 导入连接（基本可用 + 冲突跳过）**
- 描述：新增 `POST /api/connections/import`，请求体 `{ connections: ConnectionImportItem[], onConflict?: 'skip'|'overwrite'|'rename' }`。默认 `onConflict='skip'`。逐条处理：
  - 含 `passwordEnc`：尝试用当前密钥 `decrypt` 校验；成功则原样入库，失败则该条计入 `errors`（提示「密文与当前密钥不匹配」），不中断其余。
  - 含 `password`（明文）：`encrypt` 后入库。
  - `onConflict='skip'`（默认）：同名连接已存在则跳过该条（`skipped++`）。
  - 字段非法（缺 name/type/host/port/database/username 或无密码字段）→ 计入 `errors`。
- 响应 `data`：`{ imported, skipped, overwritten, renamed, errors: {name,error}[] }`。
- 验收标准：合法明文条目导入后可用（测试连接通过）；密文来自不同密钥时该条进 `errors` 且其余正常；同名默认跳过不报错；整体 `code=0`（除非请求体本身非法→`40001`）。

**P0-3 复用既有加密与冲突逻辑**
- 描述：导入/导出两端复用 `cryptoService.encrypt/decrypt` 与 `connectionService` 的 `passwordEnc` 约定；不在新代码里另写一套加密。
- 验收标准：导入后落盘的 `connections.json` 结构与现有 `ConnectionRecord` 完全一致（密文格式一致）。

### P1 — 重要

**P1-1 导出可选明文密码**
- 描述：`GET /api/connections/export?plain=1` 时，每条连接以 `password`（明文）替代 `passwordEnc`；`plain` 缺省或 `0` 仍返回密文。前端导出按钮旁提供「含明文密码」勾选，勾选时弹明确风险提示。
- 验收标准：`plain=1` 返回项含 `password` 且**不含** `passwordEnc`；`plain=0`/缺省含 `passwordEnc` 且不含 `password`。

**P1-2 导入覆盖/重命名**
- 描述：`onConflict='overwrite'` 时同名连接被新数据覆盖（更新字段与密码）；`onConflict='rename'` 时新连接名自动加后缀（如 `name (2)`、`name (3)`）避免冲突。前端导入对话框提供三选一（跳过/覆盖/重命名），默认跳过。
- 验收标准：`overwrite` 后旧连接被替换且仍可用；`rename` 后新旧并存、新名带序号且不与现有重名。

**P1-3 前端导入导出 UI**
- 描述：`ConnectionManager` 顶部新增「导出」「导入」按钮。导出→调用接口拿 JSON→浏览器下载 `.json` 文件（文件名含日期）。导入→弹出对话框选 JSON 文件 + 选冲突策略→提交→展示返回的成功/跳过/错误计数摘要。
- 验收标准：导出能下载到文件；导入文件后弹窗显示 `导入 N / 跳过 M / 错误 K`；导入后连接列表自动刷新。

### P2 — 可选

**P2-1 批量校验报告增强**：导入前先 `dryRun` 返回将被跳过/覆盖/重命名/出错的预览，用户确认后再执行。
**P2-2 导入前差异预览**：展示每条连接将如何落地（新增/覆盖/跳过/重命名）。
**P2-3 设置(AI Key)一并导入导出**：本迭代仅连接，AI Key 导入导出留待后续。

---

## 4. UI 设计稿（文字 + ASCII）

### 4.1 连接管理面板头部（新增导出/导入）

```
┌──────────────────────────────────────────────────────────┐
│ 数据库连接                          [导出] [导入] [+ 新建]  │
├──────────────────────────────────────────────────────────┤
│ 筛选: [________]                                           │
│ ┌─ MySQL · 生产库  ... [测试][编辑][删除]                  │
│ └─ ...                                                     │
└──────────────────────────────────────────────────────────┘
```

### 4.2 导入对话框

```
┌─ 导入连接 ──────────────────────────────────────┐
│ 选择文件: [选择 .json 文件] 已选: conn-20260826.json │
│ 冲突策略: (●) 跳过已存在  ( ) 覆盖  ( ) 重命名     │
│ [取消]  [导入]                                    │
├─ 结果 ───────────────────────────────────────────┤
│ ✓ 导入 3 · 跳过 1 · 错误 0                         │
│ （若有错误）✗ 连接 X：密文与当前密钥不匹配         │
└──────────────────────────────────────────────────┘
```

---

## 5. 约束

- **安全红线**：导出/导入属于用户主动显式动作；导出接口可直接返回密文/明文（用户自取），但常规 List/GET 与日志仍绝不出现明文/密文。
- **密文可移植性限制**：密文仅能在**同一 `DB_CLIENT_MASTER_KEY`** 环境解密；跨密钥导入密文必然失败，PRD 明示此限制（导入时给出友好错误而非崩溃）。
- **技术栈不变**：后端 Node+Express+TS，前端 Vite+React+MUI+Tailwind+zustand；统一响应 `{code,data,message}`；错误码沿用（40901 同名冲突、40001 参数校验、40101 加解密失败）。
- **文件格式**：导出的 JSON 含 `version` 字段便于未来兼容；`connections` 数组元素结构与 `ConnectionRecord` 对齐。

---

## 6. 待确认问题（已给出推荐）

1. **导出默认密文还是明文**：推荐默认密文（`passwordEnc`），`?plain=1` 才给明文（UI 警告）。✅ 已定。
2. **导入同名冲突默认策略**：推荐默认 `skip`（跳过已存在），可选 `overwrite`/`rename`。✅ 已定。
3. **密文跨密钥导入**：推荐导入时 `decrypt` 校验，失败计入 `errors`（不中断其余），并提示密钥不匹配。✅ 已定。
4. **是否一并导入 AI Key**：本次仅连接，AI Key 留 P2-3。✅ 已定。

> 文档结束。落地建议顺序：P0-1 → P0-3 → P0-2 → P1-1 → P1-2 → P1-3。
