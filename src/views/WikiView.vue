<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { ApiError, apiFetch } from '../lib/api'
import {
  cleanTitle,
  clearRecent,
  readRecent,
  rememberRecent,
  removeRecent,
  type WikiRecentEntry,
} from '../lib/wiki-recent'

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
const FONT_KEY = 'zf-wiki-font'
const SCROLL_KEY = 'zf-wiki-scroll'
const SIDEBAR_KEY = 'zf-wiki-sidebar'

const urlInput = ref('')
const page = ref<WikiPage | null>(null)
const loading = ref(false)
const error = ref('')
const elapsed = ref(0)
const recent = ref<WikiRecentEntry[]>([])
const fontSize = ref(14)
const bodyRef = ref<HTMLElement | null>(null)
const sidebarOpen = ref(true)
const nowTick = ref(Date.now())
let clockTimer: number | undefined

/** 每个页面地址记住的滚动位置，后退 / 前进时恢复 */
const scrollPositions = new Map<string, number>()
let persistTimer: number | undefined

/** 定位过程会短暂把内容清空，这段时间的滚动事件不能覆盖已记录的位置 */
let scrollSaveLocked = true

/** vue-router 写在 history.state 里的序号，用来判断这次是前进 / 后退还是新打开 */
let lastPosition = historyPosition()
const seenPositions = new Set<number>()
/** 由本页主动 push 的导航（点链接 / 输入地址），一定从顶部开始 */
let pushingByClick = false
/** 从「最近访问」点进来的，要回到上次阅读位置 */
let pendingRestore = false

function historyPosition(): number {
  const state = window.history.state as { position?: number } | null
  return typeof state?.position === 'number' ? state.position : 0
}

/**
 * 是否为历史导航（后退 / 前进）。
 * 不能依赖 popstate：实测 Vue Router 的 watch 有时比 popstate 先触发。
 * 后退一定让 position 变小；前进回到已出现过的 position；新 push 的 position 是新的。
 */
function isHistoryTraversal(): boolean {
  const position = historyPosition()
  const byClick = pushingByClick
  const traversal = !byClick && (position < lastPosition || seenPositions.has(position))

  lastPosition = position
  seenPositions.add(position)
  pushingByClick = false
  return traversal
}

function readScrollPositions() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '[]')
    if (!Array.isArray(raw)) return
    for (const item of raw) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'number') {
        scrollPositions.set(item[0] as string, item[1] as number)
      }
    }
  } catch {
    /* 忽略损坏的旧数据 */
  }
}

function persistScrollPositions() {
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    // 只保留最近 60 条，避免无限增长
    const entries = [...scrollPositions.entries()].slice(-60)
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify(entries))
    } catch {
      /* 存储写满就放弃持久化，内存里仍然有效 */
    }
  }, 300)
}

function onBodyScroll() {
  const el = bodyRef.value
  const target = currentTarget.value
  if (!el || !target || loading.value || scrollSaveLocked) return
  scrollPositions.set(target, el.scrollTop)
  // 同时按规范化地址记一份，「最近访问」点回来时也能恢复位置
  if (page.value) scrollPositions.set(page.value.pageUrl, el.scrollTop)
  persistScrollPositions()
}

/**
 * 恢复滚动位置。布局偶尔比 DOM 晚一帧，被 clamp 到更小的值时重试，
 * 期间若已跳到别的地址就放弃。
 */
function restoreScrollTo(top: number, target: string, attempt = 0) {
  requestAnimationFrame(() => {
    if (currentTarget.value !== target) return
    const el = bodyRef.value
    if (!el) return
    el.scrollTop = top
    if (Math.abs(el.scrollTop - top) > 2 && attempt < 3) {
      restoreScrollTo(top, target, attempt + 1)
    }
  })
}

/** 定位完成后隔两帧再解锁，避开内容重排产生的滚动事件 */
function unlockScrollSave() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollSaveLocked = false
    })
  })
}

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

