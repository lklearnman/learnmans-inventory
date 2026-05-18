# 矿珍库交接 · 2026-05-19 · 多 agent 分工前最后一版

## TL;DR

接 `交接_20260518_扫码v4_精臣M3.md`(那时 PR #18-#25 完成)。本次会话继续推进到 **PR #34**,清掉 P1/P3 两条历史 pending。**这是多 agent 分工前最后一版**,tag `v1.3-pre-multiagent` (commit `f45f8ae`)。

下次开 session 第一件事:**真机印 small/fold-ring 各一张,扫一下,确认扫码 v4 链路落地**。剩余 pending 见底部。

## 本次会话所有 PR (#18–#34)

| PR | sha | 内容 |
|---|---|---|
| [#18](https://github.com/lklearnman/learnmans-inventory/pull/18) | `785ded7` | 扫码 v4 阶段 A: BarcodeDetector 原生 API 优先(iOS Safari 不支持 fall back ZXing) |
| [#19](https://github.com/lklearnman/learnmans-inventory/pull/19) | `c1c0244` | 阶段 C+D: 三路并行(jsQR/ZXing/Quagga2)+ `api/scan-barcode.js` AI 兜底端点 |
| [#20](https://github.com/lklearnman/learnmans-inventory/pull/20) | `10fac34` | **quiet zone 修复** `margin:0 → 10`,自家 barcode 终于可扫 |
| [#21](https://github.com/lklearnman/learnmans-inventory/pull/21) | `a7e7060` | 分辨率 ×4: `width 4→8, height ×16→×32` |
| [#22](https://github.com/lklearnman/learnmans-inventory/pull/22) | `7c08e94` | 小标签 auto-flip QR(误判,#23 撤回) |
| [#23](https://github.com/lklearnman/learnmans-inventory/pull/23) | `7dbd31a` | 真·高分辨率 `width 8→24, height ×80`,撤回 auto-flip |
| [#24](https://github.com/lklearnman/learnmans-inventory/pull/24) | `4495441` | **砍编码长度**: `getBarcodeContent` ID 后 8 位 + `drawBarcodeVector` 矢量 PDF + `showScanResult` endsWith 兜底 |
| [#25](https://github.com/lklearnman/learnmans-inventory/pull/25) | `0d87f47` | 精臣单页 PDF: `format=[w,h]` + landscape, 一页一张 |
| [#26](https://github.com/lklearnman/learnmans-inventory/pull/26) | `430ec6c` | 交接文档 `交接_20260518_扫码v4_精臣M3.md` |
| [#27](https://github.com/lklearnman/learnmans-inventory/pull/27) | `ded4fbd` | 超小尺寸 tiny 25×15 / mini 30×20 + large/big 警告超 M3 80mm |
| [#28](https://github.com/lklearnman/learnmans-inventory/pull/28) | `b88b1da` | **quiet zone 12× 标准** `margin 10→24`,扫描器找 start/stop 大幅改善 |
| [#29](https://github.com/lklearnman/learnmans-inventory/pull/29) | `4f80b97` | HTML 预览 字号 1.8→1.15 + 商品名 2 行 clamp + 镜像 PDF 布局 |
| [#30](https://github.com/lklearnman/learnmans-inventory/pull/30) | `8fe3df7` | PDF 长名自动 `priceAtTop=true` 避免压商品名第 2 行 |
| [#31](https://github.com/lklearnman/learnmans-inventory/pull/31) | `9656192` | **F型珠宝标签** 25×30+45mm 对折 (M3/B32/Z401),上半 barcode 下半 名+价 |
| [#32](https://github.com/lklearnman/learnmans-inventory/pull/32) | `171e828` | 价格字体 金色 → 普通黑色 |
| [#33](https://github.com/lklearnman/learnmans-inventory/pull/33) | `1c0d635` | docs: 删过期测试 logs SQL 提示 |
| [#34](https://github.com/lklearnman/learnmans-inventory/pull/34) | `f45f8ae` | **P1+P3** 手机顶 currency select 可见 + 流水打印 11 列同步 CSV |

## 真机测试状态

| 场景 | 结果 |
|---|---|
| 第三方产品 EAN-13 barcode | ✅ 秒扫 |
| 自家 PDF 屏幕扫(phone B → phone A) | ⚠️ 只成功一次 → 物理限制(屏拍屏每模块仅 1.3 capture 像素) |
| 自家实物打印扫(精臣 M3) | ✅ 大部分能扫,**少量误识**(PR #28 quiet zone 标准化后应改善,**未再实测**) |
| 标签布局(长名压价格) | ❌ 老版本有此 bug → PR #29 (HTML)/#30 (PDF) 修 → 未实测 |
| F型对折标签 | ❓ 未真机印,只 preview 验证 |

## 已修(老笔记残留,本次核实代码)

| 之前误以为 pending | 实际状态 |
|---|---|
| `renderSummary` 混币累加 bug | 基于 `basePrice` (JPY 本位) 累加再换算,数学正确 |
| 入库流水点开详情 detailCurrency | 该概念已删除(2026-05-18 改),详情跟随 `inventoryCurrency` |
| stats tab 金额累加混币失真 | 用 `convertCurrency` 按原币换汇率累加,正确 |
| 数据库 SQL 用户手动跑 currency 字段 | 改造完成,fallback 已处理 |

## 还 pending(下次 session 接手)

### 单点可做(各 1 PR 量级)

- **P4 标签打印前显示价格** — `renderLabelList` 每行加 `<span>${fmtPriceRaw(p.price, p.currency)}</span>`
- **fold-ring 背面 barcode 180° 旋转** — 对折后人眼读 SKU 正读,jsPDF 用 `{angle:180}` 或矩阵变换
- **large/big 标签隐藏** — 超 M3 80mm 印宽,目前只警告未禁用
- **HTML 预览 PNG quiet zone** — `makeBarcodeDataURL` 同步升级 margin(PR #28 只升级了矢量 PDF)

### 文档

- **统计页币种说明文字过时** — `inventory.html:225` 周围
- **CLAUDE.md 多币种章节过时** — 描述「每条 logs 一个 currency」已不符,实际双轨

### 长期(CLAUDE.md 顶层)

- PWA(主屏图标 + 离线可用)
- 用户登录(Google + 角色权限)
- Excel 通用导入
- AI 识别速度排查
- 照片改存 Google Drive
- Mac Mini 备份 Supabase

## 关键文件 + 行号

- `js/inventory-labels.js`
  - `getBarcodeContent(p)` 行 110 — SKU/ID 后 8 位逻辑
  - `drawBarcodeVector(pdf, text, x, y, w, h)` 行 119 — 矢量 PDF barcode + 12× quiet zone
  - `makeBarcodeDataURL` 行 148 — HTML 预览 PNG(margin 仍 10,未同步升级)
  - `getLabelConfig` 行 88 — 含 tiny/mini/fold-ring/small/medium/large/big 7 档
  - `exportLabelsPDF` 行 220 — 精臣单页/A4 网格 分支 + fold-ring 上下分区分支
  - `renderLabelHTML` 行 211 — 镜像 PDF 布局,商品名 2 行 clamp
  - `renderLabelList` 行 45 — 标签 modal 选中列表(**P4 需在此加价格显示**)
  - `onLabelSizeChange` 行 84 — no-op 占位(撤回 auto-flip 后保留)

- `js/inventory-ai.js`
  - `startCamera` 行 5 — 三路并行 setInterval 150ms
  - `showScanResult` 行 162 — endsWith 兜底匹配
  - `scanFromPhoto` 行 199 — 阶段 D AI 兜底(按钮保留但默认不主推)

- `js/inventory-logs.js`
  - `renderSummary` 行 41 — basePrice 累加(已正确)
  - `exportLogCSV` 行 194 — CSV 11 列
  - `printLogs` 行 236 — 流水打印 11 列(PR #34 同步)
  - `renderStats` 行 356 — stats 用 `convertCurrency` 换算(已正确)

- `inventory.html`
  - 行 9-11 — ZXing + jsQR + Quagga2 CDN
  - 行 27-34 — header-stats(含 global-currency-select)
  - 行 340-348 — label-size + label-pdf-mode select
  - 行 358 — 小标签 1D 提示文案

- `inventory.css`
  - 行 152-158 — `@media(max-width:480px)` 把 stat 文字 div 隐藏但保留 select(PR #34)

- `api/scan-barcode.js` — AI OCR 条码端点(Claude/Gemini 双引擎)

## Tag

- `v1.2-barcode-scan-half` (`0d87f47`) — 扫码 v4 PR #18-#25 半成功
- `v1.3-pre-multiagent` (`f45f8ae`) — **本次,多 agent 分工前最后一版**

回退:
```bash
git checkout v1.3-pre-multiagent
```

## 教训(已存进 memory)

- `feedback_max_render_before_physics_limit.md` — 跳「物理限制」结论前先把渲染参数翻 3-10 倍
- `feedback_verify_hardware_specs.md` — 用户给具体型号(精臣 M3 等)先 WebSearch 官方 spec 再设计
- `feedback_avoid_ai_fallback.md` — 扫码/识别类问题优先本地 JS 库, AI 兜底要次要不主推
- `feedback_parallel_agents.md` — 子任务无依赖就单消息发多个 Agent/工具调用并行
- `project_printer_niimbot_m3.md` — M3 真实规格 300 DPI, 印宽 20-80mm

## 下次 session 接手指南

```bash
cd ~/Documents/Claude/Projects/Myinventory
git checkout main && git pull
claude
```

第一句话:「继续矿珍库,先真机印 small 和 fold-ring 各一张验证 PR #28-#34 综合效果。然后处理 P4 标签打印前显示价格」。

新 session 自动加载 `CLAUDE.md` + memory,无需粘历史。

## Vercel 部署

`v=20260528o` 已上线 main。每次会话各 PR 单独 bump cache(`a` → `o`,18 次 bump 覆盖 17 个 PR 各一次,#26/#33 docs PR 没动 inventory.html)。
