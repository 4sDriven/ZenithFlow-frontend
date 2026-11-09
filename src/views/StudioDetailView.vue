<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { ApiError, apiFetch } from '../lib/api'
import { VIDEO_PRESETS, VOICES, TONES, presetByKey, presetByModel } from '../lib/video-options'

type Project = {
  id: number
  title: string
  topic: string
  style: string | null
  durationSec: number
  status: 'draft' | 'scripted' | 'done'
  videoModel: string
  resolution: string
  voice: string
  voiceTone: string | null
  finalVideoPath: string | null
  renderStatus: 'idle' | 'rendering' | 'done' | 'failed'
  renderError: string | null
}

type Shot = {
  id: number
  shotIndex: number
  description: string
  narration: string | null
  durationSec: number
  status: 'pending' | 'generating' | 'done' | 'failed'
  videoUrl: string | null
  localVideoPath: string | null
  localAudioPath: string | null
  error: string | null
}

const route = useRoute()
const router = useRouter()

const project = ref<Project | null>(null)
const shots = ref<Shot[]>([])
const error = ref('')
const scripting = ref(false)
const shotCount = ref(3)

const presetKey = ref('standard')
const voice = ref('Cherry')
const tone = ref('')

let timer: number | undefined

const statusLabel: Record<string, string> = {
  pending: '待生成',
  generating: '生成中',
  done: '已完成',
  failed: '失败',
}

const activePreset = computed(() => presetByKey(presetKey.value))
const estimatePerShot = computed(() => activePreset.value.price.toFixed(2))

const allVideosReady = computed(
  () => shots.value.length > 0 && shots.value.every((s) => s.status === 'done'),
)

const finalUrl = computed(() =>
  project.value?.finalVideoPath ? `/media/${project.value.finalVideoPath}` : null,
)

function applySettingsToForm(p: Project) {
  presetKey.value = presetByModel(p.videoModel, p.resolution).key
  voice.value = p.voice
  tone.value = p.voiceTone ?? ''
}

async function load() {
  try {
    const data = await apiFetch<{ ok: boolean; project: Project; shots: Shot[] }>(
      `/video/projects/${route.params.id}`,
    )
    project.value = data.project
    shots.value = data.shots
    if (data.shots.length > 0) shotCount.value = data.shots.length
    applySettingsToForm(data.project)
    error.value = ''
    ensurePolling()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败'
  }
}

async function refreshProject() {
  try {
    const data = await apiFetch<{ ok: boolean; project: Project; shots: Shot[] }>(
      `/video/projects/${route.params.id}`,
    )
    project.value = data.project
    shots.value = data.shots
  } catch {
    /* ignore */
  }
}

