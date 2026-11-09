<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ src: string | null }>()

const audioEl = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const rate = ref(1)
const currentTime = ref(0)
const duration = ref(0)
const aPoint = ref<number | null>(null)
const bPoint = ref<number | null>(null)
const pendingSeek = ref<{ seconds: number; autoplay: boolean } | null>(null)

const rates = [0.5, 0.75, 1, 1.25]

const abActive = computed(() => aPoint.value !== null && bPoint.value !== null)

function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function toggle() {
  const el = audioEl.value
  if (!el) return
  if (el.paused) void el.play()
  else el.pause()
}

function skip(delta: number) {
  const el = audioEl.value
  if (!el) return
  el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta))
}

function setRate(value: number) {
  rate.value = value
  if (audioEl.value) audioEl.value.playbackRate = value
}

function markA() {
  aPoint.value = currentTime.value
  if (bPoint.value !== null && bPoint.value <= aPoint.value) bPoint.value = null
}

function markB() {
  if (aPoint.value === null) return
  bPoint.value = currentTime.value > aPoint.value ? currentTime.value : null
}

function clearAB() {
  aPoint.value = null
  bPoint.value = null
}

function onLoadedMetadata() {
  duration.value = audioEl.value?.duration ?? 0
  const pending = pendingSeek.value
  if (pending) {
    pendingSeek.value = null
    applySeek(pending.seconds, pending.autoplay)
  }
}

function applySeek(seconds: number, autoplay: boolean) {
  const el = audioEl.value
  if (!el) return
  el.currentTime = Math.max(0, seconds)
  if (autoplay) void el.play()
}

function seekTo(seconds: number, autoplay = true) {
  const el = audioEl.value
  if (!el) return
  if (Number.isFinite(el.duration) && el.duration > 0) applySeek(seconds, autoplay)
  else pendingSeek.value = { seconds, autoplay }
}

function onTimeUpdate() {
  const el = audioEl.value
  if (!el) return
  currentTime.value = el.currentTime
  if (abActive.value && aPoint.value !== null && bPoint.value !== null) {
    if (el.currentTime >= bPoint.value || el.currentTime < aPoint.value - 0.3) {
      el.currentTime = aPoint.value
    }
  }
}

watch(
  () => props.src,
  () => {
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    pendingSeek.value = null
    clearAB()
  },
)

onBeforeUnmount(() => {
  audioEl.value?.pause()
})

defineExpose({ seekTo })
</script>

<template>
  <div class="player">
    <audio
      ref="audioEl"
      :src="src ?? undefined"
      preload="metadata"
      @play="playing = true"
      @pause="playing = false"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
    />

    <div v-if="!src" class="empty">该期暂无音频，可直接看文稿跟读。</div>

    <template v-else>
      <div class="bar">
        <button class="icon-btn" title="后退 5 秒" @click="skip(-5)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 19H4v-7" /><path d="M19 12a8 8 0 1 0-3 6.2" />
          </svg>
        </button>
        <button class="play" :title="playing ? '暂停' : '播放'" @click="toggle">
          <svg v-if="!playing" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
        </button>
        <button class="icon-btn" title="前进 5 秒" @click="skip(5)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 5h7v7" /><path d="M5 12a8 8 0 1 1 3 6.2" />
          </svg>
        </button>

        <span class="time">{{ fmt(currentTime) }} / {{ fmt(duration) }}</span>

        <div class="rates">
          <button
            v-for="r in rates"
            :key="r"
            class="rate"
            :class="{ active: rate === r }"
            @click="setRate(r)"
          >
            {{ r }}x
          </button>
        </div>
      </div>

      <div class="ab">
        <button class="mini" :class="{ active: aPoint !== null }" @click="markA">设 A</button>
        <button class="mini" :class="{ active: bPoint !== null }" @click="markB">设 B</button>
        <button class="mini" :disabled="!abActive" @click="clearAB">清除</button>
        <span class="ab-hint">
          {{
            abActive
              ? `循环 ${fmt(aPoint ?? 0)} → ${fmt(bPoint ?? 0)}`
              : '播放到难句起点点「设 A」，句尾点「设 B」，即可循环精听'
          }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty {
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 13px;
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.play {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--primary);
  color: var(--primary-fg);
  cursor: pointer;
}

.play:hover {
  background: var(--primary-hover);
}

.time {
  font-size: 13px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.rates {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.rate,
.mini {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.rate.active,
.mini.active {
  border-color: var(--primary);
  color: var(--primary);
}

.ab {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ab-hint {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
