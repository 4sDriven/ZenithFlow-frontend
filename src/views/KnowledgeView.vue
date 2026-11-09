<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { ApiError, apiFetch } from '../lib/api'

type KbItem = {
  id: number
  title: string
  sourceType: 'note' | 'url' | 'text' | 'file'
  sourceUrl: string | null
  fileName: string | null
  tags: string[]
  status: string
  chunkCount: number
  createdAt: string
}

type Citation = {
  itemId: number
  title: string
  sourceType: string
  sourceUrl: string | null
  tags: string[]
  chunkIndex: number
  content: string
  score: number
}

const items = ref<KbItem[]>([])
const loading = ref(false)
const error = ref('')
const activeTag = ref('')

const form = ref({
  mode: 'text' as 'text' | 'url' | 'file',
  title: '',
  content: '',
  url: '',
  tags: '',
})
const file = ref<File | null>(null)
const adding = ref(false)

const question = ref('')
const topK = ref(5)
const asking = ref(false)
const answer = ref('')
const citations = ref<Citation[]>([])
const reranked = ref(false)

const typeLabel: Record<string, string> = { note: '笔记', text: '文本', url: '链接', file: '文件' }

const allTags = computed(() => {
  const set = new Set<string>()
  for (const item of items.value) for (const tag of item.tags) set.add(tag)
  return [...set]
})

const visibleItems = computed(() =>
  activeTag.value ? items.value.filter((i) => i.tags.includes(activeTag.value)) : items.value,
)

