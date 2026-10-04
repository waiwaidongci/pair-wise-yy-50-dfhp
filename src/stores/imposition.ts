import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

export type Page = { pageNo: number; name: string; width: number; height: number; bleed: number; content: string }
export type Position = { id: string; pageNo: number; x: number; y: number; rotation: number; front: boolean }
export type Validation = { id: string; severity: '错误' | '警告'; pageNo?: number; title: string; detail: string }
export type Proof = { id: string; round: number; date: string; sample: string; deltaE: number; feedback: string; correction: string; owner: string; decision: '待决定' | '通过' | '退回' }
export type ExportTask = { id: string; name: string; progress: number; status: '排队中' | '生成中' | '已完成' | '已中断'; updatedAt: string; resumable: boolean }

export const sheetSpec = {
  width: 720,
  height: 1020,
  bleed: 3,
  safe: 5,
  gutter: 6,
  binding: '骑马订',
  grain: '纵向',
}

const seedPages: Page[] = [
  { pageNo: 1, name: '封面', width: 210, height: 297, bleed: 3, content: '潮汐来信 / 节目册' },
  { pageNo: 2, name: '版权页', width: 210, height: 297, bleed: 2, content: '版权与演职人员' },
  { pageNo: 3, name: '序言', width: 210, height: 297, bleed: 3, content: '导演手记' },
  { pageNo: 4, name: '剧照跨页左', width: 210, height: 297, bleed: 3, content: '第一幕剧照' },
  { pageNo: 5, name: '剧照跨页右', width: 210, height: 297, bleed: 3, content: '第一幕剧照延伸' },
  { pageNo: 6, name: '曲目表', width: 210, height: 297, bleed: 3, content: '曲目与时长' },
  { pageNo: 7, name: '创作团队', width: 210, height: 297, bleed: 1, content: '主创与制作团队' },
  { pageNo: 8, name: '封底', width: 210, height: 297, bleed: 3, content: '巡演信息' },
]

const seedPositions: Position[] = [
  { id: 'P-01', pageNo: 8, x: 34, y: 44, rotation: 0, front: true },
  { id: 'P-02', pageNo: 1, x: 372, y: 44, rotation: 180, front: true },
  { id: 'P-03', pageNo: 6, x: 34, y: 548, rotation: 180, front: true },
  { id: 'P-04', pageNo: 3, x: 372, y: 548, rotation: 0, front: true },
  { id: 'P-05', pageNo: 2, x: 34, y: 44, rotation: 0, front: false },
  { id: 'P-06', pageNo: 7, x: 372, y: 44, rotation: 180, front: false },
  { id: 'P-07', pageNo: 4, x: 34, y: 548, rotation: 0, front: false },
  { id: 'P-08', pageNo: 5, x: 372, y: 548, rotation: 180, front: false },
]

const seedProofs: Proof[] = [
  { id: 'PRF-01', round: 1, date: '2026-09-18', sample: '数字样张 v1', deltaE: 3.8, feedback: '封面夜空蓝偏紫，剧照暗部层次压缩。', correction: '调整 CMYK 曲线，黑色通道减少 4%。', owner: '周默 / 色彩管理', decision: '退回' },
  { id: 'PRF-02', round: 2, date: '2026-09-25', sample: '数字样张 v2', deltaE: 1.9, feedback: '整体色差改善，P7 出血仍不足。', correction: '重排 P7 版位并增加 2mm 出血。', owner: '林青 / 拼版', decision: '待决定' },
]

const seedTasks: ExportTask[] = [
  { id: 'EXP-0925-01', name: '印刷交付包 · PDF/X-4', progress: 72, status: '已中断', updatedAt: '09-25 16:42', resumable: true },
  { id: 'EXP-0925-02', name: '数字样张低分辨率预览', progress: 100, status: '已完成', updatedAt: '09-25 15:18', resumable: false },
]

