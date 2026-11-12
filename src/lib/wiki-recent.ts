/**
 * 文本阅读（/wiki）的「最近访问」记录。
 * 只存本地 localStorage：标题、站点、规范化地址、最后访问时间。
 */

export type WikiRecentEntry = {
  /** 去重键：规范化页面地址（去掉 # 锚点） */
  key: string
  /** 打开地址 */
  url: string
  /** 页面主体标题，如「武器」 */
  title: string
  /** 站点名，如「Terraria Wiki」 */
  site: string
  /** 最后访问时间戳 */
  at: number
}

const RECENT_KEY = 'zf-wiki-recent'
const LEGACY_KEY = 'zf-wiki-history'
const LIMIT = 50

function stripHash(url: string): string {
  const index = url.indexOf('#')
  return index < 0 ? url : url.slice(0, index)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** 取 URL 末段作为兜底标题：MediaWiki 的路径末段正好是条目名 */
export function titleFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    let segment = parts[parts.length - 1] ?? ''
    if (!segment) segment = parts[parts.length - 2] ?? ''
    try {
      segment = decodeURIComponent(segment)
    } catch {
      /* 保留原样 */
    }
    return segment.replace(/[-_]+/g, ' ').trim()
  } catch {
    return ''
  }
}

function looksLikeSiteSuffix(suffix: string, site: string, hostname: string): boolean {
  const tail = suffix.trim().toLowerCase()
  if (!tail) return false

  const siteLower = site.trim().toLowerCase()
  if (siteLower && (tail === siteLower || tail.includes(siteLower))) return true

  const hostLabel = hostname.replace(/^www\./, '').split('.')[0]?.toLowerCase() ?? ''
  if (hostLabel && hostLabel.length > 2 && tail.includes(hostLabel)) return true

  return tail === 'wiki' || tail.endsWith(' wiki') || tail.endsWith('wiki') || tail.endsWith('维基')
}

/**
 * 标题清洗：
 * - MediaWiki 的 title 就是条目名，直接使用；
 * - 通用站点常带「 - 站点名 / | 站点名」后缀，去掉与站点相关的那一段；
 * - 空标题回退 URL 末段，再回退 hostname。
 */
export function cleanTitle(
  raw: string,
  site: string,
  url: string,
  kind: 'mediawiki' | 'generic',
): string {
  let title = (raw ?? '').replace(/\s+/g, ' ').trim()
  const hostname = hostOf(url)

  if (!title) return titleFromUrl(url) || hostname || url

  if (kind === 'generic') {
    const parts = title.split(/\s+[-–—|·]\s+/)
    if (parts.length > 1 && looksLikeSiteSuffix(parts[parts.length - 1], site, hostname)) {
      title = parts.slice(0, -1).join(' - ').trim()
    }
  }

  return (title || titleFromUrl(url) || hostname).slice(0, 120)
}

function isEntry(value: unknown): value is WikiRecentEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.key === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.site === 'string' &&
    typeof entry.at === 'number'
  )
}

function saveRecent(entries: WikiRecentEntry[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
  } catch {
    /* 存储写满就放弃持久化，内存里仍然有效 */
  }
}

/** 把旧的纯 URL 历史（zf-wiki-history）迁移成带标题的记录 */
function migrateLegacy(): WikiRecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []

    const base = Date.now()
    const entries: WikiRecentEntry[] = []
    for (const item of raw) {
      if (typeof item !== 'string' || !item) continue
      const key = stripHash(item)
      if (entries.some((entry) => entry.key === key)) continue
      const hostname = hostOf(key)
      if (!hostname) continue
      entries.push({
        key,
        url: key,
        title: titleFromUrl(key) || hostname,
        site: hostname,
        at: base - entries.length * 1000,
      })
    }

    localStorage.removeItem(LEGACY_KEY)
    if (entries.length) saveRecent(entries)
    return entries
  } catch {
    return []
  }
}

export function readRecent(): WikiRecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (Array.isArray(raw)) {
      const entries = raw.filter(isEntry).slice(0, LIMIT)
      if (entries.length) return entries.sort((a, b) => b.at - a.at)
    }
  } catch {
    /* 损坏的旧数据按空处理 */
  }
  return migrateLegacy()
}

/** 记录一次成功访问：同址去重置顶，最多保留 50 条 */
export function rememberRecent(entry: WikiRecentEntry): WikiRecentEntry[] {
  const key = stripHash(entry.key || entry.url)
  const next = [
    { ...entry, key },
    ...readRecent().filter((item) => item.key !== key),
  ].slice(0, LIMIT)
  saveRecent(next)
  return next
}

export function removeRecent(key: string): WikiRecentEntry[] {
  const next = readRecent().filter((item) => item.key !== key)
  saveRecent(next)
  return next
}

export function clearRecent() {
  localStorage.removeItem(RECENT_KEY)
}
