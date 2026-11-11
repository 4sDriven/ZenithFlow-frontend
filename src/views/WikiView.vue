<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { ApiError, apiFetch } from '../lib/api'

type WikiSection = { level: number; title: string; anchor: string }

type WikiPage = {
  ok: true
  title: string
  kind: 'mediawiki' | 'generic'
  siteName: string
  pageUrl: string
  requestedUrl: string
  html: string
  toc: WikiSection[]
  stats: { images: number; links: number; externalLinks: number; textLength: number }
  fetchedAt: string
  cached: boolean
}

const route = useRoute()
const router = useRouter()

const URL_KEY = 'zf-wiki-url'
const HISTORY_KEY = 'zf-wiki-history'
const FONT_KEY = 'zf-wiki-font'

const urlInput = ref('')
const page = ref<WikiPage | null>(null)
const loading = ref(false)
const error = ref('')
const elapsed = ref(0)
const history = ref<string[]>([])
const fontSize = ref(14)
const bodyRef = ref<HTMLElement | null>(null)
const tocOpen = ref(true)

const currentTarget = computed(() =>
  typeof route.query.u === 'string' ? route.query.u : '',
)

const statusLine = computed(() => {
  const p = page.value
  if (!p) return ''
  const parts = [
    '200',
    p.kind,
    `${elapsed.value}ms`,
    `${p.stats.textLength} chars`,
    `${p.stats.images} imgs`,
  ]
  if (p.stats.externalLinks) parts.push(`${p.stats.externalLinks} ext`)
  if (p.cached) parts.push('cached')
  return parts.join(' · ')
})

function readHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function remember(url: string) {
  const next = [url, ...history.value.filter((item) => item !== url)].slice(0, 20)
  history.value = next
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
}

async function load(target: string) {
  if (!target) {
    page.value = null
    return
  }

  loading.value = true
  error.value = ''

  const startedAt = performance.now()
  try {
    const result = await apiFetch<WikiPage>(`/wiki/page?u=${encodeURIComponent(target)}`)
    page.value = result
    urlInput.value = result.pageUrl
    elapsed.value = Math.round(performance.now() - startedAt)
    localStorage.setItem(URL_KEY, result.pageUrl)
    remember(result.pageUrl)
    await nextTick()
    bodyRef.value?.scrollTo({ top: 0 })
    if (window.innerWidth < 1100) tocOpen.value = false
  } catch (err) {
    page.value = null
    error.value = err instanceof ApiError ? err.message : '读取失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function open(input?: string) {
  const raw = (input ?? urlInput.value).trim()
  if (!raw) return
  if (raw === currentTarget.value) {
    void load(raw)
    return
  }
  void router.push({ path: '/wiki', query: { u: raw } })
}

function reload() {
  if (currentTarget.value) void load(currentTarget.value)
}

function goBack() {
  router.back()
}

function goForward() {
  router.forward()
}

function scrollToSection(anchor: string) {
  const target = document.getElementById(anchor)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onDocClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) return

  const href = anchor.getAttribute('href') ?? ''

  if (href.startsWith('#')) {
    event.preventDefault()
    let id = href.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      /* 保留原样 */
    }
    const target = document.getElementById(id) ?? document.getElementById(href.slice(1))
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }

  if (href.startsWith('/wiki?u=')) {
    event.preventDefault()
    const next = new URL(href, window.location.origin).searchParams.get('u')
    if (next) void router.push({ path: '/wiki', query: { u: next } })
  }
}

function setFont(delta: number) {
  const next = Math.min(18, Math.max(12, fontSize.value + delta))
  fontSize.value = next
  localStorage.setItem(FONT_KEY, String(next))
}

