# 矿珍库 (Myinventory)

珠宝/矿物标本/元石展会卖家用的云端库存管理系统。**最近一次交接见 `交接_20260518_标签PDF和扫码.md`(下次 session 先读这个,P0=摄像头扫码线上仍失败需诊断)**,前一份见 `交接_20260519_本位币改造.md`,完整历史见 `矿珍库_交接文档v4.md`。本文件只放每次会话最需要的上下文。

## 架构

- **前端**: `inventory.html`(22KB 框架)+ `inventory.css` + `js/inventory-*.js`(5 个模块)
  - 2026-05-17 从单页 109KB 拆分,缓存版本号 `?v=20260526`(改 JS/CSS 后在 HTML 里同步 bump)
  - GitHub Pages: `lklearnman/learnmans-inventory` → `https://lklearnman.github.io/learnmans-inventory/inventory.html`
  - Vercel 镜像: `https://learnmans-inventory.vercel.app/inventory.html`
- **后端**: Vercel Functions
  - `api/ai-recognize.js` — AI 识别 CORS 代理(Claude Haiku / Gemini)
  - `api/proxy-image.js` — 图片下载代理(绕 S3 CORS)
- **数据库**: Supabase `learnmanLight` (Tokyo), URL `https://dvpkitoobvvskerxtraz.supabase.co`
  - 表: `products`(含 `photos` JSONB + `thumbnail` TEXT)、`logs`、`show_items`
  - 三表都启用 RLS + `allow_all` policy — **不要关 RLS**,会导致匿名访问被拒
- **环境变量**(Vercel): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`

## 用户偏好

- **中文简体回复**,偶尔可用日文
- 用户**完全靠手机+浏览器操作**,不熟命令行;F12 Console 会用但需指导
- Claude 可直接 `git push origin main`(本机 `gh` 已登录 `lklearnman`,目录 `.git` 已配置)。Auto-mode 会拦 push 到 main 一次,用户口头授权后 commit 不必再问
- 备用方式:GitHub 网页直接编辑/上传替换
- ⚠️ `api/proxy-image.js` 本地缺,Vercel 上有 — `git add .` 会把它当作删除,务必只 `git add` 具体文件
- 改一处就说在第几行,用户不擅长搜索
- 报错信息要直接显示在 UI 里,不要让用户翻 Console
- 涉及决策时用 `AskUserQuestion`(1-3 个具体问题)
- 倾向最少步骤,不喜欢重复操作
- 部署变更后会担心稳定性 — 建议用 Git tag 存快照

## ⚠️ Git/网络(常被坑)

- **用户 Mac 间歇性连不上 GitHub**: `git push` / `gh api` 偶尔 0.003s 就报 `Can't assign requested address`。原因是多 utun 接口+同子网双网卡导致源 IP 选择歧义。**不要做网络诊断,不要让用户改路由表/退 Tailscale,这些都试过没用**
- **管用的兜底**: `until curl -s -o /dev/null --max-time 5 https://api.github.com ; do sleep 5 ; done && <command>` 丢后台,通的一瞬间会执行成功。同时把 PR 链接发给用户,他点 Merge 比死磕快 10 倍
- **推流程**: 用 PR 而不是 `git push origin <br>:main`。`git push origin <branch>` → `gh pr create --base main` → `gh pr merge <num> --merge`(用户授权我自动 merge 自己开的 PR,第一次被 auto-mode 拦就重试)
- 详见 memory `project_network_tailscale_routing.md` 和 `feedback_auto_merge_own_prs.md`

## 沟通和工作纪律

- **不要假装做了改动** — 用户检查代码很细
- 不要修改无关文件
- 修改文件后必须给出整理过的下载文件清单
- `vercel.json` 最简版本只能是 `{"version": 2}` — 加 `functions` 段会部署失败
- JavaScript 字符串里 `'\n'` 和真换行容易混,留意

## 待办(按优先级)

紧急: 摄像头扫码线上仍失败 (P0,见 `交接_20260518_标签PDF和扫码.md`)、PWA、用户登录(Google + 角色权限)
重要: 手机版顶部全局币种 select 不可见 (P1)、流水打印表头同步 11 列 (P3)、标签打印前显示价格确认 (P4)、精臣打印机标签、Excel 通用导入、AI 识别速度排查
将来: 照片改存 Google Drive、Mac Mini 备份 Supabase

