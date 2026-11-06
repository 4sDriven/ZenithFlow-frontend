// 讨论关系图导出：把当前关系图（含当前焦点 / 模式 / 筛选状态）绘制成一张高清 PNG。
// 不依赖任何第三方库，直接按节点坐标重绘到 canvas，因此导出结果不受弹窗尺寸和当前缩放影响，
// 文字始终按布局尺寸渲染，再乘以倍率，放大后依然清晰。

export type GraphBox = { x: number; y: number; w: number; h: number }

export type GraphExportNode = GraphBox & {
  rpid: string
  mid: string
  uname: string
  message: string
  ctime: number
  like: number
  replyCount: number
  isUp: boolean
  deleted: boolean
  isMore: boolean
  moreCount: number
}

export type GraphExportEdge = {
  from: GraphBox
  to: GraphBox
  fromRpid: string
  toRpid: string
}

export type GraphExportTheme = {
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  primary: string
  radius: number
  fontFamily: string
  dark: boolean
}

export type GraphExportOptions = {
  nodes: GraphExportNode[]
  edges: GraphExportEdge[]
  width: number
  height: number
  title: string
  subtitle: string
  detail: string
  videoTitle?: string
  videoBvid?: string
  footerLeft: string
  footerRight: string
  theme: GraphExportTheme
  colorOf: (mid: string) => string
  dimmed: Set<string>
  selected: string
  target: string
  ancestors: Set<string>
}

export type GraphExportImage = {
  blob: Blob
  width: number
  height: number
  scale: number
}

const OUTER_PADDING = 32
const HEADER_HEIGHT = 88
const VIDEO_CARD_HEIGHT = 46
const VIDEO_CARD_GAP = 16
const FOOTER_HEIGHT = 44
// 浏览器 canvas 单边上限 16384、总面积上限约 268M 像素；留出安全余量。
const MAX_SIDE = 16000
// 手机端 canvas 面积上限普遍更小，按屏幕宽度降级，避免导出直接失败。
const MAX_PIXELS =
  typeof window !== 'undefined' && window.innerWidth < 768 ? 20_000_000 : 48_000_000
const PREFERRED_SCALE = 3

const EDGE_COLOR = '#94a3b8'
const GHOST_COLOR = '#94a3b8'
// 行首禁则：这些标点不另起一行，宁可让上一行略微超出内容宽度。
const NO_LINE_START = /^[，。、：；！？）】》」』”’…%,.!?:;)\]}〉]$/

export type GraphExportEstimate = {
  width: number
  height: number
  scale: number
}

