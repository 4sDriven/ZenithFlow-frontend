<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, apiFetch } from '../lib/api'
import {
  estimateThreadGraphImageSize,
  renderThreadGraphPng,
  type GraphExportOptions,
  type GraphExportTheme,
} from '../lib/thread-graph-export'

type ReplyTo = { mid: string; uname: string } | null

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
  replyTo: ReplyTo
}

type ThreadNode = Comment & {
  parentRpid: string
  rootRpid: string
  deleted?: boolean
  isMore?: boolean
  moreCount?: number
}

type ThreadResponse = {
  ok: boolean
  rootRpid: string
  targetRpid: string
  nodes: ThreadNode[]
  total: number
  truncated: boolean
}

type Mode = 'focus' | 'branch' | 'all'

type PositionedNode = {
  node: ThreadNode
  x: number
  y: number
  w: number
  h: number
  depth: number
}

type GraphEdge = {
  from: PositionedNode
  to: PositionedNode
}

const props = defineProps<{
  open: boolean
  input: string
  rootRpid: string
  targetRpid: string
  rootComment?: Comment | null
  videoTitle?: string
  videoBvid?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const CARD_W = 224
const CARD_H = 112
const GAP_X = 28
const GAP_Y = 56
const PADDING = 28
const FANOUT_LIMIT = 8
const MIN_SCALE = 0.08
const MAX_SCALE = 1.6

const MODE_LABELS: Record<Mode, string> = {
  focus: '只看相关',
  branch: '含同层',
  all: '整楼',
}

const USER_COLORS = [
  '#4f46e5',
  '#0284c7',
  '#0d9488',
  '#16a34a',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#475569',
  '#65a30d',
  '#0891b2',
]

const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const data = ref<ThreadResponse | null>(null)
const currentLimit = ref(200)
const currentTarget = ref('')
const selectedRpid = ref('')
const history = ref<string[]>([])
const mode = ref<Mode>('focus')
const activeMid = ref('')
const activeBranch = ref('')
const expandedFanouts = ref<Set<string>>(new Set())
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const dragging = ref(false)
const hoveredRpid = ref('')
const viewport = ref<HTMLElement | null>(null)
const exporting = ref(false)
const exportNotice = ref('')
const exportNoticeKind = ref<'ok' | 'warn' | 'error'>('ok')

let exportNoticeTimer: ReturnType<typeof setTimeout> | null = null

let controller: AbortController | null = null
let dragStart = { x: 0, y: 0, panX: 0, panY: 0 }
let dragPointerId = -1
let dragMoved = false
let suppressClick = false

function stopDrag() {
  if (!dragging.value) return
  dragging.value = false
  dragPointerId = -1
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
}

function close() {
  stopDrag()
  emit('close')
}

function hashMid(mid: string): number {
  let hash = 0
  for (let i = 0; i < mid.length; i += 1) {
    hash = (hash * 31 + mid.charCodeAt(i)) >>> 0
  }
  return hash
}

function userColor(mid: string): string {
  if (!mid) return '#94a3b8'
  return USER_COLORS[hashMid(mid) % USER_COLORS.length] ?? '#94a3b8'
}

function initial(node: ThreadNode): string {
  if (node.isMore) return '+'
  if (node.deleted) return '删'
  return (node.uname || '?').charAt(0).toUpperCase()
}

function formatTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatFullTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0 分钟'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  const days = Math.floor(hours / 24)
  return `${days} 天 ${hours % 24} 小时`
}

const nodes = computed(() => data.value?.nodes ?? [])

const allNodes = computed<ThreadNode[]>(() => {
  const list = nodes.value
  if (!list.length) return []
  const root = data.value?.rootRpid ?? ''
  const ids = new Set(list.map((node) => node.rpid))
  const missing = new Map<string, string>()

  for (const node of list) {
    if (
      node.parentRpid &&
      node.parentRpid !== '0' &&
      node.parentRpid !== node.rpid &&
      node.parentRpid !== root &&
      !ids.has(node.parentRpid)
    ) {
      missing.set(node.parentRpid, root)
    }
  }

  const ghosts: ThreadNode[] = []
  for (const [rpid, rootRpid] of missing) {
    ghosts.push({
      rpid,
      parentRpid: rootRpid,
      rootRpid,
      mid: '',
      uname: '评论已删除',
      message: '该评论已删除或不可见',
      pictureCount: 0,
      like: 0,
      ctime: 0,
      replyCount: 0,
      isUp: false,
      replyTo: null,
      deleted: true,
    })
  }

  return [...list, ...ghosts]
})

const byId = computed(() => {
  const map = new Map<string, ThreadNode>()
  for (const node of allNodes.value) map.set(node.rpid, node)
  return map
})

const childrenMap = computed(() => {
  const map = new Map<string, string[]>()
  for (const node of allNodes.value) {
    if (!node.parentRpid || node.parentRpid === '0' || node.parentRpid === node.rpid) {
      continue
    }
    if (!byId.value.has(node.parentRpid)) continue
    const list = map.get(node.parentRpid) ?? []
    list.push(node.rpid)
    map.set(node.parentRpid, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const left = byId.value.get(a)
      const right = byId.value.get(b)
      return (left?.ctime ?? 0) - (right?.ctime ?? 0)
    })
  }
  return map
})

const rootNode = computed(() => {
  const root = data.value?.rootRpid
  return root ? byId.value.get(root) ?? null : null
})

const currentNode = computed(() => {
  const id = currentTarget.value
  return id ? byId.value.get(id) ?? null : null
})

const selectedNode = computed(() => {
  const id = selectedRpid.value
  return id ? byId.value.get(id) ?? null : null
})

function ancestorsOf(id: string): Set<string> {
  const result = new Set<string>()
  let current = byId.value.get(id)
  let guard = 0
  while (current && guard < 200) {
    result.add(current.rpid)
    if (
      current.parentRpid === '0' ||
      current.parentRpid === current.rpid ||
      current.rpid === data.value?.rootRpid
    ) {
      break
    }
    current = byId.value.get(current.parentRpid)
    guard += 1
  }
  return result
}

