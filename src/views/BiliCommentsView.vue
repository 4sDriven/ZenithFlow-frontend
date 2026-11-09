<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import BiliLoginModal from '../components/BiliLoginModal.vue'
import BiliReplyModal from '../components/BiliReplyModal.vue'
import HeatMeter from '../components/HeatMeter.vue'
import SubReplyItem from '../components/SubReplyItem.vue'
import ThreadGraphModal from '../components/ThreadGraphModal.vue'
import { ApiError, apiFetch } from '../lib/api'

type Sort = 'hot' | 'latest'
type Tab = 'search' | 'up' | 'direct'

type BiliAccount = {
  mid: string
  uname: string
  boundAt: string
  updatedAt: string
  expiresAt: string | null
  expired: boolean
}

type Comment = {
  rpid: string
  mid: string
  uname: string
  message: string
  pictureCount: number
  like: number
  ctime: number
  replyCount: number
  isUp: boolean
  replyTo: { mid: string; uname: string } | null
  /** 本会话内的点赞状态（B 站列表接口不返回当前账号的点赞状态） */
  liked?: boolean
  likePending?: boolean
}

type Video = {
  bvid: string
  aid: number
  title: string
  ownerMid: string
  ownerName: string
  cover: string
  pubdate: number
  duration: number
  commentCount: number
}

type CommentsResponse = {
  ok: boolean
  video: Video
  comments: Comment[]
  cursor: string
  nextCursor: string | null
  limit: number
  total: number
  totalPages: number
  pagesExact: boolean
  hasMore: boolean
  sort: Sort
}

type RepliesResponse = {
  ok: boolean
  comments: Comment[]
  page: number
  size: number
  total: number
  totalPages: number
  hasMore: boolean
}

type TitlePart = { text: string; hl: boolean }

type SearchVideo = {
  bvid: string
  aid: number
  title: string
  titleParts: TitlePart[]
  author: string
  mid: string
  play: number
  review: number
  like: number
  pubdate: number
  duration: string
  typename: string
  tags: string[]
  heatScore: number
  heatLevel: number
  heatLabel: string
  likeRate: number
}

type SearchResponse = {
  ok: boolean
  keyword: string
  page: number
  size: number
  total: number
  totalPages: number
  videos: SearchVideo[]
}

type UpUser = {
  mid: string
  uname: string
  usign: string
  fans: number
  videos: number
  level: number
  official: string
}

type UpSearchResponse = {
  ok: boolean
  keyword: string
  page: number
  size: number
  total: number
  totalPages: number
  users: UpUser[]
}

type UpVideo = {
  bvid: string
  aid: number
  title: string
  play: number
  danmaku: number
  pubdate: number
  duration: string
  typename: string
}

type UpVideosResponse = {
  ok: boolean
  mid: string
  user: UpUser
  order: 'pubdate' | 'click'
  page: number
  size: number
  total: number
  totalPages: number
  limited: boolean
  videos: UpVideo[]
}

type SubState = {
  open: boolean
  loading: boolean
  page: number
  total: number
  totalPages: number
  comments: Comment[]
  error: string
}

type CommentRow = Comment & { sub?: SubState }

const route = useRoute()
const router = useRouter()

const tab = ref<Tab>('search')
const keyword = ref('')
const directInput = ref('')
const searching = ref(false)
const searchError = ref('')
const searchResult = ref<SearchResponse | null>(null)
const searchPage = ref(1)
const searchJump = ref(1)

const upKeyword = ref('')
const upSearching = ref(false)
const upError = ref('')
const upResult = ref<UpSearchResponse | null>(null)
const upPage = ref(1)
const upJump = ref(1)
const selectedUp = ref<UpUser | null>(null)
const upVideos = ref<UpVideosResponse | null>(null)
const upOrder = ref<'pubdate' | 'click'>('pubdate')
const upVideoLoading = ref(false)
const upVideoError = ref('')
const upScroll = ref<HTMLElement | null>(null)
const upVideoScroll = ref<HTMLElement | null>(null)
const upScrollTop = ref(0)
const upVideoScrollTop = ref(0)
const returnTo = ref<'search' | 'up'>('search')

const activeBvid = ref('')
const input = ref('')
const sort = ref<Sort>('hot')
const commentView = ref<'list' | 'grid'>('list')
const biliAccount = ref<BiliAccount | null>(null)
const biliAccountError = ref('')
const biliLoginOpen = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const error = ref('')
const result = ref<CommentsResponse | null>(null)
const rows = ref<CommentRow[]>([])
const commentCursor = ref('1:0')

/** 评论无限滚动：首屏 100 条，之后触底每次加 50 条 */
const INITIAL_COMMENT_LIMIT = 100
const MORE_COMMENT_LIMIT = 50

const searchScroll = ref<HTMLElement | null>(null)
const commentScroll = ref<HTMLElement | null>(null)
const searchScrollTop = ref(0)

const subScrolls = new Map<string, HTMLElement>()

const threadOpen = ref(false)
const threadRoot = ref('')
const threadTarget = ref('')
const threadRootComment = ref<Comment | null>(null)

type ReplyTarget = {
  mode: 'top' | 'reply'
  /** 主评论 rpid；顶层评论为 '0' */
  root: string
  /** 被回复的评论 rpid；顶层评论为 '0' */
  parent: string
  uname: string
}

const replyTarget = ref<ReplyTarget | null>(null)
const replySubmitting = ref(false)
const replyError = ref('')
const toast = ref('')
let toastTimer: number | undefined

const replyTitle = computed(() =>
  replyTarget.value?.mode === 'top' ? '发表评论' : '回复评论',
)

function notify(message: string) {
  toast.value = message
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 2600)
}

function requireBiliAccount(): boolean {
  if (biliAccount.value && !biliAccount.value.expired) return true
  biliAccountError.value = biliAccount.value
    ? 'B 站登录已过期，请重新扫码绑定'
    : '请先绑定 B 站账号后再点赞或回复'
  biliLoginOpen.value = true
  return false
}

function currentAid(): number {
  return result.value?.video.aid ?? 0
}

