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

## 约定

- 组件统一用 `<script setup lang="ts">`
- 新增页面放 `src/views/`，并在 `src/router/index.ts` 注册路由
- 状态放 Pinia store，避免组件内散落全局状态
