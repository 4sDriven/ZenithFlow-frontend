<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
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
  createdAt: string
}

const router = useRouter()
const projects = ref<Project[]>([])
const loading = ref(false)
const error = ref('')
const creating = ref(false)

const form = ref({
  title: '',
  topic: '',
  style: '轻松治愈',
  durationSec: 15,
  preset: 'standard',
  voice: 'Cherry',
  voiceTone: '',
})

const estimate = computed(() => {
  const preset = presetByKey(form.value.preset)
  return (preset.price * form.value.durationSec).toFixed(2)
})

const statusLabel: Record<string, string> = {
  draft: '草稿',
  scripted: '已分镜',
  done: '已完成',
}

async function load() {
  loading.value = true
  try {
    const data = await apiFetch<{ ok: boolean; projects: Project[] }>('/video/projects')
    projects.value = data.projects
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!form.value.title || !form.value.topic) {
    error.value = '请填写标题和主题'
    return
  }
  creating.value = true
  error.value = ''
  try {
    const preset = presetByKey(form.value.preset)
    const data = await apiFetch<{ ok: boolean; project: Project }>('/video/projects', {
      method: 'POST',
      body: JSON.stringify({
        title: form.value.title,
        topic: form.value.topic,
        style: form.value.style,
        durationSec: form.value.durationSec,
        videoModel: preset.model,
        resolution: preset.resolution,
        voice: form.value.voice,
        voiceTone: form.value.voiceTone || undefined,
      }),
    })
    router.push(`/studio/${data.project.id}`)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '创建失败'
  } finally {
    creating.value = false
  }
}

async function remove(project: Project) {
  if (!window.confirm(`删除项目「${project.title}」？`)) return
  error.value = ''
  try {
    await apiFetch(`/video/projects/${project.id}`, { method: 'DELETE' })
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
      <h3>新建短视频</h3>
      <form class="create-form" @submit.prevent="create">
        <input v-model="form.title" class="input" placeholder="视频标题" />
        <input v-model="form.topic" class="input topic-input" placeholder="主题 / 想讲什么" />
        <input v-model="form.style" class="input" placeholder="风格（如：轻松治愈）" />
        <select v-model.number="form.durationSec" class="input select">
          <option :value="15">15 秒</option>
          <option :value="30">30 秒</option>
          <option :value="60">60 秒</option>
        </select>
        <select v-model="form.preset" class="input select">
          <option v-for="p in VIDEO_PRESETS" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
        <select v-model="form.voice" class="input select">
          <option v-for="v in VOICES" :key="v.id" :value="v.id">{{ v.label }}</option>
        </select>
        <select v-model="form.voiceTone" class="input select">
          <option v-for="t in TONES" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          {{ creating ? '创建中…' : `创建（预估 ≈¥${estimate}）` }}
        </button>
      </form>
      <p v-if="error" class="err">{{ error }}</p>
    </section>

    <section class="grid">
      <article v-for="p in projects" :key="p.id" class="card item" @click="router.push(`/studio/${p.id}`)">
        <div class="item-head">
          <h4>{{ p.title }}</h4>
          <span class="badge" :class="p.status">{{ statusLabel[p.status] }}</span>
        </div>
        <p class="topic">{{ p.topic }}</p>
        <div class="item-foot">
          <span class="meta">
            {{ p.style || '通用' }} · {{ p.durationSec }}s · {{ presetByModel(p.videoModel, p.resolution).resolution }}
          </span>
          <button class="btn btn-ghost btn-sm" @click.stop="remove(p)">删除</button>
        </div>
      </article>
    </section>
    <p v-if="loading" class="muted-text">加载中…</p>
    <p v-else-if="projects.length === 0" class="muted-text">还没有短视频项目，先在上方创建一个。</p>
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
  grid-template-columns: 1fr 1.4fr 1fr;
  gap: 10px;
}

.topic-input {
  grid-column: span 1;
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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.item {
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.item:hover {
  border-color: var(--primary);
}

.item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.item-head h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.topic {
  margin: 10px 0 14px;
  font-size: 13px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.meta {
  font-size: 12px;
  color: var(--text-muted);
}

.badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  background: var(--surface-2);
  color: var(--text-muted);
}

.badge.scripted {
  background: rgba(79, 70, 229, 0.12);
  color: var(--primary);
}

.badge.done {
  background: rgba(5, 150, 105, 0.12);
  color: var(--success);
}

.btn-sm {
  padding: 5px 10px;
  font-size: 13px;
}

.err {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--danger);
}

.muted-text {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .create-form {
    grid-template-columns: 1fr;
  }
}
</style>
