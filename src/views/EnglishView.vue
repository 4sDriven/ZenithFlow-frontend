<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import EnglishCalendar from '../components/EnglishCalendar.vue'
import EnglishPlayer from '../components/EnglishPlayer.vue'
import RecorderButton from '../components/RecorderButton.vue'
import TranscriptList from '../components/TranscriptList.vue'
import { useEnglishStore } from '../stores/english'
import type { EnglishMonthItem } from '../stores/english'

const store = useEnglishStore()

const playerRef = ref<InstanceType<typeof EnglishPlayer> | null>(null)
const mode = ref<'practice' | 'calendar'>('practice')
const selectedDate = ref('')
const activeIndex = ref(0)
const note = ref('')
const saving = ref(false)
const refreshing = ref(false)
const hint = ref('')

const isToday = computed(() => !selectedDate.value || selectedDate.value === store.date)
const episode = computed(() => (isToday.value ? store.episode : (store.detail?.episode ?? null)))
const assignment = computed(
  () => (isToday.value ? store.assignment : (store.detail?.assignment ?? null)),
)
const currentTurn = computed(() => episode.value?.transcript[activeIndex.value])
const aligned = computed(() => (episode.value?.alignment?.length ?? 0) > 0)
const displayDate = computed(() => (isToday.value ? store.date : selectedDate.value))

const statusLabel = computed(() => {
  const status = assignment.value?.status
  if (status === 'done') return isToday.value ? '今日已完成' : '已完成'
  if (status === 'skipped') return isToday.value ? '今日已跳过' : '已跳过'
  return isToday.value ? '今日待练习' : '待练习'
})

const statusClass = computed(() => (assignment.value?.status === 'done' ? 'ok' : ''))

const publishedLabel = computed(() => {
  const iso = episode.value?.publishedAt
  return iso ? new Date(iso).toLocaleDateString('zh-CN') : ''
})

watch(
  () => store.assignment?.note,
  (value) => {
    if (value !== undefined && value !== null) note.value = value
  },
  { immediate: true },
)

watch(
  () => episode.value?.id,
  () => {
    activeIndex.value = 0
  },
)

function flash(text: string) {
  hint.value = text
  window.setTimeout(() => {
    if (hint.value === text) hint.value = ''
  }, 2500)
}

function goToTurn(index: number) {
  const turns = episode.value?.transcript ?? []
  if (index < 0 || index >= turns.length) return
  activeIndex.value = index
  const start = episode.value?.alignment?.[index]
  if (typeof start === 'number') playerRef.value?.seekTo(start)
}

function toggleMode() {
  mode.value = mode.value === 'calendar' ? 'practice' : 'calendar'
}

async function onSelectDay(item: EnglishMonthItem) {
  selectedDate.value = item.assignedDate
  activeIndex.value = 0
  if (item.assignedDate !== store.date) {
    await store.openAssignment(item.id)
  }
  mode.value = 'practice'
}

async function loadMonth(from: string, to: string) {
  try {
    await store.loadMonth(from, to)
  } catch (e) {
    store.error = e instanceof Error ? e.message : '日历加载失败'
  }
}

async function goToday() {
  selectedDate.value = ''
  mode.value = 'practice'
  if (!store.episode) await store.loadToday()
}

