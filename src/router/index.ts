import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
    },
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/studio',
      name: 'studio',
      component: () => import('../views/StudioView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/studio/:id',
      name: 'studio-detail',
      component: () => import('../views/StudioDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/kb',
      name: 'kb',
      component: () => import('../views/KnowledgeView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/bili',
      name: 'bili-comments',
      component: () => import('../views/BiliCommentsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/english',
      name: 'english',
      component: () => import('../views/EnglishView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('../views/UsersView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isAuthed) {
    return { name: 'login' }
  }

  if (to.name === 'login' && auth.isAuthed) {
    return { name: 'home' }
  }

  if (to.meta.requiresAuth && auth.isAuthed && !auth.user) {
    await auth.fetchMe()
    if (!auth.user) {
      return { name: 'login' }
    }
  }

  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'home' }
  }
})

// 重新部署后旧 chunk 会被删除，浏览器缓存的 index 仍可能引用旧文件名。
// 命中动态 import 失败时自动刷新一次，拿到新的 index 和 chunk。
router.onError((error) => {
  const message = String((error as Error)?.message ?? error)
  if (!/Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)) {
    return
  }

  const key = 'zenithflow-chunk-reload'
  const last = Number(sessionStorage.getItem(key) ?? '0')
  if (Date.now() - last < 10_000) return

  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
})

export default router