function clearHistory() {
  history.value = []
  localStorage.removeItem(HISTORY_KEY)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

watch(
  () => route.query.u,
  (value) => {
    if (typeof value === 'string' && value) void load(value)
    else page.value = null
  },
  { immediate: true },
)

onMounted(() => {
  const storedFont = Number(localStorage.getItem(FONT_KEY))
  if (storedFont >= 12 && storedFont <= 18) fontSize.value = storedFont
  history.value = readHistory()
  urlInput.value = currentTarget.value || localStorage.getItem(URL_KEY) || ''
})
</script>

<template>
  <AppLayout fill>
    <div class="wiki-shell">
      <div class="wiki-bar">
        <span class="prompt">$ open</span>
        <input
          v-model="urlInput"
          class="url-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="粘贴 wiki 页面地址，回车打开"
          @keydown.enter.prevent="open()"
        />
        <button class="cmd" title="打开" @click="open()">↵ open</button>
        <div class="bar-gap" />
        <button class="cmd" title="后退" @click="goBack">←</button>
        <button class="cmd" title="前进" @click="goForward">→</button>
        <button class="cmd" title="重新读取" @click="reload">⟳</button>
        <button class="cmd" title="缩小字号" @click="setFont(-1)">A-</button>
        <button class="cmd" title="放大字号" @click="setFont(1)">A+</button>
        <button
          v-if="page?.toc.length"
          class="cmd"
          :class="{ on: tocOpen }"
          title="目录"
          @click="tocOpen = !tocOpen"
        >
          toc
        </button>
      </div>

      <div class="wiki-main">
        <aside v-if="page?.toc.length && tocOpen" class="wiki-toc">
          <p class="toc-head"># contents</p>
          <button
            v-for="section in page.toc"
            :key="`${section.anchor}-${section.title}`"
            class="toc-item"
            :style="{ paddingLeft: `${8 + (section.level - 1) * 14}px` }"
            @click="scrollToSection(section.anchor)"
          >
            {{ section.level === 1 ? '#' : '##' }} {{ section.title }}
          </button>
          <button class="toc-clear" @click="clearHistory">clear history</button>
        </aside>

        <div ref="bodyRef" class="wiki-body" :style="{ fontSize: `${fontSize}px` }">
          <div v-if="loading" class="state loading">
            <span class="blink">▌</span> fetching {{ currentTarget }} ...
          </div>

          <div v-else-if="error" class="state error">
            <p class="err-line">! {{ error }}</p>
            <p class="err-hint">// 检查地址是否正确，或换个页面再试</p>
            <button class="cmd" @click="reload">retry</button>
          </div>

          <div v-else-if="page" class="wiki-doc">
            <div class="doc-head">
              <span class="doc-title">{{ page.title }}</span>
              <span class="doc-site">{{ page.siteName }}</span>
            </div>
            <!-- 后端已做标签/属性白名单，只渲染清洗后的片段 -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="doc-content" @click="onDocClick" v-html="page.html" />

            <p class="doc-foot">
              — {{ page.pageUrl }} · fetched {{ formatTime(page.fetchedAt) }}
            </p>
          </div>

          <div v-else class="state empty">
            <p class="empty-title">~ 文本阅读器</p>
            <p class="empty-hint">// 粘贴一个 wiki 地址，回车开始。图片会全部隐藏，站内链接仍然可在本页打开。</p>
            <p class="empty-hint">// 例：https://terraria.wiki.gg/zh/木剑</p>

            <div v-if="history.length" class="history">
              <p class="history-head"># recent</p>
              <button
                v-for="item in history.slice(0, 8)"
                :key="item"
                class="history-item"
                @click="open(item)"
              >
                {{ item }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="wiki-status">
        <span>{{ statusLine || 'ready' }}</span>
        <span class="status-right">{{ currentTarget }}</span>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.wiki-shell {
  margin: -20px;
  height: calc(100% + 40px);
  display: flex;
  flex-direction: column;
  background: #0b0e11;
  color: #c3cad4;
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.6;
  color-scheme: dark;
}

/* 顶部命令行 */
.wiki-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #1b222b;
  background: #0e1319;
  flex-shrink: 0;
  min-width: 0;
}

.prompt {
  color: #5f6b78;
  white-space: nowrap;
}

.url-input {
  flex: 1;
  min-width: 120px;
  background: transparent;
  border: none;
  outline: none;
  color: #d5dae1;
  font-family: inherit;
  font-size: inherit;
  padding: 2px 4px;
}

.url-input::placeholder {
  color: #4d5865;
}

.bar-gap {
  width: 8px;
}

.cmd {
  background: transparent;
  border: 1px solid #232b35;
  border-radius: 2px;
  color: #8b96a3;
  font-family: inherit;
  font-size: 11px;
  padding: 2px 7px;
  cursor: pointer;
  white-space: nowrap;
}

.cmd:hover {
  border-color: #3a4552;
  color: #c3cad4;
}

.cmd.on {
  border-color: #3a4552;
  color: #d5dae1;
}

/* 主体：左侧目录 + 正文 */
.wiki-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

.wiki-toc {
  width: 210px;
  flex-shrink: 0;
  border-right: 1px solid #1b222b;
  padding: 12px 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.toc-head {
  margin: 0 0 8px;
  padding-left: 8px;
  color: #4f5a67;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.toc-item {
  background: none;
  border: none;
  color: #8b96a3;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc-item:hover {
  color: #d5dae1;
  background: #121820;
}

.toc-clear {
  margin-top: auto;
  padding-top: 12px;
  background: none;
  border: none;
  color: #3f4954;
  font-family: inherit;
  font-size: 11px;
  text-align: left;
  padding-left: 8px;
  cursor: pointer;
}

.toc-clear:hover {
  color: #8b96a3;
}

.wiki-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 28px 40px;
}

/* 文档正文宽度 */
.wiki-doc {
  max-width: 88ch;
  margin: 0 auto;
}

.doc-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  border-bottom: 1px solid #1b222b;
  padding-bottom: 8px;
  margin-bottom: 14px;
}

