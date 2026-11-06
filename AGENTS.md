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
| `/bili` | `views/BiliCommentsView.vue` | B站搜索 + 评论 |
| `/users` | `views/UsersView.vue` | 用户管理（admin） |

## B站页面（`/bili`）

- 双模式，状态全部写在 URL：
  - 搜索：`?keyword=&page=`
  - 评论：`?bvid=&keyword=&spage=&page=&sort=hot|latest`
  - 兼容旧参数 `?input=<链接/BV>`
- 搜索 20 条/页，评论 30 条/页，子评论 10 条/页；搜索、评论、子评论各自分页
- 子评论翻页要**替换**当前列表，不要「加载更多」累加
- 子评论使用固定高度滚动窗口（`.sub-scroll`，max-height 280px），分页条固定在窗口底部、不随列表滚动，外层页面高度不随展开变化
- 子评论正文默认 3 行截断，溢出显示「展开/收起」；`SubReplyItem.vue` 负责渲染与截断
- 子评论整行或右侧「关系图」按钮可打开 `ThreadGraphModal.vue`；主评论的「关系图」按钮可看整楼
- 关系图默认「祖先链 + 后代」，可切「含同层」「整楼」；按回复层级分层布局，不引入图库
- 关系图节点背景色按用户 `mid` 稳定哈希到 12 色盘，同一用户同色；该颜色只用于图内，子评论列表不变色
- 关系图每次最多拉 200 条（20 条/页），超出显示「继续加载」，最多 800 条；同楼重复打开由后端缓存
- 关系图节点超过同层 8 个时默认折叠为「更多回复」节点，点击展开；目标路径不会被折叠
- 关系图工具栏「导出图片」把**当前**关系图（当前焦点 / 模式 / 筛选 / 折叠状态，忽略当前缩放与视口裁剪）重绘为高清 PNG：3x 渲染，受 canvas 上限（单边 16000、桌面 48MP / 移动 20MP）自动降级，图太宽（倍率 < 0.6）时先弹确认并建议缩小范围；页眉带「视频名称 + BV 号」卡片（由 `video-title` / `video-bvid` props 传入）；实现见 `lib/thread-graph-export.ts`，不引入第三方库
- `replyTo` 非空时渲染「回复 @xxx」并可点击进主页，正文里的 `回复 @xxx :` 前缀已由后端剥离
- **禁止加载封面、头像等任何图片**；带图评论用 `[图片]` 占位
- 热度统一用 `components/HeatMeter.vue` 渲染，props：
  `score` / `level` / `label` / `play` / `like` / `likeRate`
  不要在页面里重新计算热度
- 页面切换不整页刷新，依靠查询参数与 `router.replace`
- 使用 `<AppLayout fill>` 的应用壳布局：搜索卡、视频卡、分页卡固定，只有中间 `.scroll-area` 滚动；其他页面不要加 `fill`
- 翻页/切换视频后中间列表回到顶部；返回搜索时恢复上次结果列表的滚动位置

## 通用组件

- `components/ChangePasswordModal.vue`：修改密码弹窗（当前密码 + 新密码 + 确认），由 `AppLayout` 顶栏的锁图标打开
- `components/HeatMeter.vue`：热度温度计
- `components/SubReplyItem.vue`：子评论条目（3 行截断、回复对象、展开/收起、关系图入口）
- `components/ThreadGraphModal.vue`：讨论关系图弹窗（分层布局、用户色背景、缩放平移、分支/参与者筛选、时间进度、导出高清 PNG）
- `lib/thread-graph-export.ts`：关系图导出（按节点坐标重绘到 canvas，页眉/页脚/图例，3x 输出并按 canvas 上限自动降级）

## 约定

- 组件统一用 `<script setup lang="ts">`
- 新增页面放 `src/views/`，并在 `src/router/index.ts` 注册路由
- 全局状态放 Pinia store，页面局部状态留在组件内
- 样式使用全局 CSS 变量（`--primary`、`--surface`、`--border` 等），小圆角、无阴影、支持深浅主题
- 改动后 `npm run build` 必须通过
