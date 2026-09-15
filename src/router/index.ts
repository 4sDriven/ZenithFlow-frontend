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

export default router
