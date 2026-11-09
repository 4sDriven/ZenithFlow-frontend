<script setup lang="ts">
import { computed, ref } from 'vue'
import { ApiError, apiFetch } from '../lib/api'

type BalanceResponse = {
  balance: { availableAmount: string; currency: string }
  fetchedAt: string
}

const amount = ref<string | null>(null)
const currency = ref('CNY')
const fetchedAt = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

const symbol = computed(() => (currency.value === 'CNY' ? '¥' : `${currency.value} `))

const updatedAt = computed(() => {
  if (!fetchedAt.value) return ''
  return new Date(fetchedAt.value).toLocaleString('zh-CN', { hour12: false })
})

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const res = await apiFetch<BalanceResponse>('/qwen/balance')
    amount.value = res.balance.availableAmount
    currency.value = res.balance.currency
    fetchedAt.value = res.fetchedAt
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '查询失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="card balance-card">
    <div class="head">
      <div class="titles">
        <h3>千问余额</h3>
        <p class="hint">
          {{ fetchedAt ? `更新于 ${updatedAt}` : '点击刷新按钮查询（不会自动刷新）' }}
        </p>
      </div>
      <button class="icon-btn" :disabled="loading" title="刷新余额" @click="refresh">
        <svg
          :class="{ spin: loading }"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
      </button>
    </div>
    <p class="amount">
      <template v-if="amount !== null">{{ symbol }}{{ amount }}</template>
      <span v-else class="empty">—</span>
    </p>
    <p v-if="error" class="err">{{ error }}</p>
  </section>
</template>

<style scoped>
.balance-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.titles h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.amount {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.amount .empty {
  color: var(--text-muted);
}

.err {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