async function finish() {
  saving.value = true
  try {
    await store.complete(note.value)
    flash('已打卡，继续加油')
  } catch (e) {
    store.error = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function skipDay() {
  saving.value = true
  try {
    await store.skip()
    flash('已跳过今天')
  } catch (e) {
    store.error = e instanceof Error ? e.message : '操作失败'
  } finally {
    saving.value = false
  }
}

async function refresh() {
  refreshing.value = true
  try {
    const results = await store.refresh()
    const added = results.reduce((sum, r) => sum + r.added, 0)
    if (!store.episode) await store.loadToday()
    flash(added > 0 ? `新增 ${added} 期素材` : '素材已是最新')
  } catch (e) {
    store.error = e instanceof Error ? e.message : '刷新失败'
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  await Promise.all([store.loadToday(), store.loadStats()])
  selectedDate.value = store.date
})
</script>

<template>
  <AppLayout>
    <div class="head">
      <div class="head-left">
        <button class="btn btn-ghost btn-sm view-toggle" @click="toggleMode">
          <svg
            v-if="mode === 'practice'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M8 2v4M16 2v4M3 10h18" />
            <path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          </svg>
          <svg
            v-else
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {{ mode === 'calendar' ? '返回练习' : '日历' }}
        </button>
        <div>
          <h1>英语口语</h1>
          <p class="muted-text">
            {{
              mode === 'calendar'
                ? '点击有标记的日期，回看当天的课程'
                : 'BBC Learning English · 听原声 → 跟读 → 录音对比 → 打卡'
            }}
          </p>
        </div>
      </div>
      <div class="head-actions">
        <span v-if="store.stats" class="chip">连续 {{ store.stats.streak }} 天</span>
        <span v-if="store.stats" class="chip">累计 {{ store.stats.totalDone }} 课</span>
        <button
          v-if="mode === 'practice' && isToday"
          class="btn btn-ghost btn-sm"
          :disabled="refreshing"
          @click="refresh"
        >
          {{ refreshing ? '刷新中…' : '刷新素材' }}
        </button>
      </div>
    </div>

    <p v-if="store.error" class="alert">{{ store.error }}</p>

    <EnglishCalendar
      v-if="mode === 'calendar'"
      v-model:active-date="selectedDate"
      :items="store.month"
      @load="loadMonth"
      @select="onSelectDay"
    />

    <template v-else>
      <p v-if="store.loading || store.detailLoading" class="muted-text">加载中…</p>

      <template v-else-if="episode">
        <section class="card episode-head">
          <img
            v-if="episode.thumbnailUrl"
            class="thumb"
            :src="`/api/english/thumbnail/${episode.id}`"
            alt=""
          />
          <div class="episode-meta">
            <div class="badges">
              <span class="badge">{{ episode.seriesName }}</span>
              <span class="muted-text">{{ displayDate }}</span>
              <span v-if="publishedLabel" class="muted-text">发布于 {{ publishedLabel }}</span>
              <span class="status" :class="statusClass">{{ statusLabel }}</span>
            </div>
            <h2>{{ episode.title }}</h2>
            <div class="meta-links">
              <a :href="episode.pageUrl" target="_blank" rel="noreferrer">在 BBC 打开原课 →</a>
              <button v-if="!isToday" class="link-btn" @click="goToday">返回今日练习 →</button>
            </div>
          </div>
        </section>

        <div class="columns">
          <section class="card panel">
            <h3>1. 听原声 + 跟读</h3>
            <EnglishPlayer
              ref="playerRef"
              :src="episode.audioUrl ? `/api/english/audio/${episode.id}` : null"
            />
            <p v-if="aligned" class="muted-text">点击右侧任意一句，音频会跳到该句开头播放。</p>
            <RecorderButton />

            <div v-if="episode.transcript.length" class="practice">
              <div class="practice-head">
                <span>逐句跟读</span>
                <span class="muted-text">{{ activeIndex + 1 }} / {{ episode.transcript.length }}</span>
              </div>
              <p class="practice-text">
                <span class="spk">{{ currentTurn?.speaker }}</span>
                {{ currentTurn?.text }}
              </p>
              <div class="practice-nav">
                <button
                  class="btn btn-ghost btn-sm"
                  :disabled="activeIndex <= 0"
                  @click="goToTurn(activeIndex - 1)"
                >
                  上一句
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  :disabled="activeIndex >= episode.transcript.length - 1"
                  @click="goToTurn(activeIndex + 1)"
                >
                  下一句
                </button>
              </div>
            </div>

            <div v-if="episode.vocabulary.length" class="vocab">
              <h3>本期词汇</h3>
              <div v-for="v in episode.vocabulary" :key="v.word" class="vocab-item">
                <span class="word">{{ v.word }}</span>
                <span class="meaning">{{ v.meaning }}</span>
              </div>
            </div>
          </section>

          <section class="card panel">
            <h3>2. 对照文稿</h3>
            <TranscriptList
              v-if="episode.transcript.length"
              :turns="episode.transcript"
              :active-index="activeIndex"
              @select="goToTurn"
            />
            <p v-else class="muted-text">该期暂无文稿，可直接听音频跟读。</p>
          </section>
        </div>

        <section class="card panel">
          <template v-if="isToday">
            <h3>3. 复盘 + 打卡</h3>
            <textarea
              v-model="note"
              class="input textarea"
              rows="3"
              placeholder="今天练了什么？哪里卡住了？（可选）"
            />
            <div class="foot">
              <button
                class="btn btn-primary"
                :disabled="saving || assignment?.status === 'done'"
                @click="finish"
              >
                {{ assignment?.status === 'done' ? '今天已完成' : saving ? '保存中…' : '今天练完了' }}
              </button>
              <button
                class="btn btn-ghost btn-sm"
                :disabled="saving || assignment?.status === 'skipped'"
                @click="skipDay"
              >
                {{ assignment?.status === 'skipped' ? '已跳过' : '今天跳过' }}
              </button>
              <span v-if="hint" class="muted-text">{{ hint }}</span>
            </div>
          </template>
          <template v-else>
            <h3>3. 当日复盘</h3>
            <p v-if="assignment?.note" class="muted-text note-text">{{ assignment.note }}</p>
            <p v-else class="muted-text">当天没有留下复盘备注。</p>
          </template>
        </section>
      </template>

      <div v-else class="card panel empty">
        <p class="muted-text">素材池为空，先点右上角「刷新素材」拉取 BBC 课程。</p>
        <button class="btn btn-primary" :disabled="refreshing" @click="refresh">刷新素材</button>
      </div>
    </template>
  </AppLayout>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.view-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

h2 {
  margin: 6px 0;
  font-size: 18px;
}

h3 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chip,
.badge,
.status {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
}

.chip {
  background: var(--surface-2);
  color: var(--text-muted);
}

.badge {
  background: var(--primary);
  color: var(--primary-fg);
}

.status {
  background: var(--surface-2);
  color: var(--text-muted);
}

.status.ok {
  background: color-mix(in srgb, var(--success) 18%, transparent);
  color: var(--success);
}

.badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.episode-head {
  display: flex;
  gap: 16px;
  padding: 16px;
}

.thumb {
  width: 168px;
  height: 95px;
  object-fit: cover;
  border-radius: var(--radius);
  flex-shrink: 0;
}

.episode-meta {
  min-width: 0;
}

.meta-links {
  display: flex;
  align-items: center;
  gap: 14px;
}

.meta-links a {
  color: var(--primary);
  font-size: 13px;
  text-decoration: none;
}

.link-btn {
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 16px;
  align-items: start;
}

.panel {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.practice {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.practice-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.practice-text {
  margin: 0 0 10px;
  padding: 14px;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 18px;
  line-height: 1.6;
}

.spk {
  display: inline-block;
  margin-right: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.practice-nav {
  display: flex;
  gap: 8px;
}

.vocab {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.vocab-item {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  font-size: 14px;
}

.word {
  flex-shrink: 0;
  min-width: 120px;
  font-weight: 600;
  color: var(--primary);
}

.meaning {
  color: var(--text-muted);
}

.note-text {
  white-space: pre-wrap;
}

.input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
}

.input:focus {
  outline: none;
  border-color: var(--primary);
}

.textarea {
  resize: vertical;
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-sm {
  padding: 7px 12px;
  font-size: 13px;
}

.alert {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: 13px;
}

.empty {
  align-items: flex-start;
}

.muted-text {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}

@media (max-width: 900px) {
  .columns {
    grid-template-columns: 1fr;
  }
}
</style>
