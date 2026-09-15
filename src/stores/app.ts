import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    tagline: '前端已就绪，等待接入业务。',
  }),
})