.doc-title {
  color: #e6e9ee;
  font-size: 1.25em;
  font-weight: 700;
}

.doc-site {
  color: #4f5a67;
  font-size: 0.85em;
}

.doc-foot {
  margin-top: 32px;
  padding-top: 8px;
  border-top: 1px dashed #1b222b;
  color: #3f4954;
  font-size: 0.8em;
  word-break: break-all;
}

/* 状态 */
.state {
  max-width: 88ch;
  margin: 12vh auto 0;
  color: #7f8b98;
}

.loading {
  color: #7f8b98;
}

.blink {
  animation: blink 1.1s steps(2, start) infinite;
}

@keyframes blink {
  to {
    visibility: hidden;
  }
}

.error .err-line {
  color: #d98b8b;
  margin: 0 0 6px;
}

.err-hint {
  color: #4f5a67;
  margin: 0 0 12px;
}

.empty-title {
  color: #d5dae1;
  margin: 0 0 10px;
}

.empty-hint {
  color: #4f5a67;
  margin: 0 0 4px;
  word-break: break-all;
}

.history {
  margin-top: 26px;
}

.history-head {
  color: #4f5a67;
  margin: 0 0 6px;
}

.history-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: #8b96a3;
  font-family: inherit;
  font-size: 12px;
  padding: 2px 0;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-item:hover {
  color: #d5dae1;
}

/* 底部状态栏 */
.wiki-status {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 12px;
  border-top: 1px solid #1b222b;
  background: #0e1319;
  color: #4f5a67;
  font-size: 11px;
  flex-shrink: 0;
}

