# 前端规则（frontend）

Vue 3 + Vite + TypeScript + Vue Router + Pinia。

## 命令

- `npm run dev`：本地开发（Vite Dev Server）
- `npm run build`：类型检查（vue-tsc）+ 构建，产物在 `dist/`
- `npm run preview`：预览构建产物

## 结构

- `src/main.ts`：入口，挂载 Pinia 与 Router
- `src/App.vue`：根组件（`<RouterView />`）
- `src/router/index.ts`：路由表
- `src/views/`：页面级组件
- `src/stores/`：Pinia stores
- `src/components/`：可复用组件

## 页面

| 路由 | 文件 | 说明 |
| --- | --- | --- |
| `/login` | `views/LoginView.vue` | 登录 |
| `/` | `views/HomeView.vue` | 概览 + 千问余额 |
| `/studio` | `views/StudioView.vue` | 视频项目列表 / 创建 |
| `/studio/:id` | `views/StudioDetailView.vue` | 分镜、配音、成片 |
| `/kb` | `views/KnowledgeView.vue` | 知识库 |
| `/english` | `views/EnglishView.vue` | 英语口语（admin） |
| `/bili` | `views/BiliCommentsView.vue` | B站视频 / UP 主搜索 + 评论 |
| `/newspaper` | `views/NewspaperView.vue` | 每日日报（杭州 / 本溪 / B站吃瓜 / Steam / 中国 / 世界） |
| `/users` | `views/UsersView.vue` | 用户管理（admin） |

## B站页面（`/bili`）

- 三个标签：搜视频 / 搜UP主 / 链接·BV，状态全部写在 URL：
  - 视频搜索：`?keyword=&page=`
  - UP 主搜索：`?stype=up&keyword=&upage=`
  - UP 主投稿：`?stype=up&up=<mid>&uppage=&uporder=pubdate|click`（带 `keyword/upage` 便于返回列表）
  - 评论：`?bvid=&keyword=&spage=&sort=hot|latest&view=grid&loaded=100`；从 UP 投稿进入时改为 `?bvid=&stype=up&up=&uppage=&uporder=...`
  - 兼容旧参数 `?input=<链接/BV>` 和旧评论页码 `?page=`
- 主评论为无限滚动，没有页码分页条：首屏 100 条，滚动到距底部 240px 时自动加 50 条；`loaded` 记录已加载数量，刷新时按 50 条一批补到该数量（上限 1000）
- 评论视图支持「列式 / 卡片」切换，默认列式；`view=grid` 为卡片视图
- 卡片视图用 CSS 多列实现瀑布流（`column-count`，≥1280 三列、860~1280 两列、<860 单列），卡片 `break-inside: avoid`、高度随评论内容自适应，正文不截断；展开子评论时后续卡片可能重新平衡换列，属正常现象
- 视频搜索 20 条/页；UP 主搜索 20 条/页、最多 50 页；UP 投稿 20 条/页、**最多 10 页 / 200 条**（B 站游客限制），超出时页面提示「仅显示前 200 个投稿」
- UP 投稿可切「最新发布 / 最多播放」；列表不含点赞/评论数，因此不显示热度温度计
- 评论页返回按钮按来源回到视频搜索或 UP 投稿列表，并恢复滚动位置
- 视频搜索结果里的 UP 名字可点击，直接切到「搜UP主」搜该名字（`@click.stop`，不要误触进评论）
- 顶部右侧有 B站账号入口：未绑定显示「B站登录」，已绑定显示 `B站：昵称` + 重新绑定 / 解绑；扫码弹窗为 `BiliLoginModal.vue`
- 扫码二维码由前端 `qrcode` 库在 canvas 本地生成，不请求远程图片；这是「页面不加载图片」规则的唯一例外，不显示 B站头像/封面
- 绑定接口：`POST /api/bili/auth/qrcode`、`GET /api/bili/auth/qrcode/poll?key=`、`GET /api/bili/auth/me`、`DELETE /api/bili/auth`；登录成功只接收 `mid/uname` 等摘要，Cookie 永不进前端
- 点赞 / 回复需要先绑定 B 站账号：主评论和子评论都有「赞」「回复」按钮；未绑定或已过期时点击直接打开 `BiliLoginModal` 并在页头提示
- 点赞为乐观更新（先改本地计数再请求 `POST /api/bili/comments/like`，失败回滚）；B 站评论列表不返回当前账号点赞状态，所以已赞状态只在本会话内记忆，刷新后按未赞显示
- 回复/发评论复用 `BiliReplyModal.vue`：主评论回复带 `root=parent=主评论rpid`，楼中楼回复带 `root=主评论rpid&parent=子评论rpid`，顶部输入框发顶层评论（`root=parent=0`）；发布成功后本地回显并把子评论数 +1
- 发布接口 `POST /api/bili/comments`；内容 1~1000 字，提交中禁用按钮，错误直接显示在弹窗内
- 搜索 20 条/页，主评论首屏 100 条 / 触底 +50 条，子评论 10 条/页；子评论仍用页码分页
- 子评论翻页要**替换**当前列表，不要「加载更多」累加
- 子评论使用固定高度滚动窗口（`.sub-scroll`，max-height 280px），分页条固定在窗口底部、不随列表滚动，外层页面高度不随展开变化
- 子评论正文默认 3 行截断，溢出显示「展开/收起」；`SubReplyItem.vue` 负责渲染与截断
- 子评论整行或右侧「关系图」按钮可打开 `ThreadGraphModal.vue`；主评论的「关系图」按钮可看整楼
- 关系图默认「祖先链 + 后代」，可切「含同层」「整楼」；按回复层级分层布局，不引入图库
- 关系图节点背景色按用户 `mid` 稳定哈希到 12 色盘，同一用户同色；该颜色只用于图内，子评论列表不变色
- 关系图每次最多拉 200 条（20 条/页），超出显示「继续加载」，最多 800 条；同楼重复打开由后端缓存
- 关系图节点超过同层 8 个时默认折叠为「更多回复」节点，点击展开；目标路径不会被折叠
- 关系图工具栏「导出图片」把**当前**关系图（当前焦点 / 模式 / 筛选 / 折叠状态，忽略当前缩放与视口裁剪）重绘为高清 PNG：3x 渲染，受 canvas 上限（单边 16000、桌面 48MP / 移动 20MP）自动降级，图太宽（倍率 < 0.6）时先弹确认并建议缩小范围；页眉带「视频名称 + BV 号」卡片（由 `video-title` / `video-bvid` props 传入）；导出时**评论正文不截断**，按文字行数增高节点卡片，并重排每行行距（仅导出，界面仍是 3 行 + 展开弹窗）；实现见 `lib/thread-graph-export.ts`，不引入第三方库
- `replyTo` 非空时渲染「回复 @xxx」并可点击进主页，正文里的 `回复 @xxx :` 前缀已由后端剥离
- **禁止加载封面、头像等任何图片**；带图评论用 `[图片]` 占位
- 热度统一用 `components/HeatMeter.vue` 渲染，props：
  `score` / `level` / `label` / `play` / `like` / `likeRate`
  不要在页面里重新计算热度