export function estimateThreadGraphImageSize(
  graphWidth: number,
  graphHeight: number,
  withVideoCard = false,
): GraphExportEstimate {
  const headerHeight = HEADER_HEIGHT + (withVideoCard ? VIDEO_CARD_HEIGHT + VIDEO_CARD_GAP : 0)
  const width = Math.round(Math.max(320, graphWidth) + OUTER_PADDING * 2)
  const height = Math.round(
    Math.max(120, graphHeight) + OUTER_PADDING * 2 + headerHeight + FOOTER_HEIGHT,
  )
  const scale = pickScale(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

export async function renderThreadGraphPng(
  options: GraphExportOptions,
): Promise<GraphExportImage> {
  const graphWidth = Math.max(320, options.width)
  const graphHeight = Math.max(120, options.height)
  const hasVideoCard = Boolean(options.videoTitle?.trim() || options.videoBvid?.trim())
  const headerHeight = HEADER_HEIGHT + (hasVideoCard ? VIDEO_CARD_HEIGHT + VIDEO_CARD_GAP : 0)
  const width = Math.round(graphWidth + OUTER_PADDING * 2)
  const height = Math.round(graphHeight + OUTER_PADDING * 2 + headerHeight + FOOTER_HEIGHT)

  const scale = pickScale(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持导出图片')

  // 以逻辑像素为坐标系绘制，最后整体放大到目标分辨率。
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
  ctx.textBaseline = 'alphabetic'

  const theme = options.theme
  const font = theme.fontFamily

  // 背景 + 页眉 + 页脚
  ctx.fillStyle = theme.surface2
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = theme.surface
  ctx.fillRect(0, 0, width, headerHeight)
  ctx.fillRect(0, height - FOOTER_HEIGHT, width, FOOTER_HEIGHT)
  ctx.fillStyle = theme.border
  ctx.fillRect(0, headerHeight - 1, width, 1)
  ctx.fillRect(0, height - FOOTER_HEIGHT, width, 1)

  const headerPad = 24
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = theme.text
  ctx.font = `600 18px ${font}`
  ctx.fillText(options.title, headerPad, 34)

  ctx.textBaseline = 'middle'
  ctx.fillStyle = theme.muted
  ctx.font = `400 12px ${font}`
  ctx.fillText(
    ellipsize(ctx, options.subtitle, width - headerPad * 2),
    headerPad,
    58,
  )
  ctx.fillText(ellipsize(ctx, options.detail, width - headerPad * 2), headerPad, 78)

  if (hasVideoCard) {
    drawVideoCard(ctx, options, width, headerPad, HEADER_HEIGHT - 4, font, theme)
  }

  // 页脚文字
  ctx.textBaseline = 'middle'
  ctx.font = `400 12px ${font}`
  ctx.fillStyle = theme.muted
  ctx.textAlign = 'left'
  ctx.fillText(ellipsize(ctx, options.footerLeft, width * 0.62), headerPad, height - FOOTER_HEIGHT / 2)
  ctx.textAlign = 'right'
  ctx.fillText(options.footerRight, width - headerPad, height - FOOTER_HEIGHT / 2)

  const originX = OUTER_PADDING
  const originY = headerHeight + OUTER_PADDING

  drawEdges(ctx, options, originX, originY, theme)

  for (const node of options.nodes) {
    drawNode(ctx, node, options, originX, originY)
  }

  const blob = await canvasToBlob(canvas)
  return { blob, width: canvas.width, height: canvas.height, scale }
}

function drawVideoCard(
  ctx: CanvasRenderingContext2D,
  options: GraphExportOptions,
  width: number,
  pad: number,
  y: number,
  font: string,
  theme: GraphExportTheme,
) {
  const x = pad
  const cardH = VIDEO_CARD_HEIGHT
  const maxCardW = width - pad * 2
  const title = (options.videoTitle ?? '').trim() || '未知视频'
  const bvid = (options.videoBvid ?? '').trim()

  ctx.font = `400 11px ${font}`
  const chipW = bvid ? ctx.measureText(bvid).width + 16 : 0
  ctx.font = `600 14px ${font}`
  const titleW = ctx.measureText(title).width
  const chromeW = 12 + 38 + 12 + (bvid ? 12 + chipW : 0) + 12
  const cardW = Math.min(maxCardW, Math.max(320, chromeW + titleW))
  const centerY = y + cardH / 2

  roundRect(ctx, x, y, cardW, cardH, theme.radius)
  ctx.fillStyle = theme.surface2
  ctx.fill()
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 1
  ctx.stroke()

  // 「视频」小标签
  const badgeW = 38
  const badgeH = 20
  const badgeX = x + 12
  roundRect(ctx, badgeX, centerY - badgeH / 2, badgeW, badgeH, 4)
  ctx.fillStyle = rgba(theme.primary, 0.12)
  ctx.fill()
  ctx.fillStyle = theme.primary
  ctx.font = `500 10px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('视频', badgeX + badgeW / 2, centerY + 1)

  // 右侧视频 ID（BV 号）
  let titleRight = x + cardW - 12
  if (bvid) {
    const chipH = 20
    const chipX = x + cardW - 12 - chipW
    roundRect(ctx, chipX, centerY - chipH / 2, chipW, chipH, 4)
    ctx.fillStyle = theme.surface
    ctx.fill()
    ctx.strokeStyle = theme.border
    ctx.stroke()
    ctx.fillStyle = theme.muted
    ctx.font = `400 11px ${font}`
    ctx.textAlign = 'center'
    ctx.fillText(bvid, chipX + chipW / 2, centerY + 1)
    titleRight = chipX - 12
  }

  // 视频标题
  const titleX = badgeX + badgeW + 12
  if (titleRight > titleX) {
    ctx.fillStyle = theme.text
    ctx.font = `600 14px ${font}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(ellipsize(ctx, title, titleRight - titleX), titleX, centerY + 1)
  }

  ctx.textAlign = 'left'
}

function pickScale(width: number, height: number): number {
  const sideLimit = Math.min(MAX_SIDE / width, MAX_SIDE / height)
  const areaLimit = Math.sqrt(MAX_PIXELS / (width * height))
  return Math.max(0.02, Math.min(PREFERRED_SCALE, sideLimit, areaLimit))
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  options: GraphExportOptions,
  originX: number,
  originY: number,
  theme: GraphExportTheme,
) {
  const selected = options.selected
  ctx.lineCap = 'round'
  for (const edge of options.edges) {
    const fromX = originX + edge.from.x + edge.from.w / 2
    const fromY = originY + edge.from.y + edge.from.h
    const toX = originX + edge.to.x + edge.to.w / 2
    const toY = originY + edge.to.y
    const middle = (fromY + toY) / 2
    const active =
      Boolean(selected) && (edge.fromRpid === selected || edge.toRpid === selected)

    ctx.save()
    ctx.globalAlpha = active ? 0.9 : 0.58
    ctx.strokeStyle = active ? theme.primary : EDGE_COLOR
    ctx.lineWidth = active ? 1.8 : 1.2
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.bezierCurveTo(fromX, middle, toX, middle, toX, toY)
    ctx.stroke()
    // 箭头（与界面 marker 一致，方向朝下）
    ctx.fillStyle = active ? theme.primary : EDGE_COLOR
    ctx.beginPath()
    ctx.moveTo(toX, toY)
    ctx.lineTo(toX - 3, toY - 6)
    ctx.lineTo(toX + 3, toY - 6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: GraphExportNode,
  options: GraphExportOptions,
  originX: number,
  originY: number,
) {
  const theme = options.theme
  const font = theme.fontFamily
  const color = options.colorOf(node.mid)
  const x = originX + node.x
  const y = originY + node.y
  const w = node.w
  const h = node.h
  const radius = theme.radius
  const dimmed = options.dimmed.has(node.rpid)
  const isTarget = node.rpid === options.target
  const isSelected = node.rpid === options.selected
  const isAncestor = node.rpid !== options.target && options.ancestors.has(node.rpid)
  const padX = 10
  const padY = 9
  const avatarSize = 21
  const bodyLineHeight = 16

  ctx.save()
  if (dimmed) ctx.globalAlpha = 0.18

  // 卡片底色
  roundRect(ctx, x, y, w, h, radius)
  ctx.fillStyle = theme.surface
  ctx.fill()

  if (node.deleted) {
    ctx.save()
    roundRect(ctx, x, y, w, h, radius)
    ctx.clip()
    ctx.fillStyle = theme.surface2
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = theme.surface
    ctx.lineWidth = 5
    for (let offset = -h; offset < w + h; offset += 14) {
      ctx.beginPath()
      ctx.moveTo(x + offset, y + h)
      ctx.lineTo(x + offset + h, y)
      ctx.stroke()
    }
    ctx.restore()
  } else if (node.isMore) {
    roundRect(ctx, x, y, w, h, radius)
    ctx.fillStyle = theme.surface2
    ctx.fill()
  } else {
    ctx.save()
    roundRect(ctx, x, y, w, h, radius)
    ctx.clip()
    ctx.globalAlpha = (dimmed ? 0.18 : 1) * (theme.dark ? 0.24 : 0.16)
    ctx.fillStyle = color
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  // 边框（祖先链为虚线）
  ctx.save()
  if (node.deleted || node.isMore || isAncestor) ctx.setLineDash([4, 3])
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius)
  ctx.lineWidth = 1
  ctx.strokeStyle = isTarget ? theme.primary : theme.border
  ctx.stroke()
  ctx.restore()

  // 左侧用户色条
  ctx.save()
  roundRect(ctx, x, y, w, h, radius)
  ctx.clip()
  if (isAncestor) {
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 3
    ctx.strokeStyle = node.deleted || node.isMore ? GHOST_COLOR : color
    ctx.beginPath()
    ctx.moveTo(x + 1.5, y)
    ctx.lineTo(x + 1.5, y + h)
    ctx.stroke()
  } else {
    ctx.fillStyle = node.deleted || node.isMore ? GHOST_COLOR : color
    ctx.fillRect(x, y, 3, h)
  }
  ctx.restore()

  const contentX = x + 3 + padX
  const contentRight = x + w - padX
  const avatarCx = contentX + avatarSize / 2
  const avatarCy = y + padY + avatarSize / 2

  // 头像
  ctx.beginPath()
  ctx.arc(avatarCx, avatarCy, avatarSize / 2, 0, Math.PI * 2)
  ctx.fillStyle = node.deleted || node.isMore ? GHOST_COLOR : color
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 11px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(nodeInitial(node), avatarCx, avatarCy + 0.5)

  // 徽标（UP / 焦点 / 上下文），从右往左排
  const badges: Array<{ text: string; bg: string; fg: string }> = []
  if (node.isUp) badges.push({ text: 'UP', bg: rgba(theme.primary, 0.12), fg: theme.primary })
  if (isTarget) badges.push({ text: '焦点', bg: theme.primary, fg: '#ffffff' })
  else if (isAncestor) badges.push({ text: '上下文', bg: theme.surface2, fg: theme.muted })

  let badgeLeft = contentRight
  if (badges.length) {
    ctx.font = `400 9px ${font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const badgeHeight = 14
    let cursor = contentRight
    for (let i = badges.length - 1; i >= 0; i -= 1) {
      const badge = badges[i]
      if (!badge) continue
      const badgeWidth = ctx.measureText(badge.text).width + 8
      cursor -= badgeWidth
      roundRect(ctx, cursor, avatarCy - badgeHeight / 2, badgeWidth, badgeHeight, 3)
      ctx.fillStyle = badge.bg
      ctx.fill()
      ctx.fillStyle = badge.fg
      ctx.fillText(badge.text, cursor + badgeWidth / 2, avatarCy + 0.5)
      cursor -= 4
    }
    badgeLeft = cursor + 4
  }

  // 用户名
  const nameX = avatarCx + avatarSize / 2 + 6
  const nameRight = badges.length ? badgeLeft - 6 : contentRight
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `600 12px ${font}`
  ctx.fillStyle = theme.text
  if (nameRight > nameX) {
    ctx.fillText(ellipsize(ctx, node.uname || '匿名用户', nameRight - nameX), nameX, avatarCy)
  }

  // 正文 / 折叠提示
  const bodyTop = y + padY + avatarSize + 5
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (node.isMore) {
    ctx.fillStyle = theme.text
    ctx.font = `600 12px ${font}`
    ctx.fillText(`还有 ${node.moreCount} 条回复`, contentX, bodyTop + 14)
    ctx.fillStyle = theme.muted
    ctx.font = `400 10px ${font}`
    ctx.fillText('已折叠，未在图中展开', contentX, bodyTop + 32)
  } else {
    ctx.fillStyle = node.deleted ? theme.muted : theme.text
    ctx.font = `400 11px ${font}`
    const lines = wrapLines(ctx, node.message, contentRight - contentX, 3)
    for (let index = 0; index < lines.length; index += 1) {
      ctx.fillText(lines[index] ?? '', contentX, bodyTop + 10 + index * bodyLineHeight)
    }

    const parts: string[] = []
    const time = formatShortTime(node.ctime)
    if (time) parts.push(time)
    if (node.like) parts.push(`赞 ${node.like}`)
    if (node.replyCount) parts.push(`回复 ${node.replyCount}`)
    if (parts.length) {
      ctx.font = `400 9px ${font}`
      ctx.fillStyle = theme.muted
      ctx.textBaseline = 'bottom'
      let cursor = contentX
      const baseline = y + h - 9
      for (const part of parts) {
        const partWidth = ctx.measureText(part).width
        if (cursor + partWidth > contentRight) break
        ctx.fillText(part, cursor, baseline)
        cursor += partWidth + 7
      }
    }
  }

  // 焦点 / 选中描边（画在卡片外侧）
  const ringAlpha = dimmed ? 0.18 : 1
  if (isTarget) {
    ctx.save()
    ctx.globalAlpha = ringAlpha
    roundRect(ctx, x - 1, y - 1, w + 2, h + 2, radius + 1)
    ctx.lineWidth = 2
    ctx.strokeStyle = theme.primary
    ctx.stroke()
    ctx.globalAlpha = ringAlpha * 0.16
    roundRect(ctx, x - 3.5, y - 3.5, w + 7, h + 7, radius + 3.5)
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.restore()
  }
  if (isSelected && !isTarget) {
    ctx.save()
    ctx.globalAlpha = ringAlpha
    roundRect(ctx, x - 2, y - 2, w + 4, h + 4, radius + 2)
    ctx.lineWidth = 2
    ctx.strokeStyle = theme.text
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()
}

function nodeInitial(node: GraphExportNode): string {
  if (node.isMore) return '+'
  if (node.deleted) return '删'
  return (node.uname || '?').charAt(0).toUpperCase()
}

function formatShortTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  const chars = Array.from(text)
  let low = 0
  let high = chars.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = `${chars.slice(0, mid).join('')}…`
    if (ctx.measureText(candidate).width <= maxWidth) low = mid
    else high = mid - 1
  }
  return `${chars.slice(0, low).join('')}…`
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized || maxWidth <= 0) return []
  const chars = Array.from(normalized)
  const lines: string[] = []
  let index = 0

  while (index < chars.length && lines.length < maxLines) {
    let line = ''
    while (index < chars.length) {
      const candidate = line + chars[index]
      if (line && ctx.measureText(candidate).width > maxWidth) {
        // 行首禁则：标点跟着上一行走，避免「：」「。」这类字符单独起行。
        const next = chars[index]
        if (next && NO_LINE_START.test(next)) {
          line = candidate
          index += 1
        }
        break
      }
      line = candidate
      index += 1
    }
    lines.push(line)
  }

  if (index < chars.length && lines.length) {
    const lastIndex = lines.length - 1
    const cut = Array.from(lines[lastIndex] ?? '')
    while (cut.length && ctx.measureText(`${cut.join('')}…`).width > maxWidth) cut.pop()
    lines[lastIndex] = `${cut.join('')}…`
  }

  return lines
}

function rgba(color: string, alpha: number): string {
  const value = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  if (short) {
    const [, r, g, b] = short
    return `rgba(${parseInt(`${r}${r}`, 16)}, ${parseInt(`${g}${g}`, 16)}, ${parseInt(`${b}${b}`, 16)}, ${alpha})`
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (long) {
    const [, r, g, b] = long
    return `rgba(${parseInt(r ?? '00', 16)}, ${parseInt(g ?? '00', 16)}, ${parseInt(b ?? '00', 16)}, ${alpha})`
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value)
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  }
  return value
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('生成图片失败，可能是图片尺寸超出浏览器限制'))
    }, 'image/png')
  })
}
