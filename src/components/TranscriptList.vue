<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { TranscriptTurn } from '../stores/english'

const props = defineProps<{ turns: TranscriptTurn[]; activeIndex: number }>()
const emit = defineEmits<{ (e: 'select', index: number): void }>()

const listEl = ref<HTMLElement | null>(null)
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.turns.map((t, i) => ({ t, i }))
  return props.turns.map((t, i) => ({ t, i })).filter((x) => x.t.text.toLowerCase().includes(q))
})

watch(
  () => props.activeIndex,
  async () => {
    await nextTick()
    const el = listEl.value?.querySelector('.line.active')
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
)
</script>

<template>
  <div class="transcript">
    <input v-model="query" class="search" type="search" placeholder="在文稿中搜索…" />
    <div ref="listEl" class="list">
      <button
        v-for="item in filtered"
        :key="item.i"
        class="line"
        :class="{ active: item.i === activeIndex }"
        @click="emit('select', item.i)"
      >
        <span class="spk">{{ item.t.speaker }}</span>
        <span class="txt">{{ item.t.text }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.transcript {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.search {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 46vh;
  overflow-y: auto;
  padding-right: 4px;
}

.line {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 14px;
  line-height: 1.5;
  cursor: pointer;
}

.line:hover {
  background: var(--surface-2);
}

.line.active {
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 var(--primary);
}

.spk {
  flex-shrink: 0;
  width: 84px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  padding-top: 2px;
}

.txt {
  flex: 1;
  min-width: 0;
}
</style>
