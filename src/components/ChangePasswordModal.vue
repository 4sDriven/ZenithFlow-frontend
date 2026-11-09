<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, apiFetch } from '../lib/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const success = ref(false)
const currentInput = ref<HTMLInputElement | null>(null)

function close() {
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      error.value = ''
      success.value = false
      loading.value = false
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      currentInput.value?.focus()
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

async function submit() {
  if (!currentPassword.value) {
    error.value = '请输入当前密码'
    return
  }
  if (newPassword.value.length < 8) {
    error.value = '新密码至少 8 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  if (newPassword.value === currentPassword.value) {
    error.value = '新密码不能与当前密码相同'
    return
  }

  loading.value = true
  error.value = ''
  try {
    await apiFetch('/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    })
    success.value = true
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '修改失败，请稍后再试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <h3 id="change-password-title">修改密码</h3>

      <template v-if="!success">
        <form class="form" @submit.prevent="submit">
          <label class="field">
            <span>当前密码</span>
            <input
              ref="currentInput"
              v-model="currentPassword"
              class="input"
              type="password"
              autocomplete="current-password"
            />
          </label>
          <label class="field">
            <span>新密码（至少 8 位）</span>
            <input
              v-model="newPassword"
              class="input"
              type="password"
              autocomplete="new-password"
            />
          </label>
          <label class="field">
            <span>确认新密码</span>
            <input
              v-model="confirmPassword"
              class="input"
              type="password"
              autocomplete="new-password"
            />
          </label>

          <p v-if="error" class="err">{{ error }}</p>

          <div class="actions">
            <button type="button" class="btn btn-ghost" @click="close">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="loading">
              {{ loading ? '保存中…' : '保存' }}
            </button>
          </div>
        </form>
      </template>

      <template v-else>
        <p class="ok">密码已更新，下次登录请使用新密码。</p>
        <div class="actions">
          <button type="button" class="btn btn-primary" @click="close">完成</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.55);
}

.dialog {
  width: min(420px, 100%);
  padding: 20px;
}

h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
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

.err {
  margin: 0;
  font-size: 13px;
  color: var(--danger);
}

.ok {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--success);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
