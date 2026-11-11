<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { ApiError, apiFetch } from '../lib/api'
import { useAuthStore } from '../stores/auth'

type ItemKind = 'official' | 'folk' | 'mixed'

type NewspaperItem = {
  title: string
  summary: string
  source: string
  url: string | null
  publishedAt: string | null
  publishedLabel: string | null
  heat: string | null
  kind: ItemKind
  tags: string[]
}

type NewspaperSection = {
  key: string
  title: string
  subtitle: string
  intro: string
  items: NewspaperItem[]
  degraded: boolean
  note: string | null
}

type NewspaperEdition = {
  date: string
  status: 'ready' | 'generating' | 'failed'
  generatedAt: string | null
  itemCount: number
  sourceStats: Record<string, number>
  sections: NewspaperSection[]
  error: string | null
}

type NewspaperResponse = {
  ok: boolean
  date: string
  edition: NewspaperEdition | null
  generating: boolean
  stale: boolean
  error: string | null
}

const auth = useAuthStore()

const data = ref<NewspaperResponse | null>(null)
const loading = ref(true)
const error = ref('')
const regenerating = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollStartedAt = 0

const edition = computed(() => data.value?.edition ?? null)
const sections = computed(() => edition.value?.sections ?? [])
const generating = computed(() => Boolean(data.value?.generating || regenerating.value))