## 多币种 + 本位币双轨(2026-05-17 起步,2026-05-19 双轨改造定型)

- **数据库 schema(双轨)** — `logs` 表 6 个相关列:
  - `original_price` / `original_currency` — 用户录入时的原始金额和币种(进货商付什么币、客户付什么币,如实保留)
  - `base_price` / `base_currency` — 记账瞬间按汇率换算成本位币的金额,`base_currency` 全部 'JPY'
  - `fx_rate` — 当时换算用的汇率,留作审计追溯
  - `counterparty`(text)— 进货商/客户名称
  - 旧字段 `price` / `currency` 仍然存在(只读兜底,前端 `originalPrice||price`、`originalCurrency||currency||'CNY'`)
- **`products.currency`** 全部统一为 'JPY'(本位币),不再随商品变。商品本身没有"币种属性",只有进/出流水才有原始币种
- **旧数据迁移完成** — 历史 logs 已经全部回填 `base_price`(按当时汇率换算成 JPY),累加统计直接 sum `basePrice` 就准确,不再有「混币累加失真」问题
- **统计逻辑** — `renderSummary` / `renderStats` / `printLogs` 全部以 `basePrice`(JPY)为底层累加,再用 `convertCurrency(totalJpy,'JPY',displayCur)` 换算到用户当前选的显示币种。`js/inventory-logs.js:128/221/240` 等处
- **CSV/打印 11 列** — 含 `original_price / original_currency / fx_rate / base_price / base_currency` 双轨字段,完整保留审计信息(`exportLogCSV` / `printLogs` in `inventory-logs.js`)
- **UI 币种 select 统一**(2026-05-18 起)— 删了独立的 `detailCurrency`,详情页统一跟随全局 `inventoryCurrency`。库存/详情/统计三处共用一个 select(顶部全局)
- **modal 内价格联动** — 录入时切 currency select,价格 input 数字按汇率自动换算(`onPriceCurrencyChange` in `inventory-core.js`)。提交时同时存 `originalPrice/originalCurrency`(用户看到的)+ `basePrice/baseCurrency=JPY/fxRate`(系统记账的)
- **推荐价格** — 所有 in logs 各自取 `basePrice`(已是 JPY)平均 → ×3,固定基于 JPY 计算
- **汇率源** frankfurter.app(CNY 基准, 6h 缓存,`fxRates` 在 `inventory-core.js:219`)。`convertCurrency(n, from, to)` 走 CNY 中转
- 历史快照见 `交接_20260517_多币种.md`、`交接_20260518.md`、`交接_20260519_本位币改造.md`(本节是 v4 现状,文档以代码为准)

## 关键文件

- `inventory.html` — HTML 框架 + CDN + 引用 CSS/JS
- `inventory.css` — 全部样式
- `js/inventory-core.js` — Supabase 初始化、`DB`、CRUD、工具函数(`uid/fmt/toast/getProduct/compressImage` 等)
- `js/inventory-ui.js` — 顶部 tab、库存渲染(`renderInventory` 含 `invViewMode`)、建品/编辑/详情 modal、入库/出库/展会 UI
- `js/inventory-logs.js` — 流水筛选/分页/CSV/打印、统计、备份导入导出
- `js/inventory-ai.js` — 相机扫码(ZXing)、AI 识别(Claude/Gemini)、同义词搜索、`openStockOutModal`
- `js/inventory-labels.js` — QR/条码标签、PDF 导出(2026-05-18 起内嵌 NotoSansSC 子集支持中文)
- `fonts/NotoSansSC-Regular-subset.ttf` — 3.2MB 中文字体子集(GB2312+JIS X 0208),给 PDF 用
- `api/ai-recognize.js` — AI 识别后端
- `api/proxy-image.js` — 图片代理(注:本地目录暂时缺这个文件,Vercel 上有)
- `.claude/launch.json` — npx http-server 配置,Claude Preview 本地调试用
- `矿珍库_交接文档v4.md` — 完整历史,遇到不熟的功能先查这里

**改 JS/CSS 后**: 在 `inventory.html` 里把所有 `?v=20260526` 改成新日期(Cmd-F 全文替换),触发缓存刷新。
