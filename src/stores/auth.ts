import { defineStore } from 'pinia'
import { apiFetch, clearToken, getToken, setToken } from '../lib/api'

export type Role = 'admin' | 'user'

export type AuthUser = {
  id: number
  username: string
  role: Role
  displayName: string | null
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    user: null as AuthUser | null,
  }),
  getters: {
    isAuthed: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    async login(username: string, password: string) {
      const data = await apiFetch<{ ok: boolean; token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      this.token = data.token
      this.user = data.user
      setToken(data.token)
    },
    async fetchMe() {
      try {
        const data = await apiFetch<{ ok: boolean; user: AuthUser }>('/auth/me')
        this.user = data.user
      } catch {
        this.logout()
      }
    },
    logout() {
      this.token = null
      this.user = null
      clearToken()
    },
  },
})