function collectSubtree(id: string, allowed?: Set<string>): Set<string> {
  const result = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()
    if (!current || result.has(current)) continue
    if (allowed && !allowed.has(current)) continue
    result.add(current)
    for (const child of childrenMap.value.get(current) ?? []) {
      if (!allowed || allowed.has(child)) stack.push(child)
    }
  }
  return result
}

const ancestorIds = computed(() => (currentTarget.value ? ancestorsOf(currentTarget.value) : new Set<string>()))

const focusIds = computed(() => {
  if (!currentTarget.value) return new Set<string>()
  return new Set([...ancestorIds.value, ...collectSubtree(currentTarget.value)])
})

const canBranch = computed(() => {
  const node = currentNode.value
  return Boolean(node && node.rpid !== data.value?.rootRpid && node.parentRpid !== data.value?.rootRpid)
})

const branchIds = computed(() => {
  const node = currentNode.value
  const result = new Set(focusIds.value)
  if (!node || !canBranch.value) return result
  const parent = byId.value.get(node.parentRpid)
  if (!parent) return result
  for (const sibling of childrenMap.value.get(parent.rpid) ?? []) {
    for (const child of collectSubtree(sibling)) result.add(child)
  }
  return result
})

const allIds = computed(() => new Set(allNodes.value.map((node) => node.rpid)))

const baseIds = computed(() => {
  if (mode.value === 'all') return allIds.value
  if (mode.value === 'branch') return branchIds.value
  return focusIds.value
})

const focusNodes = computed(() => {
  return [...focusIds.value]
    .map((id) => byId.value.get(id))
    .filter((node): node is ThreadNode => Boolean(node))
})

const focusStats = computed(() => {
  const list = focusNodes.value.filter((node) => !node.deleted)
  const participants = new Set(list.map((node) => node.mid).filter(Boolean))
  const times = list.map((node) => node.ctime).filter((ctime) => ctime > 0)
  const depths = list.map((node) => depthOf(node.rpid))
  return {
    count: list.length,
    participants: participants.size,
    maxDepth: depths.length ? Math.max(...depths) : 0,
    first: times.length ? Math.min(...times) : 0,
    last: times.length ? Math.max(...times) : 0,
    span: times.length ? formatDuration((Math.max(...times) - Math.min(...times)) * 1000) : '—',
  }
})

function depthOf(id: string): number {
  let depth = 0
  let current = byId.value.get(id)
  let guard = 0
  while (current && guard < 200) {
    if (current.parentRpid === '0' || current.parentRpid === current.rpid) break
    depth += 1
    current = byId.value.get(current.parentRpid)
    guard += 1
  }
  return depth
}

const branchStats = computed(() => {
  const node = currentNode.value
  if (!node) return []
  const allowed = focusIds.value
  const list: Array<{
    id: string
    node: ThreadNode
    count: number
    participants: number
    latest: number
  }> = []

  for (const childId of childrenMap.value.get(node.rpid) ?? []) {
    if (!allowed.has(childId)) continue
    const child = byId.value.get(childId)
    if (!child || child.deleted) continue
    const subtree = collectSubtree(childId, allowed)
    const members = [...subtree]
      .map((id) => byId.value.get(id))
      .filter((item): item is ThreadNode => Boolean(item && !item.deleted))
    if (!members.length) continue
    list.push({
      id: childId,
      node: child,
      count: members.length,
      participants: new Set(members.map((item) => item.mid).filter(Boolean)).size,
      latest: Math.max(...members.map((item) => item.ctime)),
    })
  }

  return list.sort((a, b) => b.count - a.count || b.latest - a.latest)
})

const timeline = computed(() => {
  const list = focusNodes.value.filter((node) => !node.deleted && node.ctime > 0)
  if (!list.length) return []
  const min = Math.min(...list.map((node) => node.ctime))
  const max = Math.max(...list.map((node) => node.ctime))
  if (min === max) {
    return [{ count: list.length, start: min, end: max }]
  }
  const bucketCount = 12
  const span = max - min
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    count: 0,
    start: min + (span * index) / bucketCount,
    end: min + (span * (index + 1)) / bucketCount,
  }))
  for (const node of list) {
    const index = Math.min(bucketCount - 1, Math.floor(((node.ctime - min) / span) * bucketCount))
    const bucket = buckets[index]
    if (bucket) bucket.count += 1
  }
  return buckets
})

const timelineMax = computed(() => Math.max(1, ...timeline.value.map((bucket) => bucket.count)))

const latestNode = computed(() => {
  const list = focusNodes.value.filter((node) => !node.deleted && node.ctime > 0)
  if (!list.length) return null
  return list.reduce((latest, node) => (node.ctime > latest.ctime ? node : latest))
})

const hottestNode = computed(() => {
  const list = focusNodes.value.filter((node) => !node.deleted)
  if (!list.length) return null
  return list.reduce((hot, node) => (node.like > hot.like ? node : hot))
})

const highlightIds = computed(() => {
  if (activeMid.value) {
    return new Set(allNodes.value.filter((node) => node.mid === activeMid.value).map((node) => node.rpid))
  }
  if (activeBranch.value) {
    const ids = collectSubtree(activeBranch.value)
    ids.add(currentTarget.value)
    return ids
  }
  return null
})

function isDimmed(node: ThreadNode): boolean {
  const highlight = highlightIds.value
  if (!highlight) return false
  return !highlight.has(node.rpid)
}

