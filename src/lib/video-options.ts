export type VideoPreset = {
  key: string
  label: string
  model: string
  resolution: string
  price: number
  audio: boolean
}

export const VIDEO_PRESETS: VideoPreset[] = [
  {
    key: 'saver',
    label: '省流 480P（¥0.14/秒 · 无声）',
    model: 'wan2.2-t2v-plus',
    resolution: '480P',
    price: 0.14,
    audio: false,
  },
  {
    key: 'standard',
    label: '标准 720P（¥0.6/秒 · 带音频）',
    model: 'wan2.5-t2v-preview',
    resolution: '720P',
    price: 0.6,
    audio: true,
  },
  {
    key: 'high',
    label: '高质量 720P（¥0.9/秒 · 带音频）',
    model: 'happyhorse-1.1-t2v',
    resolution: '720P',
    price: 0.9,
    audio: true,
  },
  {
    key: 'ultra',
    label: '超清 1080P（¥1.2/秒 · 带音频）',
    model: 'happyhorse-1.1-t2v',
    resolution: '1080P',
    price: 1.2,
    audio: true,
  },
]

export const VOICES = [
  { id: 'Cherry', label: '女声 · Cherry（温柔）' },
  { id: 'Ethan', label: '男声 · Ethan（沉稳）' },
  { id: 'Serena', label: '女声 · Serena（知性）' },
]

export const TONES = [
  { id: '', label: '默认语气' },
  { id: '温柔治愈、语速稍慢、带感情地朗读', label: '温柔' },
  { id: '沉稳温暖、语速稍慢、有磁性', label: '沉稳' },
  { id: '活泼轻快、元气满满', label: '活泼' },
  { id: '知性清晰、亲切，像纪录片旁白', label: '纪录片' },
]

export function presetByModel(model: string, resolution: string): VideoPreset {
  return (
    VIDEO_PRESETS.find((p) => p.model === model && p.resolution === resolution) ??
    VIDEO_PRESETS.find((p) => p.model === model) ??
    VIDEO_PRESETS[1]!
  )
}

export function presetByKey(key: string): VideoPreset {
  return VIDEO_PRESETS.find((p) => p.key === key) ?? VIDEO_PRESETS[1]!
}