export const useImpositionStore = defineStore('imposition', () => {
  const saved = localStorage.getItem('print-imposition-v1')
  const restored = saved ? JSON.parse(saved) : null
  const pages = ref<Page[]>(restored?.pages ?? structuredClone(seedPages))
  const positions = ref<Position[]>(restored?.positions ?? structuredClone(seedPositions))
  const proofs = ref<Proof[]>(restored?.proofs ?? structuredClone(seedProofs))
  const tasks = ref<ExportTask[]>(restored?.tasks ?? structuredClone(seedTasks))
  const side = ref<'front' | 'back'>('front')
  const zoom = ref(72)
  const revision = ref(restored?.revision ?? 'R6')
  const locked = ref(restored?.locked ?? false)
  const selectedPosition = ref<string | null>(null)
  const selectedProof = ref('PRF-02')

  const validations = computed<Validation[]>(() => {
    const issues: Validation[] = []
    const placedPages = positions.value.map((position) => position.pageNo)
    pages.value.forEach((page) => {
      if (!placedPages.includes(page.pageNo)) issues.push({ id: `missing-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 尚未拼版`, detail: `${page.name} 未出现在正反版位中。` })
      if (page.bleed < sheetSpec.bleed) issues.push({ id: `bleed-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 出血不足`, detail: `页面出血 ${page.bleed}mm，低于印刷要求 ${sheetSpec.bleed}mm。` })
    })
    for (let index = 0; index < positions.value.length; index += 1) {
      for (let next = index + 1; next < positions.value.length; next += 1) {
        const a = positions.value[index]
        const b = positions.value[next]
        if (a.front === b.front && Math.abs(a.x - b.x) < 320 && Math.abs(a.y - b.y) < 430) {
          issues.push({ id: `overlap-${a.id}-${b.id}`, severity: '错误', pageNo: a.pageNo, title: `${a.id} 与 ${b.id} 版位重叠`, detail: '当前纸张尺寸下页面之间不足安全间隙。' })
        }
      }
    }
    const frontOrder = positions.value.filter((item) => item.front).sort((a, b) => a.x - b.x || a.y - b.y).map((item) => item.pageNo)
    if (frontOrder[0] !== 1) issues.push({ id: 'binding-order', severity: '警告', pageNo: 1, title: '骑马订正版页序需要复核', detail: `当前首位为 P${frontOrder[0]}，装订方向规则期望封面位于首版位。` })
    return issues
  })

  watch([pages, positions, proofs, tasks, revision, locked], () => {
    localStorage.setItem('print-imposition-v1', JSON.stringify({ pages: pages.value, positions: positions.value, proofs: proofs.value, tasks: tasks.value, revision: revision.value, locked: locked.value }))
  }, { deep: true })

  function updatePosition(id: string, patch: Partial<Position>) {
    if (locked.value) return
    const position = positions.value.find((item) => item.id === id)
    if (position) Object.assign(position, patch)
  }

  function addPosition(pageNo: number) {
    if (locked.value || positions.value.some((item) => item.pageNo === pageNo && item.front === (side.value === 'front'))) return
    positions.value.push({ id: `P-${Date.now().toString().slice(-3)}`, pageNo, x: 34, y: 44, rotation: 0, front: side.value === 'front' })
  }

  function updateProof(id: string, patch: Partial<Proof>) {
    const proof = proofs.value.find((item) => item.id === id)
    if (proof) Object.assign(proof, patch)
  }

  function createProof() {
    proofs.value.push({ id: `PRF-${String(proofs.value.length + 1).padStart(2, '0')}`, round: proofs.value.length + 1, date: new Date().toISOString().slice(0, 10), sample: `数字样张 v${proofs.value.length + 1}`, deltaE: 0, feedback: '', correction: '', owner: '当前用户', decision: '待决定' })
  }

  function lockBaseline() {
    locked.value = true
    revision.value = `R${Number(revision.value.slice(1)) + 1}`
  }

  function unlock() {
    locked.value = false
  }

  function resumeTask(id: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (task && task.resumable) {
      task.status = '生成中'
      task.progress = Math.max(task.progress, 10)
      task.updatedAt = '刚刚'
    }
  }

  return { pages, positions, proofs, tasks, side, zoom, revision, locked, selectedPosition, selectedProof, validations, updatePosition, addPosition, updateProof, createProof, lockBaseline, unlock, resumeTask }
})
