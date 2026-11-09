import { defineStore } from 'pinia'
import { apiFetch } from '../lib/api'

export type TranscriptTurn = { speaker: string; text: string }
export type VocabularyEntry = { word: string; meaning: string }

export type EnglishEpisode = {
  id: number
  seriesSlug: string
  seriesName: string
  title: string
  pageUrl: string
  audioUrl: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  transcript: TranscriptTurn[]
  vocabulary: VocabularyEntry[]
  alignment: number[]
}

export type EnglishAssignment = {
  id: number
  status: 'pending' | 'done' | 'skipped'
  note: string | null
  completedAt: string | null
}

export type EnglishStats = { totalDone: number; streak: number }

export type EnglishMonthItem = {
  id: number
  assignedDate: string
  status: 'pending' | 'done' | 'skipped'
  episodeId: number
  title: string
  seriesName: string
  thumbnailUrl: string | null
}

export type EnglishDetail = {
  date: string
  assignment: EnglishAssignment
  episode: EnglishEpisode
}

export const useEnglishStore = defineStore('english', {
  state: () => ({
    date: '',
    assignment: null as EnglishAssignment | null,
    episode: null as EnglishEpisode | null,
    stats: null as EnglishStats | null,
    month: [] as EnglishMonthItem[],
    detail: null as EnglishDetail | null,
    detailLoading: false,
    loading: false,
    error: '',
  }),

  actions: {
    async loadToday() {
      this.loading = true
      this.error = ''
      try {
        const data = await apiFetch<{
          ok: boolean
          date: string
          assignment: EnglishAssignment
          episode: EnglishEpisode
        }>('/english/today')
        this.date = data.date
        this.assignment = data.assignment
        this.episode = data.episode
      } catch (e) {
        this.error = e instanceof Error ? e.message : '加载失败'
      } finally {
        this.loading = false
      }
    },

    async loadStats() {
      try {
        this.stats = await apiFetch<EnglishStats>('/english/stats')
      } catch {
        this.stats = null
      }
    },

    async complete(note: string) {
      if (!this.assignment) return
      const data = await apiFetch<{ ok: boolean; assignment: EnglishAssignment }>(
        `/english/assignments/${this.assignment.id}/complete`,
        { method: 'POST', body: JSON.stringify({ note: note.trim() || undefined }) },
      )
      this.assignment = { ...this.assignment, ...data.assignment }
      await this.loadStats()
    },

    async skip() {
      if (!this.assignment) return
      const data = await apiFetch<{ ok: boolean; assignment: EnglishAssignment }>(
        `/english/assignments/${this.assignment.id}/skip`,
        { method: 'POST' },
      )
      this.assignment = { ...this.assignment, ...data.assignment }
    },

    async saveNote(note: string) {
      if (!this.assignment) return
      const data = await apiFetch<{ ok: boolean; assignment: EnglishAssignment }>(
        `/english/assignments/${this.assignment.id}/note`,
        { method: 'POST', body: JSON.stringify({ note }) },
      )
      this.assignment = { ...this.assignment, ...data.assignment }
    },

    async refresh() {
      const data = await apiFetch<{
        ok: boolean
        results: { slug: string; added: number; error?: string }[]
      }>('/english/refresh', { method: 'POST', body: JSON.stringify({ limit: 40 }) })
      return data.results
    },

    async loadMonth(from: string, to: string) {
      const data = await apiFetch<{ ok: boolean; assignments: EnglishMonthItem[] }>(
        `/english/assignments?from=${from}&to=${to}`,
      )
      this.month = data.assignments
    },

    async openAssignment(id: number) {
      this.detailLoading = true
      this.error = ''
      try {
        const data = await apiFetch<{
          ok: boolean
          date: string
          assignment: EnglishAssignment
          episode: EnglishEpisode
        }>(`/english/assignments/${id}`)
        this.detail = { date: data.date, assignment: data.assignment, episode: data.episode }
      } catch (e) {
        this.error = e instanceof Error ? e.message : '加载失败'
      } finally {
        this.detailLoading = false
      }
    },
  },
})