.status-right {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 渲染内容：必须用 :deep，v-html 节点没有 scoped 属性 ---- */
.doc-content :deep(h1),
.doc-content :deep(h2),
.doc-content :deep(h3),
.doc-content :deep(h4),
.doc-content :deep(h5),
.doc-content :deep(h6) {
  color: #e6e9ee;
  font-weight: 700;
  line-height: 1.35;
  margin: 1.5em 0 0.6em;
}

.doc-content :deep(h1) {
  font-size: 1.2em;
}

.doc-content :deep(h2) {
  font-size: 1.08em;
  border-bottom: 1px solid #1b222b;
  padding-bottom: 0.25em;
}

.doc-content :deep(h3),
.doc-content :deep(h4),
.doc-content :deep(h5),
.doc-content :deep(h6) {
  font-size: 1em;
}

.doc-content :deep(p) {
  margin: 0.7em 0;
}

.doc-content :deep(a) {
  color: #93b4cc;
  text-decoration: none;
  border-bottom: 1px dotted #3a4a5a;
  cursor: pointer;
}

.doc-content :deep(a:hover) {
  color: #cfe0ec;
  border-bottom-color: #5c7183;
}

.doc-content :deep(a.wv-ext)::after {
  content: '↗';
  color: #5f6b78;
  font-size: 0.8em;
  margin-left: 2px;
}

.doc-content :deep(a.wv-self) {
  color: #d5dae1;
  border-bottom: none;
}

.doc-content :deep(ul),
.doc-content :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.8em;
}

.doc-content :deep(li) {
  margin: 0.2em 0;
}

.doc-content :deep(li)::marker {
  color: #5f6b78;
}

.doc-content :deep(dl) {
  margin: 0.6em 0;
}

.doc-content :deep(dt) {
  color: #d5dae1;
  font-weight: 600;
}

.doc-content :deep(dd) {
  margin-left: 1.6em;
  color: #a8b2bd;
}

.doc-content :deep(hr) {
  border: none;
  border-top: 1px dashed #232b35;
  margin: 1.4em 0;
}

.doc-content :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.2em 0 0.2em 12px;
  border-left: 2px solid #2a323c;
  color: #9aa5b1;
}

.doc-content :deep(pre) {
  background: #0f141a;
  border: 1px solid #1f262f;
  border-radius: 2px;
  padding: 10px 12px;
  overflow-x: auto;
  font-size: 0.92em;
  line-height: 1.5;
}

.doc-content :deep(code) {
  background: #121820;
  border-radius: 2px;
  padding: 0 3px;
  font-size: 0.95em;
}

.doc-content :deep(pre code) {
  background: none;
  padding: 0;
}

.doc-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0.9em 0;
  font-size: 0.94em;
}

.doc-content :deep(th),
.doc-content :deep(td) {
  border: 1px solid #232b35;
  padding: 3px 9px;
  vertical-align: top;
}

.doc-content :deep(th) {
  background: #12171e;
  color: #d5dae1;
  font-weight: 600;
  text-align: left;
}

.doc-content :deep(caption) {
  color: #7f8b98;
  text-align: left;
  padding-bottom: 4px;
}

/* 图片占位与标记 */
.doc-content :deep(.wv-img) {
  display: inline-block;
  padding: 0 6px;
  border: 1px dashed #2b333d;
  border-radius: 2px;
  color: #7f8b98;
  font-style: italic;
  font-size: 0.88em;
}

.doc-content :deep(.wv-ico) {
  display: inline-block;
  padding: 0 4px;
  border: 1px solid #2a323c;
  border-radius: 2px;
  color: #7f8b98;
  font-size: 0.82em;
  line-height: 1.4;
}

.doc-content :deep(.wv-fig) {
  margin: 0.7em 0;
  padding: 3px 10px;
  border-left: 2px solid #2a323c;
  color: #8b96a3;
  font-size: 0.9em;
}

.doc-content :deep(.wv-fig-mark) {
  color: #5f6b78;
}

.doc-content :deep(.wv-fig-cap) {
  font-style: italic;
}

.doc-content :deep(sup),
.doc-content :deep(sub) {
  font-size: 0.75em;
  line-height: 0;
}

.doc-content :deep(img),
.doc-content :deep(video),
.doc-content :deep(iframe) {
  display: none !important;
}

@media (max-width: 900px) {
  .wiki-toc {
    display: none;
  }

  .wiki-body {
    padding: 14px 14px 32px;
  }

  .bar-gap {
    display: none;
  }
}
</style>