async function toggleLike(comment: Comment) {
  if (!requireBiliAccount()) return
  if (comment.likePending) return

  const aid = currentAid()
  if (!aid) return

  const action = comment.liked ? 0 : 1
  const prevLiked = comment.liked
  const prevCount = comment.like

  comment.liked = action === 1
  comment.like = Math.max(0, prevCount + (action === 1 ? 1 : -1))
  comment.likePending = true

  try {
    await apiFetch('/bili/comments/like', {
      method: 'POST',
      body: JSON.stringify({ aid, rpid: comment.rpid, action }),
    })
  } catch (err) {
    comment.liked = prevLiked
    comment.like = prevCount
    notify(err instanceof ApiError ? err.message : '点赞失败，请稍后再试')
  } finally {
    comment.likePending = false
  }
}

function openTopComposer() {
  if (!requireBiliAccount()) return
  replyTarget.value = { mode: 'top', root: '0', parent: '0', uname: '' }
  replyError.value = ''
}

function openRootReply(comment: Comment) {
  if (!requireBiliAccount()) return
  replyTarget.value = {
    mode: 'reply',
    root: comment.rpid,
    parent: comment.rpid,
    uname: comment.uname,
  }
  replyError.value = ''
}

function openSubReply(row: CommentRow, comment: Comment) {
  if (!requireBiliAccount()) return
  replyTarget.value = {
    mode: 'reply',
    root: row.rpid,
    parent: comment.rpid,
    uname: comment.uname,
  }
  replyError.value = ''
}

function closeReply() {
  if (replySubmitting.value) return
  replyTarget.value = null
  replyError.value = ''
}

function localComment(target: ReplyTarget, message: string, rpid: string): Comment {
  const account = biliAccount.value
  const video = result.value?.video
  const mid = account?.mid ?? ''
  return {
    rpid,
    mid,
    uname: account?.uname ?? '我',
    message,
    pictureCount: 0,
    like: 0,
    ctime: Math.floor(Date.now() / 1000),
    replyCount: 0,
    isUp: Boolean(mid) && mid === video?.ownerMid,
    replyTo:
      target.mode === 'reply' && target.parent !== target.root
        ? { mid: '', uname: target.uname }
        : null,
  }
}

function applyCreatedComment(target: ReplyTarget, message: string, rpid: string, created: Comment | null) {
  const comment = created ?? localComment(target, message, rpid)
  if (!comment.rpid) comment.rpid = rpid || `local-${Date.now()}`

  if (target.mode === 'top') {
    rows.value.unshift({ ...comment })
    if (result.value) result.value.total += 1
    void nextTick(() => commentScroll.value?.scrollTo({ top: 0, behavior: 'smooth' }))
    return
  }

  const row = rows.value.find((item) => item.rpid === target.root)
  if (!row) return
  row.replyCount += 1

  if (row.sub?.open) {
    row.sub.total += 1
    row.sub.totalPages = Math.ceil(row.sub.total / 10)
    if (row.sub.page === 1) row.sub.comments.unshift({ ...comment })
  }
}

async function submitReply(message: string) {
  const target = replyTarget.value
  const aid = currentAid()
  if (!target || !aid) return

  replySubmitting.value = true
  replyError.value = ''

  try {
    const data = await apiFetch<{
      ok: boolean
      rpid: string
      comment: Comment | null
    }>('/bili/comments', {
      method: 'POST',
      body: JSON.stringify({
        aid,
        message,
        root: target.root,
        parent: target.parent,
      }),
    })
    applyCreatedComment(target, message, data.rpid, data.comment)
    replyTarget.value = null
    notify(target.mode === 'top' ? '评论已发布' : '回复已发布')
  } catch (err) {
    replyError.value = err instanceof ApiError ? err.message : '发布失败，请稍后再试'
  } finally {
    replySubmitting.value = false
  }
}

function openThread(row: CommentRow, sub: Comment) {
  threadRoot.value = row.rpid
  threadTarget.value = sub.rpid
  threadRootComment.value = row
  threadOpen.value = true
}

function openRootThread(row: CommentRow) {
  threadRoot.value = row.rpid
  threadTarget.value = row.rpid
  threadRootComment.value = row
  threadOpen.value = true
}

