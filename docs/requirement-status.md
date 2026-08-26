# DBClient MVP — 需求完成度清单（Backlog & Status）

> 维护人：主理人（齐活林）｜ 更新：2026-08-26
> 数据来源：`docs/prd.md`（MVP 原始 PRD）、`docs/architecture.md`（架构 v0.1）、`docs/prd-ai-clean-multistmt.md`（增量迭代 PRD）、`docs/prd-conn-io.md`（P2-5 PRD）、实际代码核对。
> 最新提交：见 `git log`（P2-5 之后含「连接配置导入/导出」）。

---

## 0. 总体结论

| 范围 | 状态 |
| --- | --- |
| MVP P0（上线门槛） | ✅ 全部完成 |
| MVP P1（重要增强） | ✅ 全部完成 |
| MVP P2（可选） | 🟡 部分完成（3/5，剩 2 项） |
| 增量迭代 P0（AI 清洗+多语句） | ✅ 全部完成 |
| 增量迭代 P1（4 项） | ✅ 全部完成 |
| 增量迭代 P2（4 项） | ⬜ 全部未做 |
| 架构「待明确」技术债 | 🟡 3 项待补 |

---

## 1. ✅ 已完成（已核对代码/提交）

### MVP P0（必须）
- **P0-1** 数据库连接管理（新增/编辑/删除/列表/测试连接）
- **P0-2** SQL 编辑器与执行（整段/选中执行、结果表格、耗时/行数）
- **P0-3** AI 自然语言生成 SQL（结合库表 DDL 上下文）
- **P0-4** 连接密码 AES-256-GCM 加密存储
- **P0-5** AI 生成 SQL 仅建议、绝不自动执行

### MVP P1（重要）
- **P1-1** 执行历史记录（`history.ts` + `historyService` + `HistoryPanel`）
- **P1-2** 结果表格增强（列排序 + 导出 CSV，`csv.ts` + `ResultTable`）
- **P1-3** AI 接口配置页（base URL/Key/Model + 连通测试，`settings.ts` + `SettingsDialog`）
- **P1-4** 友好错误处理（前端 `client.ts` 6 级错误，`ca55cf8`；后端 `errorHandler`）
- **P1-5** 结果集行数限制（SELECT 默认 LIMIT 1000，`dbService`）

### MVP P2（部分）
- **P2-2** 左侧 schema 树形浏览（库→表→字段/类型/注释，提交 `d120391`）
- **P2-3** SQL 语法高亮（CodeMirror + `@codemirror/lang-sql`）
- **P2-5** 连接配置导入/导出 JSON（`GET /api/connections/export` + `POST /api/connections/import`，密文默认/明文可选、skip/overwrite/rename 三策略，PRD 见 `docs/prd-conn-io.md`）

### 增量迭代 P0（AI 清洗 + 多语句执行，`462b43d`）
- **P0-1** AI 输出稳健清洗（`sqlSplit.ts` 状态机 + `cleanAndSplit`）
- **P0-2** 系统提示词改造（允许多条、禁解释/围栏）
- **P0-3** 多语句执行后端（`POST /api/query/execute-multi`，`executeMulti` 错误隔离）
- **P0-4** 前端 AI 面板多语句交互（逐条卡片：执行/回填/复制 + 全部执行）

### 增量迭代 P1（4 项）
- **P1-1** 写操作二次确认（`WriteConfirmDialog` 已接 `AiPanel`，「本次不再提示」写 localStorage）
- **P1-2** 错误与边界提示（纯解释无 SQL → `statements:[]` + 友好 message，不抛 50003）
- **P1-3** 多语句结果展示策略（逐条展开/折叠 + 成功/失败计数 + 截断标记）
- **P1-4** 接口契约文档同步（`architecture.md` §3.1/§3.4/§8.5 对齐实现）

---

## 2. ⬜ 未做（待补）

