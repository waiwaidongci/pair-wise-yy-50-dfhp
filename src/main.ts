import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import { VueQueryPlugin } from '@tanstack/vue-query'
import 'primeicons/primeicons.css'
import App from './App.vue'
import router from './router'
import './styles.css'
import { bindExportBackend } from './api/exportApi'
import { useImpositionStore } from './stores/imposition'
import type { ExportTaskDetail } from './production/handoff'

const pinia = createPinia()

// 模拟后端复用 store 的分片恢复与版本对账逻辑；视图仍通过 REST 客户端访问
bindExportBackend({
  list: () => detail(useImpositionStore()),
  create: (payload) => {
    const store = useImpositionStore()
    const task = store.createTask(payload?.name, payload?.kind)
    return detailOf(store, task.id) ?? { ...task, shards: [] }
  },
  resume: (id) => {
    const store = useImpositionStore()
    store.resumeTask(id)
    return detailOf(store, id)
  },
  fail: (id) => {
    const store = useImpositionStore()
    store.simulateWriteFailure(id)
    return detailOf(store, id)
  },
})

function detailOf(store: ReturnType<typeof useImpositionStore>, id: string): ExportTaskDetail | null {
  const task = store.tasks.find((item) => item.id === id)
  if (!task) return null
  return { ...task, shards: store.shardsOfTask(id) }
}

function detail(store: ReturnType<typeof useImpositionStore>): ExportTaskDetail[] {
  return store.tasks.map((task) => ({ ...task, shards: store.shardsOfTask(task.id) }))
}

createApp(App).use(pinia).use(router).use(VueQueryPlugin).use(PrimeVue, {
  theme: { preset: Aura, options: { darkModeSelector: false, cssLayer: false } },
}).mount('#app')
