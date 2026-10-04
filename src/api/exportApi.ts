import axios, { type AxiosAdapter } from 'axios'
import type { ExportTask } from '../stores/imposition'

let tasks: ExportTask[] = [
  { id: 'EXP-0925-01', name: '印刷交付包 · PDF/X-4', progress: 72, status: '已中断', updatedAt: '09-25 16:42', resumable: true },
  { id: 'EXP-0925-02', name: '数字样张低分辨率预览', progress: 100, status: '已完成', updatedAt: '09-25 15:18', resumable: false },
]

const adapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, 160))
  if (config.url === '/api/print/export-tasks' && config.method === 'get') {
    return { data: structuredClone(tasks), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (config.url?.match(/^\/api\/print\/export-tasks\/[^/]+\/resume$/) && config.method === 'post') {
    const id = config.url.split('/').at(-2)
    const task = tasks.find((item) => item.id === id)
    if (task && task.resumable) {
      task.status = '生成中'
      task.progress = Math.max(task.progress, 12)
      task.updatedAt = '刚刚'
    }
    return { data: structuredClone(task), status: 200, statusText: 'OK', headers: {}, config }
  }
  return { data: null, status: 404, statusText: 'Not Found', headers: {}, config }
}

const client = axios.create({ adapter })

export const exportApi = {
  list: () => client.get<ExportTask[]>('/api/print/export-tasks'),
  resume: (id: string) => client.post<ExportTask>(`/api/print/export-tasks/${id}/resume`),
}