async function load() {
  loading.value = true
  try {
    const data = await apiFetch<{ ok: boolean; items: KbItem[] }>('/kb/items')
    items.value = data.items
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
}

async function addItem() {
  error.value = ''
  if (form.value.mode === 'url' && !form.value.url.trim()) {
    error.value = '请填写链接'
    return
  }
  if (form.value.mode === 'text' && !form.value.content.trim()) {
    error.value = '请填写内容'
    return
  }
  if (form.value.mode === 'file' && !file.value) {
    error.value = '请选择文件'
    return
  }

  adding.value = true
  try {
    if (form.value.mode === 'file') {
      const fd = new FormData()
      fd.append('file', file.value as File)
      const params = new URLSearchParams()
      if (form.value.title.trim()) params.set('title', form.value.title.trim())
      if (form.value.tags.trim()) params.set('tags', form.value.tags.trim())
      await apiFetch(`/kb/upload?${params.toString()}`, { method: 'POST', body: fd })
    } else {
      const body =
        form.value.mode === 'url'
          ? {
              type: 'url',
              url: form.value.url.trim(),
              title: form.value.title.trim() || undefined,
              tags: form.value.tags.trim() || undefined,
            }
          : {
              type: 'text',
              content: form.value.content,
              title: form.value.title.trim() || undefined,
              tags: form.value.tags.trim() || undefined,
            }
      await apiFetch('/kb/items', { method: 'POST', body: JSON.stringify(body) })
    }

    form.value = { mode: form.value.mode, title: '', content: '', url: '', tags: '' }
    file.value = null
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '入库失败'
  } finally {
    adding.value = false
  }
}

async function remove(item: KbItem) {
  if (!window.confirm(`删除「${item.title}」？`)) return
  error.value = ''
  try {
    await apiFetch(`/kb/items/${item.id}`, { method: 'DELETE' })
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '删除失败'
  }
}

async function ask() {
  if (!question.value.trim()) return
  asking.value = true
  error.value = ''
  answer.value = ''
  citations.value = []
  try {
    const data = await apiFetch<{
      ok: boolean
      answer: string
      reranked: boolean
      citations: Citation[]
    }>('/kb/ask', {
      method: 'POST',
      body: JSON.stringify({ question: question.value, topK: topK.value }),
    })
    answer.value = data.answer
    citations.value = data.citations
    reranked.value = data.reranked
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '问答失败'
  } finally {
    asking.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppLayout>
    <section class="card panel">
      <h3>添加资料</h3>
      <div class="mode">
        <button class="tab" :class="{ active: form.mode === 'text' }" @click="form.mode = 'text'">
          文本 / 笔记
        </button>
        <button class="tab" :class="{ active: form.mode === 'url' }" @click="form.mode = 'url'">
          网页链接
        </button>
        <button class="tab" :class="{ active: form.mode === 'file' }" @click="form.mode = 'file'">
          上传文件
        </button>
      </div>

      <div class="add-form">
        <div class="row-inputs">
          <input v-model="form.title" class="input" placeholder="标题（可选）" />
          <input
            v-model="form.tags"
            class="input"
            placeholder="标签（逗号分隔，可选，如：RAG, 产品）"
          />
        </div>

        <textarea
          v-if="form.mode === 'text'"
          v-model="form.content"
          class="input textarea"
          placeholder="粘贴笔记、文章正文…"
          rows="5"
        />
        <input v-else-if="form.mode === 'url'" v-model="form.url" class="input" placeholder="https://…" />
        <div v-else class="file-row">
          <input type="file" accept=".pdf,.docx,.md,.markdown,.txt,.csv" @change="onFile" />
          <span class="meta">{{ file ? file.name : '支持 PDF / DOCX / MD / TXT / CSV（≤20MB）' }}</span>
        </div>

        <button class="btn btn-primary" :disabled="adding" @click="addItem">
          {{ adding ? '入库中…' : '添加到知识库' }}
        </button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </section>

    <div class="columns">
      <section class="card panel">
        <div class="list-head">
          <h3>资料库（{{ visibleItems.length }}）</h3>
          <div v-if="allTags.length" class="tag-filter">
            <button class="tag" :class="{ active: !activeTag }" @click="activeTag = ''">全部</button>
            <button
              v-for="tag in allTags"
              :key="tag"
              class="tag"
              :class="{ active: activeTag === tag }"
              @click="activeTag = tag"
            >
              {{ tag }}
            </button>
          </div>
        </div>

        <p v-if="loading" class="muted-text">加载中…</p>
        <p v-else-if="visibleItems.length === 0" class="muted-text">还没有资料。</p>
        <ul v-else class="list">
          <li v-for="item in visibleItems" :key="item.id" class="row">
            <div class="row-main">
              <div class="row-head">
                <span class="badge">{{ typeLabel[item.sourceType] || item.sourceType }}</span>
                <a
                  v-if="item.sourceUrl"
                  class="title link"
                  :href="item.sourceUrl"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ item.title }}
                </a>
                <span v-else class="title">{{ item.title }}</span>
              </div>
              <div class="row-meta">
                <span
                  v-for="tag in item.tags"
                  :key="tag"
                  class="tag-chip"
                  @click="activeTag = tag"
                >
                  {{ tag }}
                </span>
                <span class="meta">
                  {{ item.fileName || item.sourceUrl || typeLabel[item.sourceType] }} ·
                  {{ item.chunkCount }} 段 ·
                  {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}
                </span>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" @click="remove(item)">删除</button>
          </li>
        </ul>
      </section>

      <section class="card panel">
        <h3>问知识库</h3>
        <textarea
          v-model="question"
          class="input textarea"
          placeholder="问点什么，例如：总结一下我收集的关于 X 的资料"
          rows="3"
        />
        <div class="ask-bar">
          <select v-model.number="topK" class="input select">
            <option :value="3">引用 3 段</option>
            <option :value="5">引用 5 段</option>
            <option :value="8">引用 8 段</option>
          </select>
          <button class="btn btn-primary" :disabled="asking" @click="ask">
            {{ asking ? '思考中…' : '提问' }}
          </button>
        </div>

        <div v-if="answer" class="answer">{{ answer }}</div>

        <div v-if="citations.length" class="citations">
          <p class="citations-title">引用来源{{ reranked ? '（已重排）' : '' }}</p>
          <article v-for="(c, i) in citations" :key="`${c.itemId}-${c.chunkIndex}`" class="citation">
            <div class="citation-head">
              <span class="citation-idx">[{{ i + 1 }}]</span>
              <span class="citation-title">{{ c.title }}</span>
              <span class="meta">{{ c.score.toFixed(3) }}</span>
            </div>
            <p class="citation-body">{{ c.content }}</p>
          </article>
        </div>
      </section>
    </div>
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

.mode {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.tab {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.tab.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-fg);
}

.add-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
}

.input:focus {
  outline: none;
  border-color: var(--primary);
}

.textarea {
  resize: vertical;
}

.select {
  width: auto;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 16px;
  align-items: start;
}

.list-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tag-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.tag.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-fg);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-chip {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}

.badge {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 12px;
}

.meta {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ask-bar {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.answer {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  white-space: pre-wrap;
  line-height: 1.7;
  font-size: 14px;
}

.citations {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.citations-title {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.citation {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.citation-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.citation-idx {
  color: var(--primary);
  font-weight: 600;
}

.citation-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.citation-body {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.muted-text {
  color: var(--text-muted);
  font-size: 13px;
}

.err {
  margin: 10px 0 0;
  color: var(--danger);
  font-size: 13px;
}

@media (max-width: 1000px) {
  .columns {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .row-inputs {
    grid-template-columns: 1fr;
  }
}
</style>
