<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const recording = ref(false)
const error = ref('')
const clipUrl = ref('')
const elapsed = ref(0)

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let timer: number | null = null

function startTimer() {
  elapsed.value = 0
  timer = window.setInterval(() => {
    elapsed.value += 0.1
  }, 100)
}

function stopTimer() {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

async function start() {
  error.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' })
      if (clipUrl.value) URL.revokeObjectURL(clipUrl.value)
      clipUrl.value = URL.createObjectURL(blob)
    }
    recorder.start()
    recording.value = true
    startTimer()
  } catch {
    error.value = '无法访问麦克风，请检查浏览器权限'
  }
}

function stop() {
  recorder?.stop()
  recorder = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  recording.value = false
  stopTimer()
}

function reset() {
  if (clipUrl.value) URL.revokeObjectURL(clipUrl.value)
  clipUrl.value = ''
  elapsed.value = 0
}

onBeforeUnmount(() => {
  stop()
  reset()
})
</script>

<template>
  <div class="recorder">
    <button v-if="!recording" class="btn btn-ghost btn-sm" @click="start">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
      </svg>
      跟读录音
    </button>
    <button v-else class="btn btn-sm rec" @click="stop">
      <span class="dot" /> 停止录音 {{ elapsed.toFixed(1) }}s
    </button>

    <template v-if="clipUrl && !recording">
      <audio class="clip" :src="clipUrl" controls />
      <button class="btn btn-ghost btn-sm" @click="reset">清除</button>
    </template>

    <span v-if="error" class="err">{{ error }}</span>
  </div>
</template>

<style scoped>
.recorder {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-sm {
  padding: 7px 12px;
  font-size: 13px;
}

.rec {
  background: var(--danger);
  color: #fff;
  border-color: var(--danger);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.clip {
  height: 34px;
}

.err {
  font-size: 12px;
  color: var(--danger);
}
</style>
