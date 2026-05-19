# 矿珍库交接 · 2026-05-20 · mock 对齐 polish 系列

## TL;DR

接 `交接_20260519_pre_multiagent.md`(tag `v1.3-pre-multiagent`)。本次会话进入**多 agent 协调模式**, 把 mock screen-* 翻译成真实 inventory.html 落地, 然后多轮 audit + pixel-perfect polish + 用户截图驱动修复。

**87 个 PR merged**(包括 #18-#87 + cache bumps + handoff docs)。tag 序列:
- `v1.2-barcode-scan-half`(扫码 v4 半成功)
- `v1.3-pre-multiagent`(单 agent 最后版本)
- `v1.4-multiagent-mock-landing`(mock 全量落地)
- `v1.5-audit-pass`(9 agent QA 通过)
- `v1.6-mock-full-merge`(A+B+C 视觉/数据/基建)
- `v1.7-mock-sync`(增量同步)
- `v1.8-mock-qa-pass`(5 QA agent 视觉对齐)
- **`v1.9-scan-mock`(本次,扫码 sec-scan 6 改对齐)**

## 本次会话(从 v1.3 开始)关键里程碑

### Round 1: 单 agent 时代
- PR #18-#34:扫码 v4 半成功 + tiny/mini/fold-ring 标签 + 矢量 PDF + 精臣 M3 单页 + 价格黑色

### Round 2: 多 agent (R1+R2)
- PR #35-#45:9 agent 并行落地 mock screen-1/2/3/5/6/7/8/10 + stockio modal + 文档清理 + 全局基建(nav 5 icon、mzConfirm、全屏搜索、URL 路由)

### Round 3: QA audit
- PR #46-#56:9 audit agent 视觉对齐 + 数据扩展 + UX polish
- 抓出 P1 致命 CSS bug 2 个(@media 缺 `}` 吞 130 条样式)

### Round 4: 用户截图驱动 polish(本次主要内容)
- PR #57-#87:用户连续反馈,iterations on:
  - 顶 nav 5 icon SVG / 主 tab「商品/入出/展会/统计/流水」(去 emoji)
  - 商品 toolbar 紧凑 1 行
  - 详情底部「删除」移到编辑模式
  - 类别 6 宫格 → select 下拉
  - 入库 modal 删「取消」+ 确认全宽
  - 「仅建档」→「建档」+ 等宽双按钮
  - 流水 FAB 删 + 导出按钮 SVG icon 风
  - 搜索 overlay seed chips + 「推荐 · 全部商品」对齐 mock
  - **扫码 sec-scan 6 改**(本次最后):2 卡 [📷 拍照识别][🖼 从相册选] + 删手动输入 + 「⚙️ 高级选项」折叠(AI 引擎 chip + 测试后端)

## 用户已锁定不可改项(下次 session 必读)

1. **顶 nav 5 icon**(扫码/⬆/⬇/同步/账号) + 5 主 tab(商品/入出/展会/统计/流水)— 不要再加搜索/新建到顶,不要回 emoji
2. **类别 select 下拉**,不要回 6 宫格(`#f-cat-sel`)
3. **modal-add 删「取消」**,不要加回。仅建档→建档(2 字)
4. **modal-stockin 删「取消」+ 确认入库全宽**
5. **详情底部无「删除」**,在编辑 modal 底部红色「🗑 删除此商品」(deleteFromEdit)
6. **流水无 FAB**,导出/打印按钮 mock SVG icon 风
7. **类别筛选 select 可见**(在 inv-toolbar 全选旁,PR #63 恢复)
8. **搜索移商品页 toolbar 🔍 icon → openSearch overlay**(顶 nav 第一个 icon 是扫码 ⊞ 不是搜索)
9. **扫码 sec-scan**:2 卡主操作 + 高级选项折叠 + 不要再合 wide 卡
10. **标签 modal 7 档尺寸 + 精臣单页模式**,不要回 mock 4 档 + 3 步 stepper
11. **fold-ring barcode 8 字符短码**(`getBarcodeContent`)+ 矢量 PDF + 12× quiet zone

## 关键文件 + 函数

### inventory.html(主结构)
- L25-60 顶 nav header + 5 icon
- L62-68 主 nav-tabs
- L73-130 `#sec-inventory` 商品页(s2-toolbar 紧凑)
- L209-260 `#sec-scan` 扫码(2 卡 + 高级折叠)
- L425-490 `#modal-add` 建品/编辑
- L482-535 `#modal-stockin` 入库/出库
- L498-516 `#modal-detail` 详情(无删除底)
- L627-700 `#modal-label` 标签打印

### inventory.css(class 前缀)
- `.s2-*` 商品 toolbar/grid
- `.d3-*` 详情 modal
- `.s11-*` 建品/编辑
- `.sio-*` 入库
- `.scan-*` 扫码 sec
- `.scan-adv-*` 高级折叠(本次新加)
- `.label-*` 标签 modal
- `.logs-*` 流水
- `.show-*` 展会(用户说先不动)
- `.s8-*` 统计

### JS
- `js/inventory-core.js` — DB / Supabase / fmtPrice / mzConfirm / fmtPriceK
- `js/inventory-ui.js` — renderInventory / openDetail / openAddModal / openStockInModal / setAddCat / autoGenSku / deleteFromEdit
- `js/inventory-logs.js` — renderLogsPage / exportLogsAllCSV / printAllLogs
- `js/inventory-ai.js` — startCamera 三路并行 / showScanResult / scanFromPhoto / doAIRecognize / aiProvider / **_syncAiChip**(本次新加)
- `js/inventory-labels.js` — getBarcodeContent / drawBarcodeVector / makeBarcodeDataURL / exportLabelsPDF / getLabelConfig
- `js/inventory-search.js` — openSearch overlay(seed chips + 「推荐 · 全部商品」)

### Mock 文件(committed PR #68)
- `mock/screen-1-nav.html` ~ `mock/screen-11-new-product.html`
- `mock/拆分日志_20260518.md`(权威清单 2026-05-19)
- `mock/common.css` / `mock/common.js`

## 真机测试状态

| 场景 | 状态 |
|---|---|
| 扫码第三方 EAN-13 | ✅ 秒扫 |
| 扫码自家精臣 M3 印件 | ⚠️ 大部分 OK,小标签长 SKU 偶失败(物理 borderline) |
| iPhone Safari 一般使用 | 用户反复 polish 中,大部分 OK |
| 屏幕扫屏幕 (PDF on phone B → phone A 扫) | ⚠️ 物理 borderline(放弃) |

## 还 pending 的(rate limit 5pm 释放后)

按本次会话末尾的 diff 清单,**只剩**:
- 顶 nav 加「搜索」「新建」icon — **用户说不做**(搜索在商品 toolbar,新建在商品 toolbar)
- 标签 modal 3 步 stepper — **不做**(7 档 + 精臣模式更实用)
- 展会(screen-6)— 用户说先不动

**实际剩余 task**:
- 长期 todo(CLAUDE.md):PWA / 用户登录 / Excel 通用导入 / AI 识别速度 / 照片改 Google Drive / Mac Mini 备份
- 真机最终验证:精臣 M3 印件 + iPhone Safari 全功能流程

## 教训(本次新存 memory)

- `feedback_visual_change_must_test.md` — UI PR 必须 test 子助手 preview_eval 截图对比 mock 通过才合
- `feedback_proactive_diff_against_authority.md` — 有 mock/拆分日志 作权威时 agent 必须逐条对比真实输出 checklist 全修
- `feedback_terse_agent_dispatch.md` — 多 agent 协调时只报 spawn/完成,任务详情写在 agent prompt 里
- `feedback_groups_multi_subagent.md` — spawn 给 Group X 的 agent 自己应再用 Agent 工具拆并行
- `project_printer_niimbot_m3.md` — M3 真实规格 300 DPI, 印宽 20-80mm
- `feedback_verify_hardware_specs.md` — 用户给具体型号先 WebSearch 官方 spec

## 下次 session 接手

```bash
cd ~/Documents/Claude/Projects/Myinventory
git checkout main && git pull
claude
```

第一句话直接说:「继续矿珍库,先 iPhone 真机看 v=20260520-scanmock 的扫码 sec-scan 2 卡 + 高级折叠效果。然后处理 [P0/P1...]」。

新 session 自动加载 `CLAUDE.md` + memory(M3 规格、扫码 v4 经过、用户偏好、用户已锁项 11 条)。

回退本次:`git checkout v1.9-scan-mock`。

## Vercel 部署

`v=20260520-scanmock` 已上线 main。本次会话 cache 序列:
- merge3 → fix → searchfix → scanai → scancard → scanmock(每次 PR 推 main 自动 deploy)

## 多 agent 协调心得

- **isolation:"worktree"** = git worktree 自动创建,各 agent 互不污染
- **rate limit (5pm 东京)** 影响 sub-agent,但 coordinator 可以 fallback 手动 commit/merge
- **多 agent 并行** 触发 merge 冲突,coordinator 集中解(cache 版本号尤其常冲突)
- **用户截图驱动反馈** 比 agent 自报 "playwright 通过" 准 — 一定要相信用户眼睛
- **mock 是 untracked 时 worktree agent 看不到** — PR #68 强制 commit 进 git 后才能跨 worktree 用