const graph = computed(() => {
  const allowed = baseIds.value
  const root = data.value?.rootRpid ?? ''
  if (!allowed.size || !root || !byId.value.has(root)) {
    return { nodes: [] as PositionedNode[], edges: [] as GraphEdge[], width: 0, height: 0 }
  }

  const weights = new Map<string, number>()
  function weightOf(id: string, visiting = new Set<string>()): number {
    const cached = weights.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    let total = 1
    for (const child of childrenMap.value.get(id) ?? []) {
      if (allowed.has(child)) total += weightOf(child, visiting)
    }
    visiting.delete(id)
    weights.set(id, total)
    return total
  }

  const forcedPath = ancestorIds.value
  const layoutChildren = new Map<string, string[]>()
  const moreNodes = new Map<string, ThreadNode>()

  function chooseChildren(id: string): string[] {
    const children = (childrenMap.value.get(id) ?? []).filter((child) => allowed.has(child))
    if (!children.length) {
      layoutChildren.set(id, [])
      return []
    }

    const forced = children.filter((child) => forcedPath.has(child))
    const rest = children.filter((child) => !forcedPath.has(child))
    rest.sort((a, b) => {
      const weightDiff = weightOf(b) - weightOf(a)
      if (weightDiff !== 0) return weightDiff
      return (byId.value.get(a)?.ctime ?? 0) - (byId.value.get(b)?.ctime ?? 0)
    })

    let kept: string[]
    if (!expandedFanouts.value.has(id) && children.length > FANOUT_LIMIT) {
      const set = new Set(forced)
      for (const child of rest) {
        if (set.size >= FANOUT_LIMIT) break
        set.add(child)
      }
      kept = [...set]
      const hidden = children.filter((child) => !set.has(child))
      if (hidden.length) {
        const moreId = `__more__:${id}`
        moreNodes.set(moreId, {
          rpid: moreId,
          parentRpid: id,
          rootRpid: root,
          mid: '',
          uname: '更多回复',
          message: '点击展开隐藏的分支',
          pictureCount: 0,
          like: 0,
          ctime: 0,
          replyCount: hidden.length,
          isUp: false,
          replyTo: null,
          isMore: true,
          moreCount: hidden.length,
        })
        kept.push(moreId)
      }
    } else {
      kept = [...children]
    }

    kept.sort((a, b) => {
      if (a.startsWith('__more__:')) return 1
      if (b.startsWith('__more__:')) return -1
      return weightOf(b) - weightOf(a)
    })
    layoutChildren.set(id, kept)
    return kept
  }

  const visible = new Set<string>()
  const queue = [root]
  while (queue.length) {
    const id = queue.shift()
    if (!id || visible.has(id)) continue
    visible.add(id)
    for (const child of chooseChildren(id)) {
      if (child.startsWith('__more__:')) {
        visible.add(child)
      } else {
        queue.push(child)
      }
    }
  }

  const positions = new Map<string, { x: number; depth: number }>()
  let cursor = 0
  let maxDepth = 0

  function place(id: string, depth: number, visiting = new Set<string>()): number {
    if (visiting.has(id)) return 0
    visiting.add(id)
    if (depth > maxDepth) maxDepth = depth
    const children = layoutChildren.get(id) ?? []
    let center: number
    if (!children.length) {
      center = cursor
      cursor += 1
    } else {
      const centers = children.map((child) => place(child, depth + 1, visiting))
      center = ((centers[0] ?? 0) + (centers[centers.length - 1] ?? 0)) / 2
    }
    positions.set(id, { x: center, depth })
    visiting.delete(id)
    return center
  }

  place(root, 0)

  const positioned: PositionedNode[] = []
  for (const id of visible) {
    const position = positions.get(id)
    const node = id.startsWith('__more__:') ? moreNodes.get(id) : byId.value.get(id)
    if (!position || !node) continue
    positioned.push({
      node,
      x: PADDING + position.x * (CARD_W + GAP_X),
      y: PADDING + position.depth * (CARD_H + GAP_Y),
      w: CARD_W,
      h: CARD_H,
      depth: position.depth,
    })
  }

  const byPosition = new Map(positioned.map((item) => [item.node.rpid, item]))
  const edges: GraphEdge[] = []
  for (const id of visible) {
    const from = byPosition.get(id)
    if (!from) continue
    for (const child of layoutChildren.get(id) ?? []) {
      const to = byPosition.get(child)
      if (to) edges.push({ from, to })
    }
  }

  const columns = Math.max(1, cursor)
  return {
    nodes: positioned,
    edges,
    width: PADDING * 2 + columns * (CARD_W + GAP_X) - GAP_X,
    height: PADDING * 2 + (maxDepth + 1) * (CARD_H + GAP_Y) - GAP_Y,
  }
})

