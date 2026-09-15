<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { ApiError, apiFetch } from '../lib/api'
import { useAuthStore, type Role } from '../stores/auth'

type User = {
  id: number
  username: string
  role: Role
  displayName: string | null
  createdAt: string
}

const auth = useAuthStore()

const users = ref<User[]>([])
const loading = ref(false)
const error = ref('')

const form = ref({ username: '', password: '', role: 'user' as Role, displayName: '' })
const creating = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await apiFetch<{ ok: boolean; users: User[] }>('/users')
    users.value = data.users
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function create() {
  creating.value = true
  error.value = ''
  try {
    await apiFetch('/users', { method: 'POST', body: JSON.stringify(form.value) })
    form.value = { username: '', password: '', role: 'user', displayName: '' }
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '创建失败'
  } finally {
    creating.value = false
  }
}

function onRoleChange(user: User, event: Event) {
  const role = (event.target as HTMLSelectElement).value as Role
  void setRole(user, role)
}

async function setRole(user: User, role: Role) {
  error.value = ''
  try {
    await apiFetch(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role }) })
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '更新失败'
  }
}

async function remove(user: User) {
  if (!window.confirm(`确定删除用户「${user.username}」？`)) return
  error.value = ''
  try {
    await apiFetch(`/users/${user.id}`, { method: 'DELETE' })
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '删除失败'
  }
}

onMounted(load)
</script>

<template>
  <AppLayout>
    <section class="card panel">
      <h3>新建用户</h3>
      <form class="create-form" @submit.prevent="create">
        <input v-model="form.username" class="input" placeholder="用户名" />
        <input v-model="form.password" class="input" type="password" placeholder="密码（≥6位）" />
        <input v-model="form.displayName" class="input" placeholder="显示名（可选）" />
        <select v-model="form.role" class="input select">
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          {{ creating ? '创建中…' : '创建' }}
        </button>
      </form>
      <p v-if="error" class="err">{{ error }}</p>
    </section>

    <section class="card panel">
      <h3>用户列表</h3>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>显示名</th>
              <th>角色</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.id }}</td>
              <td>
                {{ u.username }}
                <span v-if="u.id === auth.user?.id" class="tag">我</span>
              </td>
              <td>{{ u.displayName || '-' }}</td>
              <td>
                <select
                  class="select select-sm"
                  :value="u.role"
                  :disabled="u.id === auth.user?.id"
                  @change="onRoleChange(u, $event)"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </td>
              <td>
                <button
                  class="btn btn-ghost btn-sm"
                  :disabled="u.id === auth.user?.id"
                  @click="remove(u)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="loading" class="muted-text">加载中…</p>
      <p v-else-if="users.length === 0" class="muted-text">暂无用户</p>
    </section>
  </AppLayout>
</template>

<style scoped>
.panel {
  padding: 18px;
}

h3 {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 600;
}

.create-form {
  display: grid;
  grid-template-columns: repeat(4, 1fr) auto;
  gap: 10px;
}

.input {
  width: 100%;
  padding: 9px 11px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}

.input:focus {
  outline: none;
  border-color: var(--primary);
}

.select {
  appearance: none;
  cursor: pointer;
}

.select:disabled {
  opacity: 0.5;
  cursor: default;
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.table th,
.table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.table th {
  color: var(--text-muted);
  font-weight: 500;
}

.select-sm {
  width: auto;
  padding: 5px 8px;
}

.btn-sm {
  padding: 5px 10px;
  font-size: 13px;
}

.tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
}

.err {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--danger);
}

.muted-text {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .create-form {
    grid-template-columns: 1fr;
  }
}
</style>