- 页面切换不整页刷新，依靠查询参数与 `router.replace`
- 使用 `<AppLayout fill>` 的应用壳布局：搜索卡、视频卡、分页卡固定，只有中间 `.scroll-area` 滚动；其他页面不要加 `fill`
- 翻页/切换视频后中间列表回到顶部；返回搜索时恢复上次结果列表的滚动位置

## 日报页面（`/newspaper`）

- 所有登录用户可见；侧栏「日报」
- 页面只读取 `GET /api/newspaper/today`，六个版块顺序由后端返回，前端不写死内容
- 版块顺序：杭州 → 本溪 → B站吃瓜 → Steam → 中国 → 世界；顶部锚点按钮滚动到对应版块
- 每条显示：`官方 / 民间 / 综合` 标签、标题（新窗口打开原文）、2-3 句摘要、来源、热度文案、时间、标签
- 生成中每 6 秒轮询一次；今日生成失败或尚未生成时，后端回退到最近一期，页面用顶部横幅提示 `stale/error`
- 管理员显示「重新生成」按钮，点击前确认；`POST /api/newspaper/generate` 返回后继续轮询
- 「打印」调用 `window.print()`，打印样式隐藏按钮/锚点
- 纯文字，不加载图片；日期、生成时间固定按 Asia/Shanghai 显示
- 样式使用全局 CSS 变量；报头/版块标题用 serif，正文用默认 sans；移动端单列

## 通用组件

- `components/ChangePasswordModal.vue`：修改密码弹窗（当前密码 + 新密码 + 确认），由 `AppLayout` 顶栏的锁图标打开
- `components/BiliLoginModal.vue`：B站扫码登录弹窗（本地 canvas 二维码、2 秒轮询、刷新/失效/成功状态），由 `/bili` 顶部账号入口打开
- `components/BiliReplyModal.vue`：回复 / 发评论弹窗（1000 字上限、字数统计、Ctrl/⌘+Enter 发布、提交中禁用、错误展示）
- `components/HeatMeter.vue`：热度温度计
- `components/SubReplyItem.vue`：子评论条目（3 行截断、回复对象、展开/收起、关系图入口）
- `components/ThreadGraphModal.vue`：讨论关系图弹窗（分层布局、用户色背景、缩放平移、分支/参与者筛选、时间进度、导出高清 PNG）；只能点右上角 ×（或 Esc）关闭，点遮罩 / 拖动后在遮罩松开不关闭
- `lib/thread-graph-export.ts`：关系图导出（按节点坐标重绘到 canvas，页眉/页脚/图例，3x 输出并按 canvas 上限自动降级）

## 约定

- 组件统一用 `<script setup lang="ts">`
- 新增页面放 `src/views/`，并在 `src/router/index.ts` 注册路由
- 全局状态放 Pinia store，页面局部状态留在组件内
- 样式使用全局 CSS 变量（`--primary`、`--surface`、`--border` 等），小圆角、无阴影、支持深浅主题
- **scoped 样式里不要写 `:global(祖先) 后代`**：Vue 会用 `:global()` 的内容替换整条选择器，`:global([data-theme='dark']) .node-card::before` 会编译成 `[data-theme=dark]{…}` 命中 `<html>`，导致整站被压暗。需要随主题变的值用全局 CSS 变量（如 `--node-tint`），在 `src/style.css` 的 `:root` / `:root[data-theme='dark']` 中定义
- 改样式后除 `npm run build` 通过外，检查 `dist/assets/*.css` 有无命中 `html`/`body`/主题属性的 `opacity`、`filter` 规则；必要时跨路由切换验证不残留
- 改动后 `npm run build` 必须通过
