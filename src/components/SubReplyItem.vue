<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  comment: {
    rpid: string
    mid: string
    uname: string
    message: string
    pictureCount: number
    like: number
    ctime: number
    isUp: boolean
    replyTo: { mid: string; uname: string } | null
    replyCount: number
    liked?: boolean
    likePending?: boolean
  }
}>()

const emit = defineEmits<{
  (e: 'open-thread', comment: typeof props.comment): void
  (e: 'like', comment: typeof props.comment): void
  (e: 'reply', comment: typeof props.comment): void
}>()

function openThread() {
  emit('open-thread', props.comment)
}

function like() {
  emit('like', props.comment)
}

function reply() {
  emit('reply', props.comment)
}

function onRowClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button')) return
  if (window.getSelection()?.toString()) return
  openThread()
}

const expanded = ref(false)
const overflowing = ref(false)
const bodyRef = ref<HTMLElement | null>(null)

function spaceUrl(mid: string): string {
  return `https://space.bilibili.com/${mid}`
}

function formatTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

function measure() {
  const el = bodyRef.value
  if (!el) return
  if (expanded.value) {
    overflowing.value = true
    return
  }
  overflowing.value = el.scrollHeight > el.clientHeight + 1
}

onMounted(() => nextTick(measure))

watch(
  () => props.comment.message,
  () => {
    expanded.value = false
    void nextTick(measure)
  },
)
</script>

<template>
  <div class="sub-item" title="点击查看讨论关系" @click="onRowClick">
    <div class="sub-head">
      <a class="sub-name" :href="spaceUrl(comment.mid)" target="_blank" rel="noreferrer">
        {{ comment.uname }}
      </a>
      <span v-if="comment.isUp" class="up-badge">UP主</span>
      <span v-if="comment.replyTo" class="reply-to">
        回复
        <a
          v-if="comment.replyTo.mid"
          :href="spaceUrl(comment.replyTo.mid)"
          target="_blank"
          rel="noreferrer"
        >
          @{{ comment.replyTo.uname }}
        </a>
        <span v-else>@{{ comment.replyTo.uname }}</span>
      </span>
      <span class="sub-time">{{ formatTime(comment.ctime) }}</span>
      <button
        class="sub-act"
        :class="{ active: comment.liked }"
        type="button"
        :disabled="comment.likePending"
        @click.stop="like"
      >
        赞{{ comment.like > 0 ? ` ${comment.like}` : '' }}
      </button>
      <button class="sub-act" type="button" @click.stop="reply">回复</button>
      <button class="thread-btn" type="button" @click.stop="openThread">关系图</button>
    </div>

    <div ref="bodyRef" class="sub-body" :class="{ expanded }">
      {{ comment.message }}<span v-for="n in comment.pictureCount" :key="n" class="pic-tag">[图片]</span>
    </div>

    <button v-if="overflowing" class="expand-btn" type="button" @click="expanded = !expanded">
      {{ expanded ? '收起' : '展开' }}
    </button>
  </div>
</template>

<style scoped>
.sub-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.sub-item:hover {
  background: rgba(148, 163, 184, 0.08);
}

.sub-item:last-child {
  border-bottom: none;
}

.sub-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}

.sub-name {
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
}

.sub-name:hover {
  color: var(--primary);
}

.up-badge {
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: rgba(79, 70, 229, 0.12);
  color: var(--primary);
  font-size: 10px;
}

.reply-to {
  color: var(--text-muted);
  font-size: 11px;
}

.reply-to a {
  color: var(--primary);
  text-decoration: none;
}

.reply-to a:hover {
  text-decoration: underline;
}

.sub-time {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.sub-act {
  padding: 1px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
}

.sub-act:hover:not(:disabled) {
  border-color: var(--border);
  color: var(--primary);
}

.sub-act.active {
  border-color: rgba(79, 70, 229, 0.35);
  background: rgba(79, 70, 229, 0.1);
  color: var(--primary);
}

.sub-act:disabled {
  opacity: 0.6;
  cursor: default;
}

.thread-btn {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.5;
  cursor: pointer;
}

.thread-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.sub-body {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: calc(1.55em * 3);
  overflow: hidden;
}

.sub-body.expanded {
  max-height: none;
}

.pic-tag {
  margin-left: 4px;
  color: var(--primary);
  font-size: 12px;
}

.expand-btn {
  margin-top: 2px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 11px;
  cursor: pointer;
}

.expand-btn:hover {
  text-decoration: underline;
}
</style>