const dateLabel = computed(() => {
  const date = data.value?.date
  if (!date) return ''
  const parsed = new Date(`${date}T00:00:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return date
  const week = ['日', '一', '二', '三', '四', '五', '六'][parsed.getDay()]
  return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日 · 星期${week}`
})

const generatedLabel = computed(() => {
  const value = edition.value?.generatedAt
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
})

const sourceCount = computed(() => {
  const set = new Set<string>()
  for (const section of sections.value) {
    for (const item of section.items) {
      for (const source of item.source.split(' / ')) {
        if (source.trim()) set.add(source.trim())
      }
    }
  }
  return set.size
})

const totalItems = computed(() =>
  sections.value.reduce((sum, section) => sum + section.items.length, 0),
)

const kindLabel: Record<ItemKind, string> = {
  official: '官方',
  folk: '民间',
  mixed: '综合',
}

function formatTime(item: NewspaperItem): string {
  if (item.publishedLabel) return item.publishedLabel
  if (!item.publishedAt) return ''
  const date = new Date(item.publishedAt)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(/\//g, '-')
}

async function load(showLoading = false) {
  if (showLoading) loading.value = true
  try {
    const response = await apiFetch<NewspaperResponse>('/newspaper/today')
    data.value = response
    error.value = ''
    if (response.generating) startPolling()
    else {
      regenerating.value = false
      stopPolling()
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败'
  } finally {
    if (showLoading) loading.value = false
  }
}

function startPolling() {
  if (pollTimer) return
  pollStartedAt = Date.now()
  pollTimer = setInterval(() => {
    if (Date.now() - pollStartedAt > 30 * 60 * 1000) {
      stopPolling()
      return
    }
    void load()
  }, 6_000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function regenerate() {
  if (!window.confirm('重新生成今天的报纸？当前版本会被覆盖。')) return
  error.value = ''
  regenerating.value = true
  try {
    await apiFetch('/newspaper/generate', { method: 'POST' })
    await load()
    if (data.value?.generating) startPolling()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '触发失败'
    regenerating.value = false
  }
}

function scrollToSection(key: string) {
  document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function printPaper() {
  window.print()
}

onMounted(() => void load(true))
onUnmounted(stopPolling)
</script>

<template>
  <AppLayout>
    <div v-if="loading" class="skeleton">
      <div class="sk-card card"></div>
      <div class="sk-lines card"></div>
      <div class="sk-lines card"></div>
    </div>

    <template v-else>
      <header class="masthead card">
        <div class="masthead-top">
          <div class="brand">
            <p class="kicker">ZENITH DAILY · 每日简报</p>
            <h1>Zenith 日报</h1>
            <p class="dateline">{{ dateLabel }} · 每天 00:00 自动生成</p>
          </div>
          <div class="issue">
            <p class="issue-line">第 {{ edition?.date?.replaceAll('-', '') || '—' }} 期</p>
            <p v-if="edition" class="issue-meta">
              生成于 {{ generatedLabel }} · {{ totalItems }} 条 · {{ sourceCount }} 个来源
            </p>
            <p v-else class="issue-meta">今日还未生成</p>
            <div class="issue-actions no-print">
              <button class="btn btn-ghost btn-small" @click="printPaper">打印</button>
              <button
                v-if="auth.isAdmin"
                class="btn btn-primary btn-small"
                :disabled="generating"
                @click="regenerate"
              >
                {{ generating ? '生成中…' : '重新生成' }}
              </button>
            </div>
          </div>
        </div>

        <nav v-if="sections.length" class="anchors no-print">
          <button
            v-for="section in sections"
            :key="section.key"
            class="anchor"
            @click="scrollToSection(section.key)"
          >
            {{ section.title }}
          </button>
        </nav>
      </header>

      <div v-if="generating" class="banner banner-info">
        <span class="pulse"></span>
        正在生成今日报纸，通常需要 1–3 分钟；完成后本页会自动刷新。
      </div>

      <div v-if="data?.stale" class="banner banner-warn">
        今日报纸尚未生成成功，当前显示的是 {{ edition?.date }} 的版本。
        <span v-if="data?.error">{{ data.error }}</span>
      </div>
      <div v-else-if="data?.error || error" class="banner banner-error">
        {{ data?.error || error }}
      </div>

      <div v-if="!edition && !generating" class="empty card">
        <h2>今天的报纸还没出炉</h2>
        <p>每天 00:00 会自动生成。如果你等不及，可以手动触发一次。</p>
        <button v-if="auth.isAdmin" class="btn btn-primary" @click="regenerate">
          立即生成
        </button>
        <p v-else class="muted">请稍后再来看看。</p>
      </div>

      <section
        v-for="(section, sectionIndex) in sections"
        :id="`sec-${section.key}`"
        :key="section.key"
        class="section"
      >
        <div class="section-head">
          <span class="section-index">{{ String(sectionIndex + 1).padStart(2, '0') }}</span>
          <div>
            <h2>{{ section.title }}</h2>
            <p>{{ section.subtitle }}</p>
          </div>
          <span class="section-count">{{ section.items.length }} 条</span>
        </div>

        <p v-if="section.intro" class="section-intro">{{ section.intro }}</p>
        <p v-if="section.note" class="section-note">{{ section.note }}</p>
        <p v-if="section.degraded" class="section-note degraded">
          本版 AI 编排未完成，以下为原始素材快讯。
        </p>

        <div class="items">
          <article v-for="(item, itemIndex) in section.items" :key="`${section.key}-${itemIndex}`" class="item">
            <div class="item-head">
              <span class="kind" :class="`kind-${item.kind}`">{{ kindLabel[item.kind] || '综合' }}</span>
              <a
                v-if="item.url"
                class="headline"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ item.title }}
              </a>
              <span v-else class="headline">{{ item.title }}</span>
            </div>

            <p class="summary">{{ item.summary }}</p>

            <div class="meta-row">
              <span class="source">{{ item.source }}</span>
              <span v-if="item.heat" class="heat">{{ item.heat }}</span>
              <span v-if="formatTime(item)" class="time">{{ formatTime(item) }}</span>
              <a
                v-if="item.url"
                class="origin no-print"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                原文 →
              </a>
            </div>

            <div v-if="item.tags.length" class="tags">
              <span v-for="tag in item.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </article>
        </div>

        <p v-if="!section.items.length" class="section-empty">本版今天没有抓到可靠素材。</p>
      </section>

      <footer class="paper-foot">
        <p>Zenith 日报由 ZenithFlow 自动采集公开信息并编排生成，内容以原文为准。</p>
        <p>热搜与论坛内容仅代表公开讨论，未经证实的信息请谨慎判断。</p>
      </footer>
    </template>
  </AppLayout>
</template>

<style scoped>
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sk-card {
  height: 180px;
  animation: shimmer 1.4s infinite;
}

.sk-lines {
  height: 320px;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.9;
  }
}

.masthead {
  padding: 26px 28px 18px;
  background:
    radial-gradient(1200px 120px at 20% 0%, rgba(79, 70, 229, 0.1), transparent 70%),
    var(--surface);
}

.masthead-top {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
  border-bottom: 1px solid var(--border);
  padding-bottom: 18px;
}

.kicker {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--primary);
  font-weight: 600;
}

h1 {
  margin: 0;
  font-family: Georgia, 'Noto Serif SC', 'Songti SC', serif;
  font-size: clamp(32px, 4vw, 46px);
  line-height: 1.05;
  letter-spacing: 0.02em;
}

.dateline {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.issue {
  text-align: right;
  flex-shrink: 0;
}

.issue-line {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-muted);
}

.issue-meta {
  margin: 4px 0 10px;
  font-size: 13px;
  color: var(--text-muted);
}

.issue-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-small {
  padding: 6px 12px;
  font-size: 13px;
}

.anchors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 14px;
}

.anchor {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}

.anchor:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.banner {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 16px;
  border-radius: var(--radius);
  font-size: 13px;
  border: 1px solid var(--border);
  background: var(--surface);
}

.banner-info {
  color: var(--primary);
  border-color: rgba(79, 70, 229, 0.35);
  background: rgba(79, 70, 229, 0.06);
}

.banner-warn {
  color: #b45309;
  border-color: rgba(180, 83, 9, 0.3);
  background: rgba(245, 158, 11, 0.08);
}

.banner-error {
  color: var(--danger);
  border-color: rgba(220, 38, 38, 0.3);
  background: rgba(220, 38, 38, 0.06);
}

.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.empty {
  padding: 40px 24px;
  text-align: center;
}

.empty h2 {
  margin: 0 0 8px;
  font-family: Georgia, 'Noto Serif SC', serif;
}

.empty p {
  color: var(--text-muted);
  margin: 0 0 16px;
}

.muted {
  color: var(--text-muted);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-margin-top: 16px;
}

.section-head {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  border-bottom: 2px solid var(--text);
  padding-bottom: 8px;
}

.section-index {
  font-family: Georgia, 'Noto Serif SC', serif;
  font-size: 34px;
  line-height: 0.9;
  color: var(--primary);
}

.section-head h2 {
  margin: 0;
  font-family: Georgia, 'Noto Serif SC', 'Songti SC', serif;
  font-size: 24px;
  letter-spacing: 0.02em;
}

.section-head p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.section-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--mono);
}