const participantStats = computed(() => {
  const map = new Map<string, { mid: string; uname: string; count: number }>()
  for (const item of graph.value.nodes) {
    const node = item.node
    if (!node.mid || node.deleted || node.isMore) continue
    const existing = map.get(node.mid)
    if (existing) {
      existing.count += 1
      if (!existing.uname) existing.uname = node.uname
    } else {
      map.set(node.mid, { mid: node.mid, uname: node.uname, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.uname.localeCompare(b.uname))
})

const loadedReplies = computed(() => {
  if (!data.value) return 0
  return data.value.nodes.filter((node) => node.rpid !== data.value?.rootRpid).length
})

const canRetryMore = computed(
  () => Boolean(error.value) && error.value.includes('更靠后') && currentLimit.value < 800,
)

const compact = computed(() => scale.value < 0.55)
const tiny = computed(() => scale.value < 0.3)

function nodeClasses(node: ThreadNode) {
  return {
    target: node.rpid === currentTarget.value,
    ancestor: ancestorIds.value.has(node.rpid) && node.rpid !== currentTarget.value,
    selected: node.rpid === selectedRpid.value,
    dimmed: isDimmed(node),
    ghost: Boolean(node.deleted),
    more: Boolean(node.isMore),
    compact: compact.value,
    tiny: tiny.value,
  }
}

function nodeStyle(item: PositionedNode) {
  return {
    left: `${item.x}px`,
    top: `${item.y}px`,
    width: `${item.w}px`,
    height: `${item.h}px`,
    '--user-color': userColor(item.node.mid),
  }
}

function edgeStyle(edge: GraphEdge) {
  const fromX = edge.from.x + edge.from.w / 2
  const fromY = edge.from.y + edge.from.h
  const toX = edge.to.x + edge.to.w / 2
  const toY = edge.to.y
  const middle = (fromY + toY) / 2
  return {
    d: `M ${fromX} ${fromY} C ${fromX} ${middle}, ${toX} ${middle}, ${toX} ${toY}`,
  }
}

function isEdgeActive(edge: GraphEdge): boolean {
  const selected = selectedRpid.value
  const hovered = hoveredRpid.value
  if (!selected && !hovered) return false
  const id = selected || hovered
  return edge.from.node.rpid === id || edge.to.node.rpid === id
}

async function fitGraph() {
  await nextTick()
  const el = viewport.value
  const g = graph.value
  if (!el || !g.width || !g.height) return
  const width = el.clientWidth
  const height = el.clientHeight
  if (!width || !height) return
  const nextScale = Math.max(
    MIN_SCALE,
    Math.min(MAX_SCALE, Math.min((width - 48) / g.width, (height - 48) / g.height)),
  )
  scale.value = nextScale
  panX.value = (width - g.width * nextScale) / 2
  panY.value = (height - g.height * nextScale) / 2
}

function centerOn(id: string, nextScale = Math.max(scale.value, 0.8)) {
  const el = viewport.value
  const item = graph.value.nodes.find((node) => node.node.rpid === id)
  if (!el || !item) return
  scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale))
  panX.value = el.clientWidth / 2 - (item.x + item.w / 2) * scale.value
  panY.value = el.clientHeight / 2 - (item.y + item.h / 2) * scale.value
}

function zoomAt(factor: number, x: number, y: number) {
  const previous = scale.value
  const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, previous * factor))
  if (next === previous) return
  panX.value = x - (x - panX.value) * (next / previous)
  panY.value = y - (y - panY.value) * (next / previous)
  scale.value = next
}

function zoomCenter(factor: number) {
  const el = viewport.value
  if (!el) return
  zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
}

function onWheel(event: WheelEvent) {
  const el = viewport.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || dragging.value) return
  suppressClick = false
  dragging.value = true
  dragMoved = false
  dragPointerId = event.pointerId
  dragStart = { x: event.clientX, y: event.clientY, panX: panX.value, panY: panY.value }
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
}

function onWindowPointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== dragPointerId) return
  const dx = event.clientX - dragStart.x
  const dy = event.clientY - dragStart.y
  if (!dragMoved && Math.hypot(dx, dy) > 3) dragMoved = true
  if (!dragMoved) return
  panX.value = dragStart.panX + dx
  panY.value = dragStart.panY + dy
}

function onWindowPointerUp(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== dragPointerId) return
  const moved = dragMoved
  stopDrag()
  if (!moved) return
  // 拖动结束后浏览器可能补发一次 click；拦掉它，避免拖动时误选节点。
  // 下一次 pointerdown 会重新清零，所以不会影响后续正常点击。
  suppressClick = true
}

function onNodeClick(node: ThreadNode) {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (node.isMore) {
    expandFanout(node.parentRpid)
    return
  }
  selectedRpid.value = node.rpid
}

function expandFanout(parentId: string) {
  const next = new Set(expandedFanouts.value)
  next.add(parentId)
  expandedFanouts.value = next
  void nextTick(() => centerOn(parentId))
}

function recenter(id: string) {
  if (!id || id === currentTarget.value) return
  const node = byId.value.get(id)
  if (!node || node.deleted || node.isMore) return
  history.value = [...history.value, currentTarget.value]
  currentTarget.value = id
  selectedRpid.value = id
  mode.value = 'focus'
  activeMid.value = ''
  activeBranch.value = ''
  expandedFanouts.value = new Set()
  void fitGraph()
}

function back() {
  const previous = history.value[history.value.length - 1]
  if (!previous) return
  history.value = history.value.slice(0, -1)
  currentTarget.value = previous
  selectedRpid.value = previous
  mode.value = 'focus'
  activeMid.value = ''
  activeBranch.value = ''
  expandedFanouts.value = new Set()
  void fitGraph()
}

function goOriginal() {
  const original = data.value?.targetRpid ?? props.targetRpid
  if (!original) return
  currentTarget.value = original
  selectedRpid.value = original
  history.value = []
  mode.value = 'focus'
  activeMid.value = ''
  activeBranch.value = ''
  expandedFanouts.value = new Set()
  void fitGraph()
}

function setMode(nextMode: Mode) {
  if (nextMode === 'branch' && !canBranch.value) return
  mode.value = nextMode
  activeMid.value = ''
  activeBranch.value = ''
  void fitGraph()
}

function toggleParticipant(mid: string) {
  activeMid.value = activeMid.value === mid ? '' : mid
  activeBranch.value = ''
}

function toggleBranch(id: string) {
  activeBranch.value = activeBranch.value === id ? '' : id
  activeMid.value = ''
  if (activeBranch.value && !graph.value.nodes.some((item) => item.node.rpid === id)) {
    expandFanout(currentTarget.value)
  }
}

function selectNode(node: ThreadNode | null) {
  if (!node) return
  selectedRpid.value = node.rpid
}

function applyRootFallback() {
  const response = data.value
  const fallback = props.rootComment
  if (!response || !fallback) return
  const root = response.nodes.find((node) => node.rpid === response.rootRpid)
  if (!root) return
  if (!root.uname) root.uname = fallback.uname
  if (!root.mid) root.mid = fallback.mid
  if (!root.message || root.message === '主评论') root.message = fallback.message
  if (!root.ctime) root.ctime = fallback.ctime
  if (!root.like) root.like = fallback.like
  if (!root.replyCount) root.replyCount = fallback.replyCount
  if (!root.isUp) root.isUp = fallback.isUp
}