async function saveSettings() {
  if (!project.value) return
  const preset = presetByKey(presetKey.value)
  try {
    const data = await apiFetch<{ ok: boolean; project: Project }>(
      `/video/projects/${project.value.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          videoModel: preset.model,
          resolution: preset.resolution,
          voice: voice.value,
          voiceTone: tone.value,
        }),
      },
    )
    project.value = data.project
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存设置失败'
  }
}

async function generateScript() {
  if (!project.value) return
  scripting.value = true
  error.value = ''
  try {
    const data = await apiFetch<{ ok: boolean; shots: Shot[] }>(
      `/video/projects/${project.value.id}/script`,
      { method: 'POST', body: JSON.stringify({ shotCount: shotCount.value }) },
    )
    shots.value = data.shots
    if (project.value) project.value.status = 'scripted'
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '脚本生成失败'
  } finally {
    scripting.value = false
  }
}

async function generateVideo(shot: Shot) {
  error.value = ''
  try {
    await apiFetch(`/video/shots/${shot.id}/generate`, { method: 'POST' })
    shot.status = 'generating'
    shot.error = null
    ensurePolling()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '提交失败'
  }
}

async function refreshShot(shot: Shot) {
  try {
    const data = await apiFetch<{ ok: boolean; shot: Shot }>(`/video/shots/${shot.id}`)
    Object.assign(shot, data.shot)
  } catch {
    /* transient error */
  }
}

async function renderFinal() {
  if (!project.value) return
  error.value = ''
  try {
    await apiFetch(`/video/projects/${project.value.id}/render`, { method: 'POST' })
    if (project.value) project.value.renderStatus = 'rendering'
    ensurePolling()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '合成失败'
  }
}

function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function ensurePolling() {
  const needRender = project.value?.renderStatus === 'rendering'
  const needShots = shots.value.some((s) => s.status === 'generating')
  if (!needRender && !needShots) {
    stopPolling()
    return
  }
  if (timer) return
  timer = window.setInterval(async () => {
    const pending = shots.value.filter((s) => s.status === 'generating')
    await Promise.all(pending.map(refreshShot))
    if (project.value?.renderStatus === 'rendering') {
      await refreshProject()
    }
    const stillRender = project.value?.renderStatus === 'rendering'
    const stillShots = shots.value.some((s) => s.status === 'generating')
    if (!stillRender && !stillShots) stopPolling()
  }, 6000)
}

onMounted(load)
onUnmounted(stopPolling)
</script>

<template>
  <AppLayout>
    <section class="card panel head">
      <div>
        <button class="back" @click="router.push('/studio')">← 返回</button>
        <h2>{{ project?.title || '加载中…' }}</h2>
        <p class="topic">{{ project?.topic }}</p>
      </div>
      <div class="controls">
        <select v-model.number="shotCount" class="input select">
          <option :value="2">2 镜</option>
          <option :value="3">3 镜</option>
          <option :value="4">4 镜</option>
          <option :value="6">6 镜</option>
        </select>
        <button class="btn btn-ghost" :disabled="scripting" @click="generateScript">
          {{ scripting ? '生成中…' : shots.length ? '重新生成分镜' : 'AI 生成分镜' }}
        </button>
        <button
          class="btn btn-primary"
          :disabled="!allVideosReady || project?.renderStatus === 'rendering'"
          :title="allVideosReady ? '' : '需要先为每个镜头生成视频'"
          @click="renderFinal"
        >
          {{ project?.renderStatus === 'rendering' ? '合成中…' : '一键成片' }}
        </button>
      </div>
    </section>

    <section class="card panel settings">
      <div class="setting">
        <label>画质</label>
        <select v-model="presetKey" class="input select" @change="saveSettings">
          <option v-for="p in VIDEO_PRESETS" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
      </div>
      <div class="setting">
        <label>配音音色</label>
        <select v-model="voice" class="input select" @change="saveSettings">
          <option v-for="v in VOICES" :key="v.id" :value="v.id">{{ v.label }}</option>
        </select>
      </div>
      <div class="setting">
        <label>语气</label>
        <select v-model="tone" class="input select" @change="saveSettings">
          <option v-for="t in TONES" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
      </div>
      <span class="est">每镜生成视频 ≈ ¥{{ estimatePerShot }}</span>
    </section>

    <p v-if="error" class="err">{{ error }}</p>

    <section v-if="project?.renderStatus === 'rendering'" class="card banner">
      正在合成成片（下载素材 + 配音 + 字幕 + 拼接），请稍候，页面会自动刷新…
    </section>
    <p v-if="project?.renderError" class="err">合成失败：{{ project.renderError }}</p>

    <section v-if="finalUrl" class="card final">
      <div class="final-head">
        <h3>成片</h3>
        <a class="btn btn-ghost btn-sm" :href="finalUrl" download>下载成片</a>
      </div>
      <video class="final-video" :src="finalUrl" controls playsinline />
    </section>

    <section class="shots">
      <article v-for="shot in shots" :key="shot.id" class="card shot">
        <div class="shot-head">
          <span class="idx">镜头 {{ shot.shotIndex }}</span>
          <span class="badge" :class="shot.status">{{ statusLabel[shot.status] }}</span>
        </div>
        <p class="desc">{{ shot.description }}</p>
        <p v-if="shot.narration" class="narration">旁白：{{ shot.narration }}</p>
        <p v-if="shot.error" class="shot-err">{{ shot.error }}</p>

        <video v-if="shot.videoUrl" class="preview" :src="shot.videoUrl" controls playsinline />

        <div class="shot-foot">
          <span class="meta">{{ shot.durationSec }}s</span>
          <button
            class="btn btn-ghost btn-sm"
            :disabled="shot.status === 'generating'"
            @click="generateVideo(shot)"
          >
            {{ shot.status === 'generating' ? '生成中…' : shot.videoUrl ? '重新生成' : `生成视频` }}
          </button>
        </div>
      </article>
    </section>

    <p v-if="shots.length === 0" class="muted-text">还没有分镜，点右上角「AI 生成分镜」。</p>
  </AppLayout>
</template>

<style scoped>
.panel {
  padding: 18px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.back {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}

.back:hover {
  color: var(--text);
}

h2 {
  margin: 8px 0 4px;
  font-size: 20px;
  letter-spacing: -0.3px;
}

.topic {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.settings {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 14px 18px;
  flex-wrap: wrap;
}

.setting {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setting label {
  font-size: 12px;
  color: var(--text-muted);
}

.est {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.input {
  padding: 8px 11px;
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

.banner {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--primary);
  border-color: var(--primary);
}

.final {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.final-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.final-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.final-video {
  width: 100%;
  max-width: 640px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: #000;
}

.shots {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.shot {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.idx {
  font-weight: 600;
  font-size: 14px;
}

.desc {
  margin: 0;
  font-size: 14px;
}

.narration {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.shot-err {
  margin: 0;
  font-size: 13px;
  color: var(--danger);
}

.preview {
  width: 100%;
  max-width: 420px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: #000;
}

.shot-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meta {
  font-size: 12px;
  color: var(--text-muted);
}

.badge {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  background: var(--surface-2);
  color: var(--text-muted);
}

.badge.generating {
  background: rgba(79, 70, 229, 0.12);
  color: var(--primary);
}

.badge.done {
  background: rgba(5, 150, 105, 0.12);
  color: var(--success);
}

.badge.failed {
  background: rgba(220, 38, 38, 0.12);
  color: var(--danger);
}

.btn-sm {
  padding: 5px 10px;
  font-size: 13px;
}

.err {
  margin: 0;
  font-size: 13px;
  color: var(--danger);
}

.muted-text {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-muted);
}

@media (max-width: 720px) {
  .head {
    flex-direction: column;
  }
}
</style>