function setSubScroll(rpid: string, el: unknown) {
  if (el instanceof HTMLElement) subScrolls.set(rpid, el)
  else subScrolls.delete(rpid)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

function formatDate(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts * 1000)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatCount(value: number): string {
  if (!value) return '0'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return String(value)
}

function spaceUrl(mid: string): string {
  return `https://space.bilibili.com/${mid}`
}

function switchTab(next: Tab) {
  tab.value = next
  searchError.value = ''
  upError.value = ''
  error.value = ''
}

function syncSearchQuery() {
  void router.replace({
    query: {
      keyword: searchResult.value?.keyword ?? keyword.value.trim(),
      page: String(searchResult.value?.page ?? 1),
    },
  })
}

function syncUpListQuery() {
  void router.replace({
    query: {
      stype: 'up',
      keyword: upResult.value?.keyword ?? upKeyword.value.trim(),
      upage: String(upResult.value?.page ?? upPage.value),
    },
  })
}

function syncUpDetailQuery() {
  const query: Record<string, string> = {
    stype: 'up',
    up: selectedUp.value?.mid ?? upVideos.value?.mid ?? '',
    uppage: String(upVideos.value?.page ?? 1),
    uporder: upOrder.value,
  }
  if (selectedUp.value?.uname) query.upname = selectedUp.value.uname
  if (upResult.value) {
    query.keyword = upResult.value.keyword
    query.upage = String(upResult.value.page)
  }
  void router.replace({ query })
}

function syncCommentQuery() {
  const query: Record<string, string> = { bvid: activeBvid.value || input.value.trim() }
  if (returnTo.value === 'up' && selectedUp.value) {
    query.stype = 'up'
    query.up = selectedUp.value.mid
    query.uppage = String(upVideos.value?.page ?? 1)
    query.uporder = upOrder.value
    if (selectedUp.value.uname) query.upname = selectedUp.value.uname
    if (upResult.value) {
      query.keyword = upResult.value.keyword
      query.upage = String(upResult.value.page)
    }
  } else {
    if (keyword.value.trim()) query.keyword = keyword.value.trim()
    query.spage = String(searchResult.value?.page ?? searchPage.value)
  }
  query.loaded = String(rows.value.length || INITIAL_COMMENT_LIMIT)
  query.sort = sort.value
  if (commentView.value === 'grid') query.view = 'grid'
  void router.replace({ query })
}

async function runSearch(targetPage = 1) {
  const q = keyword.value.trim()
  if (!q) {
    searchError.value = '请输入搜索关键词'
    return
  }

  searching.value = true
  searchError.value = ''
  try {
    const data = await apiFetch<SearchResponse>(
      `/bili/search?keyword=${encodeURIComponent(q)}&page=${targetPage}`,
    )
    searchResult.value = data
    searchPage.value = data.page
    searchJump.value = data.page
    activeBvid.value = ''
    result.value = null
    rows.value = []
    syncSearchQuery()
    await nextTick()
    searchScroll.value?.scrollTo({ top: 0 })
  } catch (err) {
    searchError.value = err instanceof ApiError ? err.message : '搜索失败，请稍后再试'
  } finally {
    searching.value = false
  }
}

function gotoSearch(target: number) {
  const max = searchResult.value?.totalPages ?? 1
  const page = Math.min(Math.max(1, Math.trunc(target) || 1), max)
  if (page === searchResult.value?.page) return
  void runSearch(page)
}

function jumpSearch() {
  gotoSearch(searchJump.value)
}

async function runUpSearch(targetPage = 1) {
  const q = upKeyword.value.trim()
  if (!q) {
    upError.value = '请输入 UP 主名字'
    return
  }

  upSearching.value = true
  upError.value = ''
  selectedUp.value = null
  upVideos.value = null
  upVideoError.value = ''
  try {
    const data = await apiFetch<UpSearchResponse>(
      `/bili/up/search?keyword=${encodeURIComponent(q)}&page=${targetPage}`,
    )
    upResult.value = data
    upPage.value = data.page
    upJump.value = data.page
    activeBvid.value = ''
    result.value = null
    rows.value = []
    syncUpListQuery()
    await nextTick()
    upScroll.value?.scrollTo({ top: 0 })
  } catch (err) {
    upError.value = err instanceof ApiError ? err.message : '搜索 UP 主失败，请稍后再试'
  } finally {
    upSearching.value = false
  }
}

function gotoUpSearch(target: number) {
  const max = upResult.value?.totalPages ?? 1
  const page = Math.min(Math.max(1, Math.trunc(target) || 1), max)
  if (page === upResult.value?.page) return
  void runUpSearch(page)
}

function jumpUpSearch() {
  gotoUpSearch(upJump.value)
}

async function loadUpVideos(
  mid: string,
  targetPage = 1,
  order: 'pubdate' | 'click' = upOrder.value,
  keepView = false,
) {
  upVideoLoading.value = true
  upVideoError.value = ''
  try {
    const data = await apiFetch<UpVideosResponse>(
      `/bili/up/videos?mid=${encodeURIComponent(mid)}&page=${targetPage}&order=${order}`,
    )
    selectedUp.value = data.user
    upVideos.value = data
    upOrder.value = data.order
    upJump.value = data.page
    if (!keepView) {
      activeBvid.value = ''
      result.value = null
      rows.value = []
      syncUpDetailQuery()
      await nextTick()
      upVideoScroll.value?.scrollTo({ top: 0 })
    }
  } catch (err) {
    upVideoError.value = err instanceof ApiError ? err.message : '获取 UP 主投稿失败，请稍后再试'
  } finally {
    upVideoLoading.value = false
  }
}

async function openUp(user: UpUser) {
  upScrollTop.value = upScroll.value?.scrollTop ?? 0
  selectedUp.value = user
  upVideos.value = null
  upVideoError.value = ''
  await loadUpVideos(user.mid, 1, upOrder.value)
}

function gotoUpVideos(target: number) {
  const max = upVideos.value?.totalPages ?? 1
  const page = Math.min(Math.max(1, Math.trunc(target) || 1), max)
  if (page === upVideos.value?.page) return
  if (selectedUp.value) void loadUpVideos(selectedUp.value.mid, page, upOrder.value)
}

async function jumpUpVideos() {
  gotoUpVideos(upJump.value)
}

async function changeUpOrder(next: 'pubdate' | 'click') {
  if (next === upOrder.value) return
  upOrder.value = next
  if (selectedUp.value) await loadUpVideos(selectedUp.value.mid, 1, next)
}

async function backToUpList() {
  selectedUp.value = null
  upVideos.value = null
  upVideoError.value = ''
  error.value = ''

  if (upResult.value) {
    syncUpListQuery()
    await nextTick()
    if (upScroll.value) upScroll.value.scrollTop = upScrollTop.value
    return
  }

  if (upKeyword.value.trim()) {
    await runUpSearch(upPage.value || 1)
    return
  }

  await router.replace({ query: {} })
}

async function searchUpByName(name: string) {
  upKeyword.value = name
  switchTab('up')
  await runUpSearch(1)
}

async function openVideo(raw: string, from: 'search' | 'up' = 'search') {
  const value = raw.trim()
  if (!value) {
    error.value = '请输入 B 站视频链接、BV 号或 av 号'
    return
  }

  returnTo.value = from
  if (from === 'up') {
    upVideoScrollTop.value = upVideoScroll.value?.scrollTop ?? 0
  } else {
    searchScrollTop.value = searchScroll.value?.scrollTop ?? 0
  }
  activeBvid.value = value
  input.value = value
  sort.value = 'hot'
  result.value = null
  rows.value = []
  error.value = ''
  await load(true)
}

function submitTop() {
  if (tab.value === 'direct') {
    void openVideo(directInput.value)
  } else if (tab.value === 'up') {
    void runUpSearch(1)
  } else {
    void runSearch(1)
  }
}

async function backToSearch() {
  activeBvid.value = ''
  result.value = null
  rows.value = []
  error.value = ''

  if (returnTo.value === 'up') {
    tab.value = 'up'
    syncUpDetailQuery()
    await nextTick()
    if (upVideoScroll.value) upVideoScroll.value.scrollTop = upVideoScrollTop.value
    return
  }

  tab.value = 'search'

  if (!keyword.value.trim()) {
    await router.replace({ query: {} })
    return
  }

  if (searchResult.value) {
    await router.replace({
      query: {
        keyword: searchResult.value.keyword,
        page: String(searchResult.value.page),
      },
    })
    await nextTick()
    if (searchScroll.value) searchScroll.value.scrollTop = searchScrollTop.value
    return
  }

  await runSearch(searchPage.value || 1)
}

function appendComments(data: CommentsResponse) {
  const seen = new Set(rows.value.map((row) => row.rpid))
  for (const comment of data.comments) {
    if (seen.has(comment.rpid)) continue
    seen.add(comment.rpid)
    rows.value.push({ ...comment })
  }
}

async function load(reset = true) {
  if (!input.value.trim()) {
    error.value = '请输入 B 站视频链接、BV 号或 av 号'
    return
  }
  if (!reset && (loading.value || loadingMore.value || !hasMore.value)) return

  const cursor = reset ? '1:0' : commentCursor.value
  const limit = reset ? INITIAL_COMMENT_LIMIT : MORE_COMMENT_LIMIT

  if (reset) {
    loading.value = true
    commentCursor.value = '1:0'
  } else loadingMore.value = true
  error.value = ''

  try {
    const data = await apiFetch<CommentsResponse>(
      `/bili/comments?input=${encodeURIComponent(input.value.trim())}&cursor=${encodeURIComponent(cursor)}&limit=${limit}&sort=${sort.value}`,
    )
    result.value = data
    sort.value = data.sort
    commentCursor.value = data.nextCursor ?? data.cursor
    if (reset) {
      rows.value = data.comments.map((comment) => ({ ...comment }))
    } else {
      appendComments(data)
    }
    hasMore.value = data.hasMore && data.comments.length > 0
    syncCommentQuery()
    if (reset) {
      await nextTick()
      commentScroll.value?.scrollTo({ top: 0 })
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '获取评论失败，请稍后再试'
    if (!reset) hasMore.value = false
  } finally {
    if (reset) loading.value = false
    else loadingMore.value = false
  }
}

function onCommentScroll() {
  const el = commentScroll.value
  if (!el || loading.value || loadingMore.value || !hasMore.value) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight > 240) return
  void load(false)
}

async function restoreComments(target: number) {
  const max = Math.min(Math.max(INITIAL_COMMENT_LIMIT, Math.trunc(target) || 0), 1000)
  await load(true)
  let lastLength = rows.value.length
  while (hasMore.value && rows.value.length < max) {
    await load(false)
    if (rows.value.length === lastLength) break
    lastLength = rows.value.length
  }
}

async function retryMore() {
  hasMore.value = true
  await load(false)
}

function changeSort(next: Sort) {
  if (next === sort.value) return
  if (loading.value || loadingMore.value) return
  sort.value = next
  void load(true)
}

function setCommentView(next: 'list' | 'grid') {
  if (next === commentView.value) return
  commentView.value = next
  syncCommentQuery()
}

function ensureSub(row: CommentRow): SubState {
  if (!row.sub) {
    row.sub = {
      open: false,
      loading: false,
      page: 0,
      total: row.replyCount,
      totalPages: 1,
      comments: [],
      error: '',
    }
  }
  return row.sub
}

async function loadSub(row: CommentRow, page: number) {
  const state = ensureSub(row)
  state.error = ''
  state.loading = true

  try {
    const data = await apiFetch<RepliesResponse>(
      `/bili/replies?input=${encodeURIComponent(activeBvid.value || input.value.trim())}&root=${encodeURIComponent(row.rpid)}&page=${page}`,
    )
    state.comments = data.comments
    state.page = data.page
    state.total = data.total
    state.totalPages = data.totalPages || 1

    await nextTick()
    const scroller = subScrolls.get(row.rpid)
    if (scroller) scroller.scrollTop = 0
  } catch (err) {
    state.error = err instanceof ApiError ? err.message : '子评论加载失败'
  } finally {
    state.loading = false
  }
}

async function toggleSub(row: CommentRow) {
  const state = ensureSub(row)
  if (state.open) {
    state.open = false
    return
  }
  state.open = true
  if (state.comments.length === 0 && !state.loading) {
    await loadSub(row, 1)
  }
}

async function loadBiliAccount() {
  try {
    const data = await apiFetch<{ ok: boolean; account: BiliAccount | null }>('/bili/auth/me')
    biliAccount.value = data.account ?? null
    biliAccountError.value = ''
  } catch {
    // 未绑定或接口异常时保持未绑定状态，不打断页面
  }
}

function onBiliBound(account: BiliAccount | null) {
  biliAccount.value = account
  biliAccountError.value = ''
}

async function unbindBili() {
  if (!window.confirm('解绑后将删除本站保存的 B 站登录凭据，确定解绑吗？')) return

  try {
    await apiFetch('/bili/auth', { method: 'DELETE' })
    biliAccount.value = null
    biliAccountError.value = ''
  } catch (err) {
    biliAccountError.value = err instanceof ApiError ? err.message : '解绑失败，请稍后再试'
  }
}

onMounted(() => {
  void loadBiliAccount()
  const q = route.query
  const qKeyword = typeof q.keyword === 'string' ? q.keyword : ''
  const qBvid = typeof q.bvid === 'string' ? q.bvid : ''
  const qInput = typeof q.input === 'string' ? q.input : ''
  const qSort = q.sort === 'latest' ? 'latest' : 'hot'
  const qPage = Number(q.page)
  const qLoaded = Number(q.loaded)
  const qSpage = Number(q.spage)
  const qStype = q.stype === 'up' ? 'up' : ''
  const qUp = typeof q.up === 'string' && /^\d{1,20}$/.test(q.up) ? q.up : ''
  const qUppage = Number(q.uppage)
  const qUpage = Number(q.upage)
  const qUporder = q.uporder === 'click' ? 'click' : 'pubdate'
  const qView = q.view === 'grid' ? 'grid' : 'list'
  const validPage = (value: number) => (Number.isInteger(value) && value > 0 ? value : 1)
  const restoreLoaded =
    Number.isInteger(qLoaded) && qLoaded > 0
      ? qLoaded
      : Number.isInteger(qPage) && qPage > 1
        ? qPage * 30
        : INITIAL_COMMENT_LIMIT

  keyword.value = qKeyword
  upKeyword.value = typeof q.upname === 'string' && q.upname ? q.upname : qKeyword
  sort.value = qSort
  commentView.value = qView
  upPage.value = validPage(qUpage)

  const direct = qBvid || qInput
  if (direct) {
    activeBvid.value = direct
    input.value = direct
    directInput.value = direct
    tab.value = 'direct'
    searchPage.value = Number.isInteger(qSpage) && qSpage > 0 ? qSpage : 1
    if (qUp) {
      returnTo.value = 'up'
      upOrder.value = qUporder
      selectedUp.value = {
        mid: qUp,
        uname: typeof q.upname === 'string' ? q.upname : '',
        usign: '',
        fans: 0,
        videos: 0,
        level: 0,
        official: '',
      }
      void loadUpVideos(qUp, validPage(qUppage), qUporder, true)
    }
    void restoreComments(restoreLoaded)
    return
  }

  if (qUp) {
    tab.value = 'up'
    upOrder.value = qUporder
    selectedUp.value = {
      mid: qUp,
      uname: typeof q.upname === 'string' ? q.upname : '',
      usign: '',
      fans: 0,
      videos: 0,
      level: 0,
      official: '',
    }
    void loadUpVideos(qUp, validPage(qUppage), qUporder)
    return
  }

  if (qStype === 'up') {
    tab.value = 'up'
    if (qKeyword) void runUpSearch(validPage(qUpage))
    return
  }

  if (qKeyword) {
    tab.value = 'search'
    void runSearch(validPage(qPage))
  }
})

onBeforeUnmount(() => {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
})
</script>

<template>
  <AppLayout fill>
    <section class="card panel">
      <div class="panel-head">
        <div class="tabs">
          <button class="tab" :class="{ active: tab === 'search' }" @click="switchTab('search')">
            搜视频
          </button>
          <button class="tab" :class="{ active: tab === 'up' }" @click="switchTab('up')">
            搜UP主
          </button>
          <button class="tab" :class="{ active: tab === 'direct' }" @click="switchTab('direct')">
            链接 / BV
          </button>
        </div>

        <div class="bili-account">
          <template v-if="biliAccount">
            <span class="bili-name" :class="{ expired: biliAccount.expired }">
              B站：{{ biliAccount.uname || biliAccount.mid }}
              <em v-if="biliAccount.expired">已过期</em>
            </span>
            <button class="link-btn" @click="biliLoginOpen = true">重新绑定</button>
            <button class="link-btn" @click="unbindBili">解绑</button>
          </template>
          <button v-else class="btn btn-ghost btn-sm" @click="biliLoginOpen = true">
            B站登录
          </button>
          <span v-if="biliAccountError" class="err inline-err">{{ biliAccountError }}</span>
        </div>
      </div>

      <form class="search" @submit.prevent="submitTop">
        <input
          v-if="tab === 'search'"
          v-model="keyword"
          class="input"
          placeholder="输入关键词，例如：英雄联盟"
          maxlength="50"
        />
        <input
          v-else-if="tab === 'up'"
          v-model="upKeyword"
          class="input"
          placeholder="输入 UP 主名字，例如：老番茄"
          maxlength="50"
        />
        <input
          v-else
          v-model="directInput"
          class="input"
          placeholder="粘贴 B 站链接，或输入 BV 号 / av 号，例如 BV1Zj4v6aEuj"
          maxlength="300"
        />
        <button
          class="btn btn-primary"
          type="submit"
          :disabled="searching || upSearching || loading"
        >
          {{
            tab === 'search'
              ? searching
                ? '搜索中…'
                : '搜索'
              : tab === 'up'
                ? upSearching
                  ? '搜索中…'
                  : '搜UP主'
                : loading
                  ? '查询中…'
                  : '看评论'
          }}
        </button>
      </form>

      <p class="hint">纯文字浏览，不加载图片；视频搜索最多 50 页，UP 主投稿最多 200 条。</p>
      <p v-if="tab === 'search' && searchError" class="err">{{ searchError }}</p>
      <p v-if="tab === 'up' && upError" class="err">{{ upError }}</p>
      <p v-if="tab === 'direct' && error" class="err">{{ error }}</p>
    </section>

    <template v-if="!activeBvid">
      <template v-if="tab === 'up'">
        <template v-if="selectedUp">
          <section class="card up-summary">
            <div class="up-main">
              <button class="back-btn" @click="backToUpList">← 返回UP主列表</button>
              <h3 class="up-name">{{ selectedUp.uname || 'UP 主加载中…' }}</h3>
              <div class="up-meta">
                <span>UID {{ selectedUp.mid }}</span>
                <span>粉丝 {{ formatCount(selectedUp.fans) }}</span>
                <span>投稿 {{ formatCount(upVideos?.total ?? selectedUp.videos) }}</span>
                <span v-if="selectedUp.level">Lv{{ selectedUp.level }}</span>
                <span v-if="selectedUp.official" class="tag">{{ selectedUp.official }}</span>
              </div>
              <p v-if="selectedUp.usign" class="up-sign">{{ selectedUp.usign }}</p>
            </div>
            <div class="up-side">
              <div class="sort-switch">
                <button
                  class="sort-btn"
                  :class="{ active: upOrder === 'pubdate' }"
                  :disabled="upVideoLoading"
                  @click="changeUpOrder('pubdate')"
                >
                  最新发布
                </button>
                <button
                  class="sort-btn"
                  :class="{ active: upOrder === 'click' }"
                  :disabled="upVideoLoading"
                  @click="changeUpOrder('click')"
                >
                  最多播放
                </button>
              </div>
              <span v-if="upVideos?.limited" class="limit-note">仅显示前 200 个投稿</span>
            </div>
          </section>

          <section v-if="upVideos" class="card search-summary">
            <span>{{ upOrder === 'pubdate' ? '最新发布' : '最多播放' }} · 共 {{ upVideos.total.toLocaleString() }} 个投稿</span>
            <span>第 {{ upVideos.page }} / {{ upVideos.totalPages }} 页</span>
          </section>

          <div ref="upVideoScroll" class="scroll-area">
            <section v-if="upVideos && upVideos.videos.length > 0" class="result-list">
              <article
                v-for="v in upVideos.videos"
                :key="v.bvid"
                class="card result"
                @click="openVideo(v.bvid, 'up')"
              >
                <div class="r-head">
                  <h3 class="r-title">{{ v.title }}</h3>
                </div>
                <div class="r-meta">
                  <span>播放 {{ formatCount(v.play) }}</span>
                  <span>弹幕 {{ formatCount(v.danmaku) }}</span>
                  <span>时长 {{ v.duration }}</span>
                  <span>{{ formatDate(v.pubdate) }}</span>
                  <span class="r-bv">{{ v.bvid }}</span>
                </div>
                <div class="r-tags">
                  <span v-if="v.typename" class="tag">{{ v.typename }}</span>
                  <span class="r-look">看评论 →</span>
                </div>
              </article>
            </section>

            <p v-if="upVideoLoading" class="muted-text">投稿加载中…</p>
            <p v-else-if="upVideoError" class="card empty err-text">{{ upVideoError }}</p>
            <p v-else-if="upVideos && upVideos.videos.length === 0" class="card empty">
              这个 UP 主暂时没有可显示的投稿。
            </p>
          </div>

          <section v-if="upVideos && upVideos.totalPages > 1" class="card pager">
            <button
              class="btn btn-ghost"
              :disabled="upVideoLoading || upVideos.page <= 1"
              @click="gotoUpVideos(upVideos.page - 1)"
            >
              上一页
            </button>
            <span class="pager-text">第</span>
            <input
              v-model.number="upJump"
              class="input page-input"
              type="number"
              min="1"
              :max="upVideos.totalPages"
            />
            <span class="pager-text">/ {{ upVideos.totalPages }} 页</span>
            <button class="btn btn-ghost" :disabled="upVideoLoading" @click="jumpUpVideos">
              跳转
            </button>
            <button
              class="btn btn-ghost"
              :disabled="upVideoLoading || upVideos.page >= upVideos.totalPages"
              @click="gotoUpVideos(upVideos.page + 1)"
            >
              下一页
            </button>
          </section>
        </template>

        <template v-else>
          <section v-if="upResult" class="card search-summary">
            <span>「{{ upResult.keyword }}」共 {{ upResult.total.toLocaleString() }} 位相关 UP 主</span>
            <span>第 {{ upResult.page }} / {{ upResult.totalPages }} 页</span>
          </section>

          <div ref="upScroll" class="scroll-area">
            <section v-if="upResult && upResult.users.length > 0" class="result-list">
              <article
                v-for="u in upResult.users"
                :key="u.mid"
                class="card result up-card"
                @click="openUp(u)"
              >
                <div class="r-head">
                  <h3 class="r-title">{{ u.uname }}</h3>
                  <span v-if="u.official" class="tag">{{ u.official }}</span>
                </div>
                <div class="r-meta">
                  <span>UID {{ u.mid }}</span>
                  <span>粉丝 {{ formatCount(u.fans) }}</span>
                  <span>投稿 {{ formatCount(u.videos) }}</span>
                  <span v-if="u.level">Lv{{ u.level }}</span>
                </div>
                <div class="r-tags">
                  <span v-if="u.usign" class="up-sign">{{ u.usign }}</span>
                  <span class="r-look">看TA的视频 →</span>
                </div>
              </article>
            </section>

            <p v-if="upSearching" class="muted-text">搜索中…</p>
            <p v-else-if="upResult && upResult.users.length === 0" class="card empty">
              没有找到相关 UP 主，换个名字试试。
            </p>
            <p v-else-if="!upResult" class="card empty">
              输入 UP 主名字开始搜索，点进去就能看 TA 发布的视频和评论。
            </p>
          </div>

          <section v-if="upResult && upResult.totalPages > 1" class="card pager">
            <button
              class="btn btn-ghost"
              :disabled="upSearching || upResult.page <= 1"
              @click="gotoUpSearch(upResult.page - 1)"
            >
              上一页
            </button>
            <span class="pager-text">第</span>
            <input
              v-model.number="upJump"
              class="input page-input"
              type="number"
              min="1"
              :max="upResult.totalPages"
            />
            <span class="pager-text">/ {{ upResult.totalPages }} 页</span>
            <button class="btn btn-ghost" :disabled="upSearching" @click="jumpUpSearch">
              跳转
            </button>
            <button
              class="btn btn-ghost"
              :disabled="upSearching || upResult.page >= upResult.totalPages"
              @click="gotoUpSearch(upResult.page + 1)"
            >
              下一页
            </button>
          </section>
        </template>
      </template>

      <template v-else>
      <section v-if="searchResult" class="card search-summary">
        <span>「{{ searchResult.keyword }}」共 {{ searchResult.total.toLocaleString() }} 个结果</span>
        <span>第 {{ searchResult.page }} / {{ searchResult.totalPages }} 页</span>
      </section>

      <div ref="searchScroll" class="scroll-area">
        <section v-if="searchResult && searchResult.videos.length > 0" class="result-list">
        <article
          v-for="v in searchResult.videos"
          :key="v.bvid"
          class="card result"
          @click="openVideo(v.bvid)"
        >
          <div class="r-head">
            <h3 class="r-title">
              <span v-for="(part, i) in v.titleParts" :key="i" :class="{ hl: part.hl }">
                {{ part.text }}
              </span>
            </h3>
            <HeatMeter
              :score="v.heatScore"
              :level="v.heatLevel"
              :label="v.heatLabel"
              :play="v.play"
              :like="v.like"
              :like-rate="v.likeRate"
            />
          </div>
          <div class="r-meta">
            <button
              v-if="v.author"
              class="r-author r-author-btn"
              title="搜索该 UP 主"
              @click.stop="searchUpByName(v.author)"
            >
              {{ v.author }}
            </button>
            <span>播放 {{ formatCount(v.play) }}</span>
            <span>评论 {{ formatCount(v.review) }}</span>
            <span>点赞 {{ formatCount(v.like) }}</span>
            <span>{{ formatDate(v.pubdate) }}</span>
            <span class="r-bv">{{ v.bvid }}</span>
          </div>
          <div class="r-tags">
            <span v-if="v.typename" class="tag">{{ v.typename }}</span>
            <span v-for="tag in v.tags.slice(0, 4)" :key="tag" class="tag">{{ tag }}</span>
            <span class="r-look">看评论 →</span>
          </div>
        </article>
      </section>

        <p v-if="searching" class="muted-text">搜索中…</p>
        <p v-else-if="searchResult && searchResult.videos.length === 0" class="card empty">
          没有找到相关视频，换个关键词试试。
        </p>
      </div>

      <section v-if="searchResult && searchResult.totalPages > 1" class="card pager">
        <button
          class="btn btn-ghost"
          :disabled="searching || searchPage <= 1"
          @click="gotoSearch(searchPage - 1)"
        >
          上一页
        </button>
        <span class="pager-text">第</span>
        <input
          v-model.number="searchJump"
          class="input page-input"
          type="number"
          min="1"
          :max="searchResult.totalPages"
        />
        <span class="pager-text">/ {{ searchResult.totalPages }} 页</span>
        <button class="btn btn-ghost" :disabled="searching" @click="jumpSearch">跳转</button>
        <button
          class="btn btn-ghost"
          :disabled="searching || searchPage >= searchResult.totalPages"
          @click="gotoSearch(searchPage + 1)"
        >
          下一页
        </button>
      </section>
      </template>
    </template>

    <template v-else>
      <section v-if="result" class="card video-card">
        <div class="video-main">
          <button class="back-btn" @click="backToSearch">
            {{ returnTo === 'up' ? '← 返回UP主投稿' : '← 返回搜索' }}
          </button>
          <h3 class="video-title">{{ result.video.title }}</h3>
          <div class="video-meta">
            <span class="badge">{{ result.video.bvid }}</span>
            <span>
              UP：
              <a :href="spaceUrl(result.video.ownerMid)" target="_blank" rel="noreferrer">
                {{ result.video.ownerName }}
              </a>
            </span>
            <span>评论 {{ result.total.toLocaleString() }} 条（含回复）</span>
            <span>已显示 {{ rows.length }} 条</span>
          </div>
        </div>
        <div class="video-side">
          <div class="sort-switch">
            <button
              class="sort-btn"
              :class="{ active: sort === 'hot' }"
              :disabled="loading || loadingMore"
              @click="changeSort('hot')"
            >
              热门
            </button>
            <button
              class="sort-btn"
              :class="{ active: sort === 'latest' }"
              :disabled="loading || loadingMore"
              @click="changeSort('latest')"
            >
              最新
            </button>
          </div>
          <div class="sort-switch">
            <button
              class="sort-btn"
              :class="{ active: commentView === 'list' }"
              @click="setCommentView('list')"
            >
              列式
            </button>
            <button
              class="sort-btn"
              :class="{ active: commentView === 'grid' }"
              @click="setCommentView('grid')"
            >
              卡片
            </button>
          </div>
        </div>
      </section>

      <p v-if="loading && !result" class="muted-text">评论加载中…</p>
      <p v-if="error && activeBvid" class="err">{{ error }}</p>

      <div ref="commentScroll" class="scroll-area" @scroll="onCommentScroll">
        <section v-if="result" class="compose-card card">
          <button type="button" class="compose-trigger" @click="openTopComposer">
            {{
              biliAccount && !biliAccount.expired
                ? '发一条友善的评论…'
                : '绑定 B 站账号后可点赞、回复'
            }}
          </button>
          <span v-if="biliAccount && !biliAccount.expired" class="compose-as">
            以 {{ biliAccount.uname || biliAccount.mid }} 身份
          </span>
        </section>

        <section
          v-if="result && rows.length > 0"
          :class="commentView === 'grid' ? 'comment-grid' : 'comment-list'"
        >
        <article v-for="(c, i) in rows" :key="c.rpid" class="card comment">
          <header class="c-head">
            <div class="c-user">
              <a class="c-name" :href="spaceUrl(c.mid)" target="_blank" rel="noreferrer">
                {{ c.uname }}
              </a>
              <span v-if="c.isUp" class="up-badge">UP主</span>
              <a class="c-uid" :href="spaceUrl(c.mid)" target="_blank" rel="noreferrer">
                UID {{ c.mid }}
              </a>
            </div>
            <span class="c-time">{{ formatTime(c.ctime) }}</span>
          </header>

          <p class="c-body">
            <span class="c-text">{{ c.message }}</span>
            <span v-for="n in c.pictureCount" :key="n" class="pic-tag">[图片]</span>
          </p>

          <footer class="c-foot">
            <span class="c-index">#{{ i + 1 }}</span>
            <button
              class="c-act"
              :class="{ active: c.liked }"
              type="button"
              :disabled="c.likePending"
              @click="toggleLike(c)"
            >
              赞{{ c.like > 0 ? ` ${c.like}` : '' }}
            </button>
            <button class="c-act" type="button" @click="openRootReply(c)">回复</button>
            <button v-if="c.replyCount > 0" class="reply-toggle" @click="toggleSub(c)">
              {{ c.sub?.open ? '收起回复' : `共 ${c.replyCount} 条回复` }}
            </button>
            <button v-if="c.replyCount > 0" class="reply-toggle" @click="openRootThread(c)">
              关系图
            </button>
          </footer>

          <div v-if="c.sub && c.sub.open" class="sub-panel">
            <p v-if="c.sub.loading" class="sub-loading">加载中…</p>
            <p v-else-if="c.sub.error" class="sub-loading err">{{ c.sub.error }}</p>

            <div :ref="(el) => setSubScroll(c.rpid, el)" class="sub-scroll">
              <SubReplyItem
                v-for="s in c.sub.comments"
                :key="s.rpid"
                :comment="s"
                @open-thread="(sub) => openThread(c, sub)"
                @like="toggleLike"
                @reply="(sub) => openSubReply(c, sub)"
              />
            </div>

            <div v-if="c.sub.totalPages > 1" class="sub-pager">
              <button
                class="btn btn-ghost btn-sm"
                :disabled="c.sub.loading || c.sub.page <= 1"
                @click="loadSub(c, c.sub.page - 1)"
              >
                上一页
              </button>
              <span class="sub-page-text">
                第 {{ c.sub.page }} / {{ c.sub.totalPages }} 页（共 {{ c.sub.total }} 条）
              </span>
              <button
                class="btn btn-ghost btn-sm"
                :disabled="c.sub.loading || c.sub.page >= c.sub.totalPages"
                @click="loadSub(c, c.sub.page + 1)"
              >
                下一页
              </button>
            </div>
          </div>
        </article>
      </section>

      <section v-if="result && rows.length === 0 && !loading" class="card empty">
        这个视频暂时没有可显示的评论，可能评论已关闭。
      </section>

      <div v-if="result && rows.length > 0" class="load-more">
        <span v-if="loadingMore" class="muted-text">加载更多评论…</span>
        <button v-else-if="error" class="btn btn-ghost btn-sm" @click="retryMore">
          加载失败，点击重试
        </button>
        <span v-else-if="!hasMore" class="muted-text">没有更多评论了</span>
      </div>
      </div>

    </template>

    <BiliLoginModal
      :open="biliLoginOpen"
      @close="biliLoginOpen = false"
      @bound="onBiliBound"
    />

    <ThreadGraphModal
      :open="threadOpen"
      :input="activeBvid || input"
      :root-rpid="threadRoot"
      :target-rpid="threadTarget"
      :root-comment="threadRootComment"
      :video-title="result?.video.title"
      :video-bvid="result?.video.bvid || activeBvid || input"
      @close="threadOpen = false"
    />

    <BiliReplyModal
      :open="replyTarget !== null"
      :title="replyTitle"
      :target="replyTarget?.mode === 'reply' ? replyTarget.uname : ''"
      :submitting="replySubmitting"
      :error="replyError"
      @close="closeReply"
      @submit="submitReply"
    />

    <div v-if="toast" class="bili-toast">{{ toast }}</div>
  </AppLayout>
</template>

<style scoped>
.panel {
  padding: 18px;
  flex-shrink: 0;
}

.tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius);
  background: var(--surface-2);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.bili-account {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.bili-name.expired {
  color: var(--danger);
}

.bili-name em {
  margin-left: 4px;
  font-style: normal;
  color: var(--danger);
}

.link-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.inline-err {
  margin: 0;
  font-size: 12px;
}

.tab {
  padding: 5px 14px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.tab.active {
  background: var(--surface);
  color: var(--text);
  font-weight: 500;
}

.search {
  display: flex;
  gap: 10px;
}

.search .input {
  flex: 1;
  min-width: 0;
  width: auto;
}

.search .btn {
  flex-shrink: 0;
  white-space: nowrap;
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

.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.err {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--danger);
}

.search-summary {
  flex-shrink: 0;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--text-muted);
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result {
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.result:hover {
  border-color: var(--primary);
}

.r-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.r-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
  word-break: break-word;
}

.hl {
  color: var(--primary);
}

.r-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.r-author {
  color: var(--text);
}

.r-author-btn {
  padding: 0;
  border: none;
  background: transparent;
  font-size: inherit;
  color: var(--primary);
  cursor: pointer;
}

.r-author-btn:hover {
  text-decoration: underline;
}

.r-bv {
  font-family: var(--mono);
  font-size: 11px;
}

.r-tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.tag {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
}

.r-look {
  margin-left: auto;
  font-size: 12px;
  color: var(--primary);
}

.video-card {
  flex-shrink: 0;
  padding: 16px 18px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.video-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.video-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 6px 0 8px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.back-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.back-btn:hover {
  color: var(--primary);
}

.video-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.video-meta a {
  color: var(--primary);
  text-decoration: none;
}

.up-summary {
  flex-shrink: 0;
  padding: 16px 18px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.up-main {
  min-width: 0;
}

.up-name {
  margin: 6px 0 8px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  word-break: break-word;
}

.up-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.up-sign {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  word-break: break-word;
}

.up-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.limit-note {
  font-size: 11px;
  color: var(--text-muted);
}

.err-text {
  color: var(--danger);
}

.badge {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
}

.sort-switch {
  flex-shrink: 0;
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: var(--radius);
  background: var(--surface-2);
}

.sort-btn {
  padding: 5px 14px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.sort-btn.active {
  background: var(--surface);
  color: var(--text);
  font-weight: 500;
}

.sort-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.compose-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  flex-shrink: 0;
}

.compose-trigger {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 13px;
  text-align: left;
  cursor: text;
}

.compose-trigger:hover {
  border-color: var(--primary);
  color: var(--text);
}

.compose-as {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.comment-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 卡片视图：CSS 多列实现瀑布流，卡片高度随内容、不拆列 */
.comment-grid {
  column-count: 3;
  column-gap: 12px;
}

.comment-grid > .comment {
  display: inline-block;
  width: 100%;
  margin: 0 0 12px;
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
}

.comment-grid .c-text {
  overflow-wrap: anywhere;
}

.comment {
  padding: 14px 16px;
}

.c-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.c-user,
.sub-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.c-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
}

.c-name:hover {
  color: var(--primary);
}

.c-uid {
  font-size: 11px;
  color: var(--text-muted);
  text-decoration: none;
}

.c-uid:hover {
  color: var(--primary);
}

.up-badge {
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: rgba(79, 70, 229, 0.12);
  color: var(--primary);
  font-size: 11px;
}

.c-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.c-body {
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.pic-tag {
  margin-left: 4px;
  color: var(--primary);
  font-size: 13px;
}

.c-foot {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.c-act {
  padding: 2px 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}

.c-act:hover:not(:disabled) {
  border-color: var(--border);
  color: var(--primary);
}

.c-act.active {
  border-color: rgba(79, 70, 229, 0.35);
  background: rgba(79, 70, 229, 0.1);
  color: var(--primary);
}

.c-act:disabled {
  opacity: 0.6;
  cursor: default;
}

.reply-toggle {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
}

.reply-toggle:hover {
  text-decoration: underline;
}

.sub-panel {
  margin-top: 12px;
  padding: 8px 12px 10px;
  border-left: 2px solid var(--border);
  background: var(--surface-2);
  border-radius: 0 var(--radius) var(--radius) 0;
  display: flex;
  flex-direction: column;
}

.sub-loading {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.sub-scroll {
  max-height: 280px;
  min-height: 120px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
}

.sub-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.sub-pager .btn-sm {
  align-self: center;
}

.sub-page-text {
  font-size: 11px;
  color: var(--text-muted);
}

.btn-sm {
  align-self: flex-start;
  padding: 5px 10px;
  font-size: 12px;
}

.empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.pager {
  flex-shrink: 0;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
}

.pager-text {
  font-size: 13px;
  color: var(--text-muted);
}

.page-input {
  width: 80px;
  padding: 6px 8px;
  text-align: center;
}

.muted-text {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.load-more {
  flex-shrink: 0;
  min-height: 24px;
  padding: 4px 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 1280px) {
  .comment-grid {
    column-count: 2;
  }
}

@media (max-width: 860px) {
  .comment-grid {
    column-count: 1;
  }
}

@media (max-width: 720px) {
  .panel-head {
    align-items: flex-start;
  }

  .video-card {
    flex-direction: column;
  }

  .video-side {
    align-items: flex-start;
  }

  .up-summary {
    flex-direction: column;
  }

  .up-side {
    align-items: flex-start;
  }

  .search {
    flex-direction: column;
  }

  .search .input {
    width: 100%;
    flex: none;
  }

  .search .btn {
    width: 100%;
  }
}

.bili-toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  z-index: 240;
  max-width: min(420px, calc(100vw - 40px));
  padding: 9px 16px;
  border-radius: var(--radius);
  background: rgba(15, 23, 42, 0.9);
  color: #f8fafc;
  font-size: 13px;
  line-height: 1.5;
  transform: translateX(-50%);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.25);
}
</style>