async function loadThread(limit: number, preserve = false) {
  if (!props.open || !props.input || !props.rootRpid || !props.targetRpid) return
  controller?.abort()
  controller = new AbortController()

  if (preserve) {
    loadingMore.value = true
  } else {
    loading.value = true
    error.value = ''
    data.value = null
    currentLimit.value = limit
  }

  try {
    const params = new URLSearchParams({
      input: props.input,
      root: props.rootRpid,
      rpid: props.targetRpid,
      limit: String(limit),
    })
    const response = await apiFetch<ThreadResponse>(`/bili/thread?${params.toString()}`, {
      signal: controller.signal,
    })
    data.value = response
    currentLimit.value = limit
    applyRootFallback()

    if (!preserve) {
      currentTarget.value = response.targetRpid
      selectedRpid.value = response.targetRpid
      history.value = []
      mode.value = 'focus'
      activeMid.value = ''
      activeBranch.value = ''
      expandedFanouts.value = new Set()
      await nextTick()
      await fitGraph()
    } else if (!response.nodes.some((node) => node.rpid === currentTarget.value)) {
      currentTarget.value = response.targetRpid
      selectedRpid.value = response.targetRpid
      history.value = []
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    error.value = err instanceof ApiError ? err.message : '获取讨论关系失败，请稍后再试'
    if (!preserve) data.value = null
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  if (!data.value || loadingMore.value) return
  const next = Math.min(800, currentLimit.value + 200)
  if (next === currentLimit.value) return
  void loadThread(next, true)
}

function retryMore() {
  if (loading.value || currentLimit.value >= 800) return
  void loadThread(Math.min(800, currentLimit.value + 200))
}

function setExportNotice(text: string, kind: 'ok' | 'warn' | 'error' = 'ok') {
  exportNotice.value = text
  exportNoticeKind.value = kind
  if (exportNoticeTimer) clearTimeout(exportNoticeTimer)
  exportNoticeTimer = setTimeout(
    () => {
      exportNotice.value = ''
      exportNoticeTimer = null
    },
    kind === 'ok' ? 6000 : 12000,
  )
}

function readExportTheme(el: HTMLElement): GraphExportTheme {
  const style = getComputedStyle(el)
  const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    surface: value('--surface', '#ffffff'),
    surface2: value('--surface-2', '#f1f5f9'),
    border: value('--border', '#e2e8f0'),
    text: value('--text', '#0f172a'),
    muted: value('--text-muted', '#64748b'),
    primary: value('--primary', '#4f46e5'),
    radius: Number.parseFloat(value('--radius', '6px')) || 6,
    fontFamily: style.fontFamily,
    dark: document.documentElement.dataset.theme === 'dark',
  }
}

function buildExportFileName(): string {
  const raw = props.input || 'bili'
  const clean =
    raw
      .replace(/[^\w-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(-40) || 'bili'
  return `bili-thread-${clean}-${currentTarget.value || 'root'}.png`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

async function exportGraphImage() {
  const current = graph.value
  const el = viewport.value
  if (exporting.value || !current.nodes.length || !el) return

  const stats = focusStats.value
  const options: GraphExportOptions = {
    nodes: current.nodes.map((item) => ({
      rpid: item.node.rpid,
      mid: item.node.mid,
      uname: item.node.uname,
      message: item.node.message,
      ctime: item.node.ctime,
      like: item.node.like,
      replyCount: item.node.replyCount,
      isUp: item.node.isUp,
      deleted: Boolean(item.node.deleted),
      isMore: Boolean(item.node.isMore),
      moreCount: item.node.moreCount ?? 0,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    })),
    edges: current.edges.map((edge) => ({
      from: { x: edge.from.x, y: edge.from.y, w: edge.from.w, h: edge.from.h },
      to: { x: edge.to.x, y: edge.to.y, w: edge.to.w, h: edge.to.h },
      fromRpid: edge.from.node.rpid,
      toRpid: edge.to.node.rpid,
    })),
    width: current.width,
    height: current.height,
    title: '讨论关系',
    subtitle: `主评论 ${rootNode.value?.uname || '未知'} · 子评论 ${
      data.value?.total ?? 0
    } 条 · 图中 ${current.nodes.length} 个节点`,
    detail: `焦点 @${currentNode.value?.uname || '未知'} · ${
      MODE_LABELS[mode.value]
    } · ${stats.participants} 人参与 · 最大 ${stats.maxDepth} 层 · 跨度 ${stats.span}`,
    videoTitle: props.videoTitle,
    videoBvid: props.videoBvid,
    footerLeft: 'ZenithFlow · B站讨论关系 · 节点背景色代表不同用户',
    footerRight: `导出于 ${formatFullTime(Math.floor(Date.now() / 1000))}`,
    theme: readExportTheme(el),
    colorOf: userColor,
    dimmed: new Set(
      current.nodes.filter((item) => isDimmed(item.node)).map((item) => item.node.rpid),
    ),
    selected: selectedRpid.value,
    target: currentTarget.value,
    ancestors: ancestorIds.value,
  }

  const estimate = estimateThreadGraphImageSize(options)
  if (estimate.scale < 0.6) {
    const ok = window.confirm(
      `当前关系图太大，导出后约 ${estimate.width}×${estimate.height} 像素，文字会明显偏小。\n` +
        '建议先切回「只看相关」，或点某条评论的「以它为中心」缩小范围再导出。\n\n仍然继续导出吗？',
    )
    if (!ok) return
  }

  exporting.value = true
  exportNotice.value = ''
  try {
    // 先让「生成中…」渲染出来，再做同步绘制，避免点击后界面像卡死。
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const image = await renderThreadGraphPng(options)

    downloadBlob(image.blob, buildExportFileName())
    const size = `${image.width}×${image.height}`
    if (image.scale < 0.6) {
      setExportNotice(
        `已导出 ${size}，但图太大已缩小，文字可能偏小；建议先切换焦点或模式缩小范围`,
        'warn',
      )
    } else if (image.scale < 1) {
      setExportNotice(`已导出 ${size}（图较大，倍率 ${image.scale.toFixed(2)}x）`, 'warn')
    } else {
      setExportNotice(
        `已导出 ${size} 高清 PNG（${(image.blob.size / 1024 / 1024).toFixed(1)} MB）`,
      )
    }
  } catch (err) {
    setExportNotice(err instanceof Error ? err.message : '导出失败，请稍后再试', 'error')
  } finally {
    exporting.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(
  () => [props.open, props.input, props.rootRpid, props.targetRpid] as const,
  ([open, input, root, target], previous) => {
    if (!open) {
      stopDrag()
      controller?.abort()
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
      return
    }
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
    if (!input || !root || !target) return
    if (
      previous &&
      previous[0] === open &&
      previous[1] === input &&
      previous[2] === root &&
      previous[3] === target
    ) {
      return
    }
    void loadThread(200)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopDrag()
  controller?.abort()
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
  if (exportNoticeTimer) clearTimeout(exportNoticeTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay">
      <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="thread-title">
        <header class="dialog-head">
          <div class="title-wrap">
            <h3 id="thread-title">讨论关系</h3>
            <p class="dialog-sub">
              主评论 {{ rootNode?.uname || '未知' }} · 子评论 {{ data?.total ?? 0 }} 条
              <span v-if="data">· 图中 {{ graph.nodes.length }} 个节点</span>
            </p>
          </div>
          <button class="close-btn" type="button" title="关闭" @click="close">×</button>
        </header>

        <div class="toolbar">
          <div class="modes">
            <button
              type="button"
              class="tool-btn"
              :class="{ active: mode === 'focus' }"
              @click="setMode('focus')"
            >
              只看相关
            </button>
            <button
              type="button"
              class="tool-btn"
              :class="{ active: mode === 'branch' }"
              :disabled="!canBranch"
              :title="canBranch ? '' : '当前评论的同层就是整楼'"
              @click="setMode('branch')"
            >
              含同层
            </button>
            <button
              type="button"
              class="tool-btn"
              :class="{ active: mode === 'all' }"
              @click="setMode('all')"
            >
              整楼
            </button>
          </div>

          <div class="toolbar-right">
            <span class="legend"><i class="legend-dot" />背景色 = 用户</span>
            <button v-if="history.length" type="button" class="tool-btn" @click="back">
              返回上一焦点
            </button>
            <button type="button" class="tool-btn" @click="goOriginal">回到 A</button>
            <span v-if="exportNotice" class="export-notice" :class="exportNoticeKind">
              {{ exportNotice }}
            </span>
            <button
              type="button"
              class="tool-btn export-btn"
              :disabled="exporting || !graph.nodes.length"
              title="把当前关系图导出为高清 PNG（会按当前焦点/模式/筛选绘制）"
              @click="exportGraphImage"
            >
              {{ exporting ? '生成中…' : '导出图片' }}
            </button>
            <div class="zoom-controls">
              <button type="button" class="zoom-btn" title="缩小" @click="zoomCenter(1 / 1.2)">
                −
              </button>
              <button type="button" class="zoom-btn" title="适配窗口" @click="fitGraph">适配</button>
              <button type="button" class="zoom-btn" title="放大" @click="zoomCenter(1.2)">
                +
              </button>
            </div>
          </div>
        </div>

        <div v-if="error" class="error-state">
          <p class="err">{{ error }}</p>
          <button v-if="canRetryMore" type="button" class="tool-btn" @click="retryMore">
            继续加载更多（最多 800 条）
          </button>
          <button
            v-else-if="!data && !loading"
            type="button"
            class="tool-btn"
            @click="loadThread(200)"
          >
            重新加载
          </button>
        </div>

        <div v-if="loading" class="state">正在梳理回复关系…</div>
        <div v-else-if="data" class="dialog-body">
          <div class="graph-wrap">
            <div v-if="data.truncated" class="truncated">
              <span>已加载 {{ loadedReplies }} / 共 {{ data.total }} 条</span>
              <button
                v-if="currentLimit < 800"
                type="button"
                class="link-btn"
                :disabled="loadingMore"
                @click="loadMore"
              >
                {{ loadingMore ? '加载中…' : `继续加载 ${Math.min(200, 800 - currentLimit)} 条` }}
              </button>
              <span v-else class="muted">已达到 800 条上限</span>
            </div>

            <div
              ref="viewport"
              class="viewport"
              :class="{ dragging }"
              @pointerdown="onPointerDown"
              @wheel.prevent="onWheel"
            >
              <div
                class="canvas"
                :style="{
                  width: `${graph.width}px`,
                  height: `${graph.height}px`,
                  transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                }"
              >
                <svg class="edges" :width="graph.width" :height="graph.height" aria-hidden="true">
                  <defs>
                    <marker
                      id="thread-arrow"
                      markerWidth="6"
                      markerHeight="6"
                      refX="5"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M 0 0 L 6 3 L 0 6 z" fill="currentColor" />
                    </marker>
                  </defs>
                  <path
                    v-for="edge in graph.edges"
                    :key="`${edge.from.node.rpid}-${edge.to.node.rpid}`"
                    class="edge"
                    :class="{ active: isEdgeActive(edge) }"
                    :d="edgeStyle(edge).d"
                    marker-end="url(#thread-arrow)"
                  />
                </svg>

                <div
                  v-for="item in graph.nodes"
                  :key="item.node.rpid"
                  class="node-card"
                  :class="nodeClasses(item.node)"
                  :style="nodeStyle(item)"
                  :title="item.node.message"
                  @click.stop="onNodeClick(item.node)"
                  @mouseenter="hoveredRpid = item.node.rpid"
                  @mouseleave="hoveredRpid = ''"
                >
                  <div class="node-top">
                    <span class="avatar" :style="{ background: userColor(item.node.mid) }">
                      {{ initial(item.node) }}
                    </span>
                    <span class="node-name">{{ item.node.uname || '匿名用户' }}</span>
                    <span v-if="item.node.isUp" class="up-badge">UP</span>
                    <span v-if="item.node.rpid === currentTarget" class="focus-badge">焦点</span>
                    <span
                      v-else-if="ancestorIds.has(item.node.rpid)"
                      class="context-badge"
                    >
                      上下文
                    </span>
                  </div>

                  <template v-if="item.node.isMore">
                    <p class="more-body">还有 {{ item.node.moreCount }} 条回复</p>
                    <p class="more-hint">点击展开</p>
                  </template>
                  <template v-else>
                    <p class="node-body">{{ item.node.message }}</p>
                    <div class="node-foot">
                      <span>{{ formatTime(item.node.ctime) }}</span>
                      <span v-if="item.node.like">赞 {{ item.node.like }}</span>
                      <span v-if="item.node.replyCount">回复 {{ item.node.replyCount }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <aside class="sidebar">
            <section v-if="selectedNode" class="detail">
              <div class="detail-head">
                <span class="avatar" :style="{ background: userColor(selectedNode.mid) }">
                  {{ initial(selectedNode) }}
                </span>
                <div class="detail-user">
                  <strong>{{ selectedNode.uname || '匿名用户' }}</strong>
                  <span>
                    {{ formatFullTime(selectedNode.ctime) }}
                    <template v-if="selectedNode.like"> · 赞 {{ selectedNode.like }}</template>
                  </span>
                </div>
                <button type="button" class="link-btn" @click="selectedRpid = ''">收起</button>
              </div>
              <p class="detail-body">{{ selectedNode.message }}</p>
              <div class="detail-actions">
                <button
                  type="button"
                  class="tool-btn"
                  :disabled="selectedNode.rpid === currentTarget || selectedNode.isMore || selectedNode.deleted"
                  @click="recenter(selectedNode.rpid)"
                >
                  以它为中心
                </button>
                <span v-if="selectedNode.replyTo" class="muted">
                  回复 @{{ selectedNode.replyTo.uname }}
                </span>
              </div>
            </section>
            <p v-else class="select-hint">点击图中的节点查看完整评论</p>

            <section class="stats">
              <div class="stat">
                <strong>{{ focusStats.count }}</strong>
                <span>相关评论</span>
              </div>
              <div class="stat">
                <strong>{{ focusStats.participants }}</strong>
                <span>参与者</span>
              </div>
              <div class="stat">
                <strong>{{ focusStats.maxDepth }}</strong>
                <span>最大层数</span>
              </div>
              <div class="stat">
                <strong>{{ focusStats.span }}</strong>
                <span>时间跨度</span>
              </div>
            </section>

            <section class="section">
              <h4>主要分支</h4>
              <p v-if="!branchStats.length" class="muted">当前评论还没有后续回复。</p>
              <button
                v-for="branch in branchStats.slice(0, 20)"
                :key="branch.id"
                type="button"
                class="branch-row"
                :class="{ active: activeBranch === branch.id }"
                @click="toggleBranch(branch.id)"
              >
                <span class="branch-dot" :style="{ background: userColor(branch.node.mid) }" />
                <span class="branch-main">
                  <span class="branch-name">{{ branch.node.uname }}</span>
                  <span class="branch-msg">{{ branch.node.message }}</span>
                </span>
                <span class="branch-meta">
                  {{ branch.count }} 条
                  <small>{{ branch.participants }} 人</small>
                </span>
              </button>
              <p v-if="branchStats.length > 20" class="muted">
                还有 {{ branchStats.length - 20 }} 个分支，可展开「更多回复」查看
              </p>
            </section>

            <section class="section">
              <h4>参与者</h4>
              <div class="participants">
                <button
                  v-for="person in participantStats.slice(0, 16)"
                  :key="person.mid"
                  type="button"
                  class="person-chip"
                  :class="{ active: activeMid === person.mid }"
                  @click="toggleParticipant(person.mid)"
                >
                  <i :style="{ background: userColor(person.mid) }" />
                  {{ person.uname }}
                  <small>{{ person.count }}</small>
                </button>
              </div>
              <p v-if="participantStats.length > 16" class="muted">
                还有 {{ participantStats.length - 16 }} 位参与者
              </p>
            </section>

            <section class="section">
              <h4>时间进度</h4>
              <div class="timeline">
                <i
                  v-for="(bucket, index) in timeline"
                  :key="index"
                  class="timeline-bar"
                  :style="{ height: `${Math.max(4, (bucket.count / timelineMax) * 100)}%` }"
                  :title="`${formatFullTime(bucket.start)} · ${bucket.count} 条`"
                />
              </div>
              <div class="timeline-labels">
                <span>{{ formatTime(focusStats.first) }}</span>
                <span>{{ formatTime(focusStats.last) }}</span>
              </div>
            </section>

            <section class="section mini-section">
              <button v-if="latestNode" type="button" class="mini-row" @click="selectNode(latestNode)">
                <span>最新</span>
                <strong>{{ latestNode.uname }}</strong>
                <small>{{ formatTime(latestNode.ctime) }}</small>
              </button>
              <button v-if="hottestNode" type="button" class="mini-row" @click="selectNode(hottestNode)">
                <span>最热</span>
                <strong>{{ hottestNode.uname }}</strong>
                <small>赞 {{ hottestNode.like }}</small>
              </button>
            </section>
          </aside>
        </div>
        <div v-else-if="!loading && !error" class="state">暂无数据</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.58);
}

.dialog {
  width: min(1280px, 97vw);
  height: min(820px, 94vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-head {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
  border-bottom: 1px solid var(--border);
}

.title-wrap {
  min-width: 0;
}

h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.dialog-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.close-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.close-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
}

.modes,
.toolbar-right,
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tool-btn {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.tool-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.tool-btn.active {
  border-color: var(--primary);
  background: rgba(79, 70, 229, 0.1);
  color: var(--primary);
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(90deg, #4f46e5, #0d9488, #ea580c);
}

.export-notice {
  max-width: 320px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

.export-notice.warn {
  color: #d97706;
}

.export-notice.error {
  color: var(--danger);
}

.export-btn {
  white-space: nowrap;
}

.zoom-controls {
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.zoom-btn {
  padding: 4px 8px;
  border: none;
  border-left: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.zoom-btn:first-child {
  border-left: none;
}

.zoom-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.err {
  margin: 12px 18px 0;
  font-size: 13px;
  color: var(--danger);
}

.error-state {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 18px;
}

.error-state .err {
  margin: 12px 0 0;
}

.state {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 13px;
  color: var(--text-muted);
}

.dialog-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.graph-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.truncated {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 16px;
  background: rgba(234, 88, 12, 0.08);
  color: var(--text-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
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

.link-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  background:
    radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.18) 1px, transparent 0) 0 0 / 22px 22px,
    var(--surface-2);
  touch-action: none;
}

.viewport.dragging {
  cursor: grabbing;
}

.canvas {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

.edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  color: #94a3b8;
  pointer-events: none;
}

.edge {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  opacity: 0.58;
}

.edge.active {
  color: var(--primary);
  stroke-width: 1.8;
  opacity: 0.9;
}

.node-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--user-color, #94a3b8);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: box-shadow 0.15s, opacity 0.15s, border-color 0.15s;
  overflow: hidden;
}

.node-card::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: var(--user-color, #94a3b8);
  opacity: 0.16;
  pointer-events: none;
}

.node-card > * {
  position: relative;
  z-index: 1;
}

:global([data-theme='dark']) .node-card::before {
  opacity: 0.24;
}

.node-card:hover {
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.16);
}

.node-card.target {
  border-color: var(--primary);
  border-left-color: var(--user-color);
  box-shadow: 0 0 0 2px var(--primary), 0 0 0 6px rgba(79, 70, 229, 0.16);
}

.node-card.selected {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}

.node-card.ancestor {
  border-style: dashed;
}

.node-card.ghost {
  border-color: var(--border);
  border-left-color: #94a3b8;
  background: repeating-linear-gradient(
    135deg,
    var(--surface),
    var(--surface) 6px,
    var(--surface-2) 6px,
    var(--surface-2) 12px
  );
}

.node-card.more {
  border-left-color: #94a3b8;
  border-style: dashed;
  background: var(--surface-2);
}

.node-card.dimmed {
  opacity: 0.18;
}

.node-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.avatar {
  flex-shrink: 0;
  width: 21px;
  height: 21px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.node-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.up-badge,
.focus-badge,
.context-badge {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  line-height: 1.6;
}

.up-badge {
  background: rgba(79, 70, 229, 0.12);
  color: var(--primary);
}

.focus-badge {
  background: var(--primary);
  color: #fff;
}

.context-badge {
  background: var(--surface-2);
  color: var(--text-muted);
}

.node-body {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 5px 0 0;
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
}

.node-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: auto;
  padding-top: 5px;
  color: var(--text-muted);
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
}

.more-body {
  margin: 8px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.more-hint {
  margin: 2px 0 0;
  font-size: 10px;
  color: var(--text-muted);
}

.node-card.compact .node-body {
  display: none;
}

.node-card.compact .node-foot {
  display: none;
}

.node-card.tiny .node-top {
  justify-content: center;
}

.node-card.tiny .node-name,
.node-card.tiny .up-badge,
.node-card.tiny .focus-badge,
.node-card.tiny .context-badge,
.node-card.tiny .more-body,
.node-card.tiny .more-hint {
  display: none;
}

.sidebar {
  flex-shrink: 0;
  width: 310px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 18px;
  border-left: 1px solid var(--border);
}

.select-hint {
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  font-size: 11px;
  color: var(--text-muted);
}

.detail {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.detail-head {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}

.detail-user {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-user strong {
  font-size: 12px;
}

.detail-user span {
  font-size: 10px;
  color: var(--text-muted);
}

.detail-body {
  max-height: 180px;
  overflow-y: auto;
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--border);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px;
  background: var(--surface);
}

.stat strong {
  font-size: 13px;
  font-weight: 600;
}

.stat span {
  font-size: 10px;
  color: var(--text-muted);
}

.section {
  margin-top: 14px;
}

.section h4 {
  margin: 0 0 7px;
  font-size: 12px;
  font-weight: 600;
}

.muted {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.branch-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  width: 100%;
  padding: 7px 0;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.branch-row:last-child {
  border-bottom: none;
}

.branch-row:hover,
.branch-row.active {
  background: var(--surface-2);
}

.branch-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 4px;
  border-radius: 50%;
}

.branch-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.branch-name {
  font-size: 11px;
  font-weight: 600;
}

.branch-msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-muted);
}

.branch-meta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 10px;
  color: var(--text-muted);
}

.branch-meta small {
  font-size: 9px;
}

.participants {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.person-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.person-chip i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.person-chip small {
  color: var(--text-muted);
  font-size: 9px;
}

.person-chip:hover,
.person-chip.active {
  border-color: var(--primary);
  color: var(--primary);
}

.timeline {
  height: 44px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 3px 0;
  border-bottom: 1px solid var(--border);
}

.timeline-bar {
  flex: 1;
  min-height: 2px;
  border-radius: 1px 1px 0 0;
  background: var(--primary);
  opacity: 0.55;
}

.timeline-bar:hover {
  opacity: 1;
}

.timeline-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 9px;
  color: var(--text-muted);
}

.mini-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mini-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  text-align: left;
  cursor: pointer;
}

.mini-row:hover {
  border-color: var(--primary);
}

.mini-row strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 11px;
}

.mini-row small {
  flex-shrink: 0;
  font-size: 9px;
}

@media (max-width: 900px) {
  .overlay {
    padding: 0;
  }

  .dialog {
    width: 100vw;
    height: 100svh;
    border-radius: 0;
  }

  .dialog-body {
    flex-direction: column;
    overflow-y: auto;
  }

  .graph-wrap {
    flex: none;
    height: 56vh;
    min-height: 320px;
  }

  .sidebar {
    width: 100%;
    flex: none;
    border-left: none;
    border-top: 1px solid var(--border);
  }

  .toolbar {
    align-items: flex-start;
  }

  .toolbar-right {
    width: 100%;
  }
}
</style>