function relativeTime(at: number): string {
  const diff = nowTick.value - at
  if (!at || diff < 0) return ''
  const minute = 60_000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 从最近访问打开：能恢复上次阅读位置就恢复，否则从头开始 */
function openRecent(item: WikiRecentEntry) {
  if (item.url === currentTarget.value || item.key === page.value?.pageUrl) {
    pendingRestore = false
    void load(item.url, { restoreScroll: true })
    return
  }
  pendingRestore = true
  pushingByClick = true
  void router.push({ path: '/wiki', query: { u: item.url } })
}

function removeRecentItem(key: string) {
  recent.value = removeRecent(key)
}

function clearAllRecent() {
  clearRecent()
  recent.value = []
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  localStorage.setItem(SIDEBAR_KEY, sidebarOpen.value ? '1' : '0')
}

/** 取地址里的 #锚点（后端会把 hash 去掉，这里只用于前端定位） */
function hashAnchor(target: string): string {
  const index = target.indexOf('#')
  if (index < 0) return ''
  const raw = target.slice(index + 1)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function scrollToAnchor(anchor: string) {
  const target =
    document.getElementById(anchor) ??
    document.getElementById(encodeURIComponent(anchor)) ??
    document.getElementById(anchor.replace(/_/g, ' '))
  target?.scrollIntoView({ block: 'start' })
}

async function load(target: string, options: { restoreScroll?: boolean } = {}) {
  if (!target) {
    page.value = null
    return
  }

  // 后退 / 前进要回到上次读到的地方，普通点进去则从头开始
  const restore = options.restoreScroll ?? false

  // 必须在切换成 loading 视图之前取，否则滚动条被夹到 0 会把记录覆盖掉
  const savedPos = restore ? scrollPositions.get(target) : undefined

  scrollSaveLocked = true
  loading.value = true
  error.value = ''

  const startedAt = performance.now()
  try {
    const result = await apiFetch<WikiPage>(`/wiki/page?u=${encodeURIComponent(target)}`)
    page.value = result
    urlInput.value = result.pageUrl
    elapsed.value = Math.round(performance.now() - startedAt)
    localStorage.setItem(URL_KEY, result.pageUrl)
    recent.value = rememberRecent({
      key: result.pageUrl,
      url: result.pageUrl,
      title: cleanTitle(result.title, result.siteName, result.pageUrl, result.kind),
      site: result.siteName,
      at: Date.now(),
    })
    nowTick.value = Date.now()

    // 必须先关掉 loading，正文才会真正进入 DOM，后面的定位才有意义
    loading.value = false
    await nextTick()

    const anchor = hashAnchor(target)

    if (savedPos !== undefined && savedPos > 0) {
      restoreScrollTo(savedPos, target)
    } else if (!restore && anchor) {
      scrollToAnchor(anchor)
      requestAnimationFrame(() => {
        if (currentTarget.value === target) scrollToAnchor(anchor)
      })
    } else {
      bodyRef.value?.scrollTo({ top: 0 })
    }

    unlockScrollSave()
  } catch (err) {
    page.value = null
    error.value = err instanceof ApiError ? err.message : '读取失败，请稍后重试'
    loading.value = false
    unlockScrollSave()
  }
}

function open(input?: string) {
  const raw = (input ?? urlInput.value).trim()
  if (!raw) return
  if (raw === currentTarget.value) {
    // 重新读取同一个地址：保持当前位置
    void load(raw, { restoreScroll: true })
    return
  }
  pushingByClick = true
  void router.push({ path: '/wiki', query: { u: raw } })
}

function reload() {
  if (currentTarget.value) void load(currentTarget.value, { restoreScroll: true })
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
    if (next) {
      pushingByClick = true
      void router.push({ path: '/wiki', query: { u: next } })
    }
  }
}

function setFont(delta: number) {
  const next = Math.min(18, Math.max(12, fontSize.value + delta))
  fontSize.value = next
  localStorage.setItem(FONT_KEY, String(next))
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

/** 首次进入页面时也恢复上次位置（相当于浏览器刷新后保持阅读进度） */
let firstLoad = true

readScrollPositions()

watch(
  () => route.query.u,
  (value) => {
    if (typeof value === 'string' && value) {
      const traversing = isHistoryTraversal()
      const restore = traversing || firstLoad || pendingRestore
      pendingRestore = false
      void load(value, { restoreScroll: restore })
      firstLoad = false
    } else {
      page.value = null
      pendingRestore = false
    }
  },
  { immediate: true },
)

onMounted(() => {
  const storedFont = Number(localStorage.getItem(FONT_KEY))
  if (storedFont >= 12 && storedFont <= 18) fontSize.value = storedFont
  recent.value = readRecent()
  const storedSidebar = localStorage.getItem(SIDEBAR_KEY)
  sidebarOpen.value = storedSidebar === null ? window.innerWidth >= 1100 : storedSidebar === '1'
  urlInput.value = currentTarget.value || localStorage.getItem(URL_KEY) || ''
  nowTick.value = Date.now()
  clockTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 60_000)
})

onBeforeUnmount(() => {
  window.clearTimeout(persistTimer)
  window.clearInterval(clockTimer)
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
          class="cmd"
          :class="{ on: sidebarOpen }"
          title="侧栏：最近访问 / 目录"
          @click="toggleSidebar"
        >
          ≡
        </button>
      </div>

      <div class="wiki-main">
        <div v-if="sidebarOpen" class="wiki-backdrop" @click="toggleSidebar" />
        <aside v-if="sidebarOpen" class="wiki-side">
          <section class="side-block side-recent">
            <p class="side-head">
              <span># recent</span>
              <span class="side-count">{{ recent.length }}</span>
            </p>
            <div class="side-scroll">
              <div
                v-for="item in recent"
                :key="item.key"
                class="recent-item"
                :class="{ current: !loading && item.key === page?.pageUrl }"
                role="button"
                tabindex="0"
                :title="item.url"
                @click="openRecent(item)"
                @keydown.enter.prevent="openRecent(item)"
              >
                <span class="recent-title">{{ item.title }}</span>
                <span class="recent-meta">{{ item.site }} · {{ relativeTime(item.at) }}</span>
                <button class="recent-del" title="移除这条记录" @click.stop="removeRecentItem(item.key)">
                  ×
                </button>
              </div>
              <p v-if="!recent.length" class="side-empty">// 还没有访问记录</p>
              <button v-if="recent.length" class="side-clear" @click="clearAllRecent">
                clear recent
              </button>
            </div>
          </section>

          <section v-if="page?.toc.length" class="side-block side-toc">
            <p class="side-head"># contents</p>
            <div class="side-scroll">
              <button
                v-for="section in page.toc"
                :key="`${section.anchor}-${section.title}`"
                class="toc-item"
                :style="{ paddingLeft: `${8 + (section.level - 1) * 14}px` }"
                @click="scrollToSection(section.anchor)"
              >
                {{ section.level === 1 ? '#' : '##' }} {{ section.title }}
              </button>
            </div>
          </section>
        </aside>

        <div
          ref="bodyRef"
          class="wiki-body"
          :style="{ fontSize: `${fontSize}px` }"
          @scroll.passive="onBodyScroll"
        >
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
            <p v-if="recent.length" class="empty-hint">
              // 最近访问 {{ recent.length }} 个页面，点顶部 ≡ 按钮或左侧列表快速回去。
            </p>
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

/* 主体：左侧栏（最近访问 + 目录） + 正文 */
.wiki-main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.wiki-side {
  width: 230px;
  flex-shrink: 0;
  border-right: 1px solid #1b222b;
  padding: 12px 0 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 最近访问 / 目录各自独立滚动，不共用一个滚动条 */
.side-block {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 0 1 auto;
}

.side-recent {
  flex: 0 0 auto;
  max-height: 55%;
}

.side-toc {
  flex: 1 1 auto;
}

.side-block:only-child {
  max-height: none;
  flex: 1 1 auto;
}

.side-scroll {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 4px;
}

.side-scroll::-webkit-scrollbar {
  width: 6px;
}

.side-scroll::-webkit-scrollbar-thumb {
  background: #232b35;
  border-radius: 3px;
}

.side-scroll::-webkit-scrollbar-thumb:hover {
  background: #3a4552;
}

.side-block + .side-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #1b222b;
}

.side-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 6px;
  padding: 0 10px;
  color: #4f5a67;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.side-count {
  color: #3f4954;
}

.side-empty {
  margin: 0;
  padding: 2px 10px;
  color: #3f4954;
  font-size: 11px;
}

/* 最近访问条目 */
.recent-item {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  padding: 4px 22px 5px 10px;
  cursor: pointer;
}

.recent-item:hover {
  background: #121820;
}

.recent-item.current {
  border-left-color: #5c7183;
  background: #10161d;
}

.recent-item:focus-visible {
  outline: 1px solid #3a4552;
  outline-offset: -1px;
}

.recent-title {
  display: block;
  color: #b9c2cd;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-item.current .recent-title {
  color: #e6e9ee;
}

.recent-meta {
  display: block;
  color: #4f5a67;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-del {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  padding: 0;
  line-height: 14px;
  text-align: center;
  background: none;
  border: none;
  color: #4f5a67;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
}

.recent-item:hover .recent-del,
.recent-del:focus-visible {
  opacity: 1;
}

.recent-del:hover {
  color: #d98b8b;
}

.side-clear {
  align-self: flex-start;
  margin-top: 6px;
  padding: 2px 10px;
  background: none;
  border: none;
  color: #3f4954;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.side-clear:hover {
  color: #8b96a3;
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

/* 窄屏时侧栏改为浮层，点背景关闭 */
.wiki-backdrop {
  display: none;
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
  .wiki-side {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    width: 260px;
    background: #0b0e11;
    border-right: 1px solid #232b35;
    padding-top: 10px;
  }

  .wiki-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 10;
    background: rgba(0, 0, 0, 0.5);
  }

  .wiki-body {
    padding: 14px 14px 32px;
  }

  .bar-gap {
    display: none;
  }
}
</style>
