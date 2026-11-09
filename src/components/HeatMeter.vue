<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  score: number
  level: number
  label: string
  play: number
  like: number
  likeRate: number
}>()

const COLORS = ['#94a3b8', '#38bdf8', '#f59e0b', '#f97316', '#ef4444']
const TUBE_X = 14
const TUBE_W = 76

const color = computed(() => COLORS[props.level] ?? COLORS[0])
const fillWidth = computed(() => {
  const safe = Math.min(1, Math.max(0, props.score))
  return Number((safe * TUBE_W).toFixed(1))
})

function formatCount(value: number): string {
  if (!value) return '0'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return String(value)
}

const tooltip = computed(() => {
  const percent = props.likeRate > 0 ? `${(props.likeRate * 100).toFixed(2)}%` : '0%'
  return `播放 ${formatCount(props.play)} · 点赞 ${formatCount(props.like)} · 点赞率 ${percent} · 热度 ${props.label}`
})
</script>

<template>
  <div
    class="heat"
    :class="{ blazing: level >= 4 }"
    :title="tooltip"
    :aria-label="`热度：${label}`"
    role="img"
  >
    <svg width="96" height="20" viewBox="0 0 96 20" fill="none" aria-hidden="true">
      <circle cx="8" cy="10" r="6" :fill="color" />
      <rect
        :x="TUBE_X"
        y="4.5"
        :width="TUBE_W"
        height="11"
        rx="5.5"
        fill="var(--surface-2)"
        stroke="var(--border)"
      />
      <rect
        v-if="fillWidth > 0"
        :x="TUBE_X"
        y="4.5"
        :width="fillWidth"
        height="11"
        rx="5.5"
        :fill="color"
      />
      <g stroke="var(--surface)" stroke-width="1" opacity="0.75">
        <line x1="33" y1="5" x2="33" y2="15" />
        <line x1="52" y1="5" x2="52" y2="15" />
        <line x1="71" y1="5" x2="71" y2="15" />
      </g>
    </svg>
    <span class="heat-label" :style="{ color }">{{ label }}</span>
  </div>
</template>

<style scoped>
.heat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  cursor: default;
}

.heat-label {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.heat.blazing svg {
  animation: heat-pulse 2.6s ease-in-out infinite;
}

@keyframes heat-pulse {
  0%,
  100% {
    filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.35));
  }
  50% {
    filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.65));
  }
}

@media (prefers-reduced-motion: reduce) {
  .heat.blazing svg {
    animation: none;
  }
}
</style>
