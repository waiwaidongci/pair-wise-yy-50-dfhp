import axios, { type AxiosAdapter, type AxiosResponse } from 'axios'
import type { ExportTaskDetail } from '../production/handoff'

interface BackendHandlers {
  list: () => ExportTaskDetail[]
  create: (payload?: { name?: string; kind?: string }) => ExportTaskDetail
  resume: (id: string) => ExportTaskDetail | null
  fail: (id: string) => ExportTaskDetail | null
}

let handlers: BackendHandlers | null = null

/** 由应用层把 Pinia store 的分片调度逻辑绑定为模拟后端 */
export function bindExportBackend(bound: BackendHandlers) {
  handlers = bound
}

function respond<T>(data: T, config: any, status = 200): AxiosResponse<T> {
  return { data, status, statusText: status === 409 ? 'Conflict' : 'OK', headers: {}, config }
}

async function delay() {
  await new Promise((resolve) => setTimeout(resolve, 180))
}

const adapter: AxiosAdapter = async (config) => {
  await delay()
  if (!handlers) return respond(null, config, 503)
  const url = config.url ?? ''

  if (url === '/api/print/export-tasks' && config.method === 'get') {
    return respond(handlers.list(), config)
  }
  if (url === '/api/print/export-tasks' && config.method === 'post') {
    const payload = (config.data ? JSON.parse(config.data) : {}) as { name?: string; kind?: string }
    return respond(handlers.create(payload), config)
  }
  const resumeMatch = url.match(/^\/api\/print\/export-tasks\/([^/]+)\/resume$/)
  if (resumeMatch && config.method === 'post') {
    const detail = handlers.resume(resumeMatch[1])
    return detail ? respond(detail, config) : respond(null, config, 404)
  }
  const failMatch = url.match(/^\/api\/print\/export-tasks\/([^/]+)\/fail-simulation$/)
  if (failMatch && config.method === 'post') {
    const detail = handlers.fail(failMatch[1])
    return detail ? respond(detail, config) : respond(null, config, 404)
  }
  return respond(null, config, 404)
}

const client = axios.create({ adapter })

export const exportApi = {
  list: () => client.get<ExportTaskDetail[]>('/api/print/export-tasks'),
  create: (payload: { name?: string; kind?: string }) =>
    client.post<ExportTaskDetail>('/api/print/export-tasks', payload),
  resume: (id: string) => client.post<ExportTaskDetail>(`/api/print/export-tasks/${id}/resume`),
  simulateFailure: (id: string) =>
    client.post<ExportTaskDetail>(`/api/print/export-tasks/${id}/fail-simulation`),
}
