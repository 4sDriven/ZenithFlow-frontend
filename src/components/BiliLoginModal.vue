<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { ApiError, apiFetch } from '../lib/api'

type BiliAccount = {
  mid: string
  uname: string
  boundAt: string
  updatedAt: string
  expiresAt: string | null
  expired: boolean
}

type QrResponse = {
  ok: boolean
  key: string
  url: string
  expiresIn: number
}

type PollResponse = {
  ok: boolean
  status: 'waiting' | 'scanned' | 'expired' | 'success'
  message?: string
  error?: string
  account?: BiliAccount | null
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'bound', account: BiliAccount | null): void
}>()

const phase = ref<'loading' | 'waiting' | 'scanned' | 'success' | 'expired' | 'error'>(
  'loading',
)
const error = ref('')
const account = ref<BiliAccount | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

let timer: number | undefined
let activeKey = ''

const statusText = computed(() => {
  if (phase.value === 'loading') return '正在获取二维码…'
  if (phase.value === 'waiting') return '等待扫码'
  if (phase.value === 'scanned') return '已扫码，请在手机上确认'
  return ''
})

function stopTimer() {
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
}

function close() {
  stopTimer()
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

async function start() {
  stopTimer()
  phase.value = 'loading'
  error.value = ''
  account.value = null

  try {
    const data = await apiFetch<QrResponse>('/bili/auth/qrcode', { method: 'POST' })
    activeKey = data.key
    await nextTick()
    if (canvas.value) {
      await QRCode.toCanvas(canvas.value, data.url, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#111827', light: '#ffffff' },
      })
    }
    phase.value = 'waiting'
    schedulePoll()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '获取二维码失败，请稍后再试'
    phase.value = 'error'
  }
}

function schedulePoll() {
  stopTimer()
  timer = window.setTimeout(() => {
    void poll()
  }, 2000)
}

async function poll() {
  if (!props.open || !activeKey) return

  try {
    const data = await apiFetch<PollResponse>(
      `/bili/auth/qrcode/poll?key=${encodeURIComponent(activeKey)}`,
    )
    if (!props.open) return

    if (data.status === 'success') {
      phase.value = 'success'
      account.value = data.account ?? null
      emit('bound', data.account ?? null)
      stopTimer()
      return
    }
    if (data.status === 'expired') {
      phase.value = 'expired'
      stopTimer()
      return
    }
    phase.value = data.status
    schedulePoll()
  } catch (err) {
    if (!props.open) return
    if (err instanceof ApiError && err.status === 410) {
      phase.value = 'expired'
      stopTimer()
      return
    }
    error.value = err instanceof ApiError ? err.message : '轮询登录状态失败，请稍后再试'
    phase.value = 'error'
    stopTimer()
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown)
      void start()
    } else {
      stopTimer()
      window.removeEventListener('keydown', onKeydown)
    }
  },
)

onBeforeUnmount(() => {
  stopTimer()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="bili-login-title">
      <h3 id="bili-login-title">B站扫码登录</h3>

      <template v-if="phase === 'success'">
        <p class="ok">已绑定 B站账号</p>
        <div class="account-box">
          <strong>{{ account?.uname || 'B站账号' }}</strong>
          <span>UID {{ account?.mid }}</span>
        </div>
        <p class="note">登录凭据已加密保存在当前站点账号下，不会展示给其他人。</p>
        <div class="actions">
          <button type="button" class="btn btn-primary" @click="close">完成</button>
        </div>
      </template>

      <template v-else>
        <div class="qr-wrap">
          <canvas ref="canvas" class="qr" width="220" height="220"></canvas>
          <div v-if="phase === 'loading'" class="qr-mask">二维码生成中…</div>
          <div v-else-if="phase === 'expired' || phase === 'error'" class="qr-mask">
            <p>{{ phase === 'expired' ? '二维码已失效' : error }}</p>
            <button type="button" class="btn btn-ghost btn-sm" @click="start">
              刷新二维码
            </button>
          </div>
        </div>

        <p v-if="statusText" class="status">{{ statusText }}</p>
        <p class="note">
          请使用 B站手机客户端扫码，二维码 3 分钟内有效。本站只保存登录凭据用于 B站相关功能。
        </p>

        <div class="actions">
          <button type="button" class="btn btn-ghost" @click="close">取消</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.55);
}

.dialog {
  width: min(380px, 100%);
  padding: 20px;
}

h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
}

.qr-wrap {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
}

.qr {
  display: block;
  width: 220px;
  height: 220px;
  border-radius: var(--radius-sm);
  background: #fff;
}

.qr-mask {
  position: absolute;
  inset: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.92);
  color: #374151;
  font-size: 13px;
  text-align: center;
  padding: 16px;
}

.qr-mask p {
  margin: 0;
}

.status {
  margin: 12px 0 0;
  text-align: center;
  font-size: 13px;
  color: var(--text);
}

.note {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.ok {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--success);
}

.account-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 13px;
}

.account-box span {
  color: var(--text-muted);
  font-size: 12px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
}
</style>
