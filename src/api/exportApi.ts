import axios, { type AxiosAdapter } from 'axios'
import { exportTasks, hashJson, type ExportTask } from '../handoff'

// 每个任务的写入尝试次数：首次写入在下一分片失败，用于演示“从最后完成分片恢复”
const attempts = new Map<string, number>()

const adapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, 160))
  if (config.url === '/api/print/export-tasks' && config.method === 'get') {
    return { data: structuredClone(exportTasks.value), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (config.url?.match(/^\/api\/print\/export-tasks\/[^/]+\/resume$/) && config.method === 'post') {
    const id = config.url.split('/').at(-2) ?? ''
    const task = exportTasks.value.find((item) => item.id === id)
    if (task) {
      task.status = '生成中'
      const shard = task.shards.find((item) => item.status === 'pending' || item.status === 'stale' || item.status === 'failed')
      if (shard) {
        const count = (attempts.get(id) ?? 0) + 1
        attempts.set(id, count)
        if (count === 1 && shard.status !== 'failed') {
          // 写入失败：分片作废，任务从最后完成分片处中断
          shard.status = 'failed'
          shard.outputHash = undefined
          task.status = '已中断'
        } else {
          // 恢复：跳过已完成分片，从失败分片继续写入并记录输出哈希
          shard.status = 'done'
          shard.reused = false
          shard.outputHash = hashJson(`${shard.id}:${shard.inputHash}:out:v2`)
          shard.completedAt = '刚刚'
          const next = task.shards.find((item) => item.status === 'pending' || item.status === 'stale' || item.status === 'failed')
          task.status = next ? '已中断' : '已完成'
        }
      }
      const done = task.shards.filter((item) => item.status === 'done').length
      task.progress = Math.round((done / task.shards.length) * 100)
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