### 2.1 增量迭代 P2（4 项全未做）
| 项 | 说明 | 价值 |
| --- | --- | --- |
| **P2-1** 多语句结果多标签展示 | 每条结果独立 Tab/分页（当前为逐条折叠卡片） | 体验 |
| **P2-2** `execute-multi` 事务选项 | 新增 `transaction=true`，同一连接 `BEGIN/COMMIT` 全成功或全回滚（当前各自独立） | **数据安全，高价值** |
| **P2-3** AI 结果一键格式化/美化 | 基于编辑器格式化能力扩展到多语句 | 体验 |
| **P2-4** 多语句历史聚合+重载 | 历史记整段 SQL+成功/失败计数，点击重载回编辑器（目前重载主要服务单条） | 体验 |

### 2.2 MVP P2（剩 2 项未做）
| 项 | 说明 | 价值 |
| --- | --- | --- |
| **P2-4** 暗色主题切换 | 代码无 darkMode/theme 切换 | 体验 |

### 2.3 架构文档「待明确」技术债
1. **LIMIT 注入边界**：对含 `UNION` / 子查询 / 已有 `LIMIT` 的复杂 SQL 仅做简化判断，未细化包裹策略（`architecture.md` §8.1）
2. **history.json 容量**：建议 200 条环形覆盖，未强制（`architecture.md` §8.3）
3. **生产部署形态**：Express 静态托管 `web/dist` 同源部署未做，目前仅 dev 用 Vite proxy（`architecture.md` §8.4）

### 2.4 小缺口（非阻塞）
- 写操作确认弹窗的「本次不再提示」为 **localStorage 持久**（非 PRD 说的「会话级」）；是否覆盖所有写语句类型建议回归一遍
- AI 配置页测试连通性只回 `ok/message`，未拉取「该 token 可用模型列表」辅助选模型（用户曾踩 403/无权限坑，属配置错误非功能缺陷，但加模型列表辅助能少踩坑）

---

## 3. 建议推进优先级（供挑选下一轮）

| 优先级 | 项 | 理由 |
| --- | --- | --- |
| 1 | **P2-4 暗色主题** | 体验项，工作量中等 |
| 2 | **C.3 生产同源部署** | 要上线才需要 |
| 3 | **增量 P2-2 事务选项** | 对数据安全最有价值，其余偏体验 |
| 4 | 其余 P2 / 技术债 | 按实际需要排期 |

---

## 4. 已完成（本轮）：P2-5 连接导入/导出

> 执行说明：本轮因 Agent 调度故障降级为「主理人代执行 + 全量验证」模式（PRD/架构/代码/测试各产出文档已标注），Bash 恢复后补齐构建与测试闭环。详见 `docs/prd-conn-io.md`、`docs/architecture-conn-io.md`。

- **交付内容**：后端 `exportAll/importMany`（`connectionService`）+ 2 个新端点（注册于 `/:id` 之前）+ 前端 `ImportDialog` 组件与 `ConnectionManager` 导入/导出按钮（含「导出含明文密码」勾选 + 风险提示）。
- **验证结果**：server `tsc` 构建通过；`connIo.test.js` 9/9 通过；全量回归 46/46 通过；web 构建通过。
- **顺手修复（存量缺陷）**：`api-contract.test.js` 原先 spawn 后端 `cwd: serverRoot` 直读真实 `server/data/`，在用户实际使用（数据非空）时必然失败；已改为系统临时目录隔离（绝对路径启动 + mkdtemp cwd + 用后清理），46/46 全绿。
- **测试约定提示**：crypto 套件需 shell 注入 `DB_CLIENT_MASTER_KEY`；全量回归命令：
  `cd server && mkdir -p .tmp-test && cd .tmp-test && DB_CLIENT_MASTER_KEY=<key> node --experimental-test-module-mocks --test ../tests/*.test.js`

---

> 本清单为跟踪文档，随迭代推进更新。专业 PRD/架构/代码/测试产出仍由各成员在 SOP 流程中独立产出。
