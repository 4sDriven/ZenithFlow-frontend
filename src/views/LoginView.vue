<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ApiError } from '../lib/api'
import ThemeToggle from '../components/ThemeToggle.vue'

const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }

  loading.value = true
  error.value = ''

  try {
    await auth.login(username.value, password.value)
    router.push('/')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登录失败，请重试'
    password.value = ''
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <section class="brand">
      <div class="brand-head">
        <span class="mark">Z</span>
        <span class="name">ZenithFlow</span>
      </div>

      <div class="deco" aria-hidden="true">
        <span class="shape circle c1"></span>
        <span class="shape circle c2"></span>
        <span class="shape square s1"></span>
        <span class="shape square s2"></span>
        <span class="shape ring"></span>
      </div>

      <p class="tagline">The intelligent workflow platform for modern teams</p>
    </section>

    <section class="panel">
      <div class="panel-top">
        <ThemeToggle />
      </div>

      <form class="form" @submit.prevent="onSubmit">
        <h1>ZenithFlow</h1>
        <p class="sub">登录你的账号</p>

        <label class="field">
          <span class="field-label">用户名</span>
          <input v-model="username" class="input" type="text" placeholder="用户名" autocomplete="username" autofocus />
        </label>

        <label class="field">
          <span class="field-label">密码</span>
          <input v-model="password" class="input" type="password" placeholder="密码" autocomplete="current-password" />
        </label>

        <p class="error" :class="{ show: !!error }">{{ error }}</p>

        <button class="btn btn-primary submit" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>
      </form>

      <p class="foot">© {{ new Date().getFullYear() }} ZenithFlow</p>
    </section>
  </div>
</template>

<style scoped>
.login {
  min-height: 100svh;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
}

.brand {
  position: relative;
  overflow: hidden;
  padding: 40px;
  background: var(--gradient);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.brand-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.mark {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.16);
  font-weight: 700;
}

.name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.tagline {
  position: relative;
  z-index: 1;
  margin: 0;
  max-width: 22ch;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.35;
}

.deco {
  position: absolute;
  inset: 0;
}

.shape {
  position: absolute;
  background: rgba(255, 255, 255, 0.13);
}

.circle {
  border-radius: 50%;
}

.c1 {
  width: 220px;
  height: 220px;
  top: 12%;
  left: 8%;
}

.c2 {
  width: 120px;
  height: 120px;
  left: 28%;
  bottom: 14%;
  background: rgba(255, 255, 255, 0.09);
}

.square {
  border-radius: var(--radius-lg);
}

.s1 {
  width: 84px;
  height: 84px;
  top: 30%;
  right: 14%;
  transform: rotate(18deg);
}

.s2 {
  width: 54px;
  height: 54px;
  right: 24%;
  bottom: 22%;
  transform: rotate(-12deg);
  background: rgba(255, 255, 255, 0.09);
}

.ring {
  width: 260px;
  height: 260px;
  top: -60px;
  right: -60px;
  border-radius: 50%;
  border: 30px solid rgba(255, 255, 255, 0.12);
  background: transparent;
}

.panel {
  display: flex;
  flex-direction: column;
  padding: 24px;
  background: var(--bg);
}

.panel-top {
  display: flex;
  justify-content: flex-end;
}

.form {
  margin: auto;
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.4px;
}

.sub {
  margin: -8px 0 6px;
  font-size: 14px;
  color: var(--text-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  color: var(--text-muted);
}

.input {
  width: 100%;
  padding: 11px 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 15px;
}

.input:focus {
  outline: none;
  border-color: var(--primary);
}

.error {
  margin: 0;
  min-height: 18px;
  font-size: 13px;
  color: var(--danger);
  visibility: hidden;
}

.error.show {
  visibility: visible;
}

.submit {
  width: 100%;
}

.foot {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

@media (max-width: 820px) {
  .login {
    grid-template-columns: 1fr;
  }

  .brand {
    display: none;
  }
}
</style>
