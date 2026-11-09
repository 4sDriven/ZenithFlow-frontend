<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EnglishMonthItem } from '../stores/english'

const props = defineProps<{ items: EnglishMonthItem[] }>()
const emit = defineEmits<{
  (e: 'load', from: string, to: string): void
  (e: 'select', item: EnglishMonthItem): void
}>()

const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth())

const weekdays = ['日', '一', '二', '三', '四', '五', '六']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

const todayKey = ymd(now.getFullYear(), now.getMonth(), now.getDate())
const monthLabel = computed(() => `${viewYear.value} 年 ${viewMonth.value + 1} 月`)
const activeDate = defineModel<string>('activeDate', { default: '' })

const byDate = computed(() => {
  const map = new Map<string, EnglishMonthItem>()
  for (const item of props.items) map.set(item.assignedDate, item)
  return map
})

type Cell = {
  key: string
  inMonth: boolean
  day?: number
  date?: string
  item?: EnglishMonthItem | null
}

const cells = computed<Cell[]>(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const startWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const result: Cell[] = []

  for (let i = 0; i < startWeekday; i++) result.push({ key: `pad-a-${i}`, inMonth: false })
  for (let day = 1; day <= daysInMonth; day++) {
    const date = ymd(year, month, day)
    result.push({ key: date, inMonth: true, day, date, item: byDate.value.get(date) ?? null })
  }
  while (result.length % 7 !== 0) result.push({ key: `pad-b-${result.length}`, inMonth: false })
  return result
})

function fetchMonth() {
  const year = viewYear.value
  const month = viewMonth.value
  emit('load', ymd(year, month, 1), ymd(year, month, new Date(year, month + 1, 0).getDate()))
}

function shiftMonth(delta: number) {
  const d = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = d.getFullYear()
  viewMonth.value = d.getMonth()
  fetchMonth()
}

function goToday() {
  const d = new Date()
  viewYear.value = d.getFullYear()
  viewMonth.value = d.getMonth()
  activeDate.value = todayKey
  fetchMonth()
}

function statusClass(status?: string): string {
  if (status === 'done') return 'ok'
  if (status === 'skipped') return 'skip'
  return 'pending'
}

function selectDay(cell: Cell) {
  if (!cell.inMonth || !cell.item) return
  activeDate.value = cell.date ?? ''
  emit('select', cell.item)
}

onMounted(fetchMonth)
</script>

<template>
  <section class="card calendar">
    <div class="cal-head">
      <div class="cal-title">
        <span class="cal-month">{{ viewMonth + 1 }} 月</span>
        <span class="cal-year">{{ viewYear }}</span>
      </div>
      <div class="cal-nav">
        <button class="nav-btn" aria-label="上个月" @click="shiftMonth(-1)">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button class="nav-btn nav-today" @click="goToday">今天</button>
        <button class="nav-btn" aria-label="下个月" @click="shiftMonth(1)">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>

    <!-- monthLabel retained for screen readers -->
    <span class="sr-only">{{ monthLabel }}</span>

    <div class="weekdays">
      <span v-for="w in weekdays" :key="w">{{ w }}</span>
    </div>

    <div class="grid">
      <button
        v-for="cell in cells"
        :key="cell.key"
        class="cell"
        :class="{
          blank: !cell.inMonth,
          today: cell.date === todayKey,
          selected: cell.date === activeDate,
          has: !!cell.item,
          [statusClass(cell.item?.status)]: !!cell.item,
        }"
        :disabled="!cell.inMonth || !cell.item"
        @click="selectDay(cell)"
      >
        <template v-if="cell.inMonth">
          <span class="day">{{ cell.day }}</span>
          <span v-if="cell.item" class="dot" />
        </template>
      </button>
    </div>

    <div class="legend">
      <span><i class="dot ok" /> 已完成</span>
      <span><i class="dot pending" /> 待练习</span>
      <span><i class="dot skip" /> 已跳过</span>
    </div>
  </section>
</template>

<style scoped>
.calendar {
  padding: 20px;
}

.cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.cal-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.cal-month {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.cal-year {
  font-size: 13px;
  color: var(--text-muted);
}

.cal-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav-btn {
  height: 30px;
  min-width: 30px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.nav-btn:hover {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--primary);
}

.nav-today {
  padding: 0 12px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.weekdays,
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.weekdays {
  margin-bottom: 4px;
}

.weekdays span {
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 4px 0;
}

.cell {
  position: relative;
  height: clamp(56px, 9vh, 84px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  cursor: default;
  transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s;
}

.cell.blank {
  visibility: hidden;
}

.cell.has {
  cursor: pointer;
}

.cell.has:hover {
  transform: translateY(-1px);
  border-color: currentColor;
}

.cell.pending {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
}

.cell.ok {
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
}

.cell.skip {
  background: var(--surface-2);
  color: var(--text-muted);
}

.cell.today {
  box-shadow: inset 0 0 0 2px var(--primary);
  font-weight: 700;
}

.cell.selected {
  background: var(--primary);
  color: var(--primary-fg);
  box-shadow: none;
}

.cell.selected:hover {
  border-color: transparent;
}

.cell .dot {
  position: absolute;
  bottom: 6px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 18px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.legend .dot.ok {
  background: var(--success);
}

.legend .dot.pending {
  background: var(--primary);
}

.legend .dot.skip {
  background: var(--text-muted);
}
</style>
