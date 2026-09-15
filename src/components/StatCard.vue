<script setup lang="ts">
const props = defineProps<{
  label: string
  value: string
  delta: string
  trend: 'up' | 'down'
  spark: number[]
}>()

const W = 180
const H = 40

const points = (() => {
  const max = Math.max(...props.spark)
  const min = Math.min(...props.spark)
  const range = max - min || 1
  const step = W / (props.spark.length - 1)
  return props.spark
    .map((v, i) => `${i * step},${H - 4 - ((v - min) / range) * (H - 8)}`)
    .join(' ')
})()
</script>

<template>
  <div class="card stat">
    <p class="label">{{ label }}</p>
    <p class="value">{{ value }}</p>
    <svg class="spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
      <polyline :points="points" fill="none" stroke="var(--primary)" stroke-width="2" />
    </svg>
    <p class="delta" :class="trend">{{ trend === 'up' ? '↑' : '↓' }} {{ delta }}</p>
  </div>
</template>

<style scoped>
.stat {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.value {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.spark {
  width: 100%;
  height: 36px;
}

.delta {
  margin: 0;
  font-size: 12px;
}

.delta.up {
  color: var(--success);
}

.delta.down {
  color: var(--danger);
}
</style>
