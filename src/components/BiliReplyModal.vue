<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    target?: string
    submitting?: boolean
    error?: string
    maxLength?: number
    placeholder?: string
  }>(),
  {
    target: '',
    submitting: false,
    error: '',
    maxLength: 1000,
    placeholder: '发一条友善的评论…',
  },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', message: string): void
}>()

const message = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

function close() {
  if (props.submitting) return
  emit('close')
}

function submit() {
  if (props.submitting) return
  const text = message.value.trim()
  if (!text) return
  emit('submit', text)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    submit()
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    message.value = ''
    void nextTick(() => inputRef.value?.focus())
  },
)
</script>

<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="bili-reply-title">
      <h3 id="bili-reply-title">{{ title }}</h3>
      <p v-if="target" class="target">回复 <span>@{{ target }}</span></p>

      <textarea
        ref="inputRef"
        v-model="message"
        class="reply-input"
        :maxlength="maxLength"
        :placeholder="placeholder"
        rows="5"
        @keydown="onKeydown"
      ></textarea>

      <div class="meta">
        <span v-if="error" class="err">{{ error }}</span>
        <span class="count">{{ message.length }} / {{ maxLength }}</span>
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost" :disabled="submitting" @click="close">
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="submitting || !message.trim()"
          @click="submit"
        >
          {{ submitting ? '发布中…' : '发布' }}
        </button>
      </div>
      <p class="hint">Ctrl / ⌘ + Enter 快速发布</p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 230;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.55);
}

.dialog {
  width: min(520px, 100%);
  padding: 20px;
}

h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
}

.target {
  margin: 0 0 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.target span {
  color: var(--primary);
}

.reply-input {
  width: 100%;
  min-height: 120px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.reply-input:focus {
  border-color: var(--primary);
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  min-height: 18px;
  font-size: 12px;
}

.count {
  margin-left: auto;
  color: var(--text-muted);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  text-align: right;
}
</style>