.section-intro {
  margin: 0;
  padding: 10px 14px;
  border-left: 3px solid var(--primary);
  background: var(--surface-2);
  border-radius: 0 var(--radius) var(--radius) 0;
  font-size: 14px;
  line-height: 1.7;
}

.section-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.section-note.degraded {
  color: #b45309;
}

.items {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.item {
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
}

.item:last-child {
  border-bottom: none;
}

.item-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.kind {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid transparent;
  line-height: 1.5;
}

.kind-official {
  color: #1d4ed8;
  background: rgba(29, 78, 216, 0.08);
  border-color: rgba(29, 78, 216, 0.25);
}

.kind-folk {
  color: #c2410c;
  background: rgba(194, 65, 12, 0.08);
  border-color: rgba(194, 65, 12, 0.25);
}

.kind-mixed {
  color: var(--text-muted);
  background: var(--surface-2);
  border-color: var(--border);
}

.headline {
  font-family: Georgia, 'Noto Serif SC', 'Songti SC', serif;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--text);
  text-decoration: none;
}

a.headline:hover {
  color: var(--primary);
}

.summary {
  margin: 8px 0 10px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.source {
  font-weight: 500;
  color: var(--text-muted);
}

.heat {
  color: #c2410c;
  background: rgba(194, 65, 12, 0.08);
  border-radius: 3px;
  padding: 1px 6px;
}

.time {
  font-family: var(--mono);
}

.origin {
  margin-left: auto;
  color: var(--primary);
  text-decoration: none;
  white-space: nowrap;
}

.origin:hover {
  text-decoration: underline;
}

.tags {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.tag {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 3px;
  padding: 1px 6px;
}

.section-empty {
  margin: 0;
  padding: 18px;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}

.paper-foot {
  padding: 8px 0 12px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.7;
}

.paper-foot p {
  margin: 0;
}

@media (max-width: 720px) {
  .masthead {
    padding: 20px 18px 14px;
  }

  .masthead-top {
    flex-direction: column;
    gap: 14px;
  }

  .issue {
    text-align: left;
  }

  .issue-actions {
    justify-content: flex-start;
  }

  .section-head {
    align-items: center;
  }

  .section-index {
    font-size: 28px;
  }

  .section-head h2 {
    font-size: 20px;
  }

  .item {
    padding: 16px 14px;
  }

  .headline {
    font-size: 16px;
  }

  .origin {
    margin-left: 0;
  }
}

@media print {
  .no-print {
    display: none !important;
  }

  .masthead,
  .items,
  .section-intro {
    break-inside: avoid;
  }

  .item {
    break-inside: avoid;
  }
}
</style>
