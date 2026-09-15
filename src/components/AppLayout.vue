<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ThemeToggle from './ThemeToggle.vue'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const baseNav = [
  {
    key: 'home',
    label: '概览',
    to: '/',
    paths: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  },
  {
    key: 'studio',
    label: '视频创作',
    to: '/studio',
    paths: [
      'M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14',
      'M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z',
    ],
  },
]

const adminNav = [
  {
    key: 'users',
    label: '用户管理',
    to: '/users',
    paths: [
      'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
      'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    ],
  },
]

const navItems = computed(() => (auth.isAdmin ? [...baseNav, ...adminNav] : baseNav))
const displayName = computed(() => auth.user?.displayName || auth.user?.username || '-')
const roleLabel = computed(() => (auth.isAdmin ? '管理员' : '用户'))
const currentTitle = computed(() => navItems.value.find((i) => i.to === route.path)?.label ?? '')

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">
        <span class="mark">Z</span>
        <span class="logo-name">ZenithFlow</span>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="nav-item"
          :class="{ active: route.path === item.to }"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path v-for="(p, i) in item.paths" :key="i" :d="p" />
          </svg>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="side-foot">
        <span class="avatar">{{ displayName.charAt(0).toUpperCase() }}</span>
        <div class="side-user">
          <p class="u-name">{{ displayName }}</p>
          <p class="u-role">{{ roleLabel }}</p>
        </div>
        <button class="icon-btn" title="退出登录" @click="logout">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb"><span class="muted">首页</span> / {{ currentTitle }}</div>
        <div class="top-actions">
          <ThemeToggle />
        </div>
      </header>

      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100svh;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mark {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  background: var(--gradient);
  color: #fff;
  font-weight: 700;
}

.logo-name {
  font-weight: 600;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 14px;
  text-decoration: none;
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.active {
  background: var(--primary);
  color: #fff;
}

.side-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--surface-2);
  font-weight: 600;
  color: var(--text);
}

.side-user {
  flex: 1;
  min-width: 0;
}

.u-name {
  margin: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.u-role {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 60px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.crumb {
  font-size: 14px;
}

.muted {
  color: var(--text-muted);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}

@media (max-width: 720px) {
  .sidebar {
    display: none;
  }
}
</style>
