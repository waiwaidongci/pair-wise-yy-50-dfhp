import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  boot,
  exportTasks,
  ledger,
  submitBaseline,
  recomputeAllTasks,
  createTask,
  scopeHashes,
  hashJson,
  sheetSpec,
  TAB_ID,
  type Page,
  type Position,
  type Proof,
  type ExportTask,
  type ConflictRecord,
} from '../handoff'
import { exportApi } from '../api/exportApi'

export type { Page, Position, Proof, ExportTask, Shard, ShardStatus, VersionRecord, ConflictRecord, MigrationRecord, HandoffRecord } from '../handoff'
export type Validation = { id: string; severity: '错误' | '警告'; pageNo?: number; title: string; detail: string }

export const useImpositionStore = defineStore('imposition', () => {
  const pages = ref<Page[]>(boot.pages)
  const positions = ref<Position[]>(boot.positions)
  const proofs = ref<Proof[]>(boot.proofs)
  const tasks = ref<ExportTask[]>(exportTasks.value)
  const side = ref<'front' | 'back'>('front')
  const zoom = ref(72)
  const revision = ref(boot.revision)
  const locked = ref(false)
  const selectedPosition = ref<string | null>(null)
  const selectedProof = ref('PRF-02')
  const lastConflict = ref<ConflictRecord | null>(null)

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
    localStorage.setItem('print-imposition-v2', JSON.stringify({ pages: pages.value, positions: positions.value, proofs: proofs.value, tasks: tasks.value, revision: revision.value, locked: locked.value }))
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

  function currentHashes(): Record<string, string> {
    return scopeHashes({ pages: pages.value, positions: positions.value, proofs: proofs.value, spec: sheetSpec })
  }

  function latestPassedProof(): Proof | undefined {
    return proofs.value.filter((proof) => proof.decision === '通过').sort((a, b) => b.round - a.round)[0]
  }

  /** 基线锁定：乐观并发提交，先确认的基线生效，后到内容只作冲突留档 */
  function confirmBaseline(): { ok: boolean; reason?: string } {
    const tip = ledger.confirmed[ledger.confirmed.length - 1]
    const unlock = latestPassedProof()
    if (!tip) return { ok: false, reason: '无已确认基线，无法提交' }
    if (!unlock || unlock.round <= tip.unlockedBy.round) {
      return { ok: false, reason: '需要一轮晚于当前基线的通过打样才能解锁新版本' }
    }
    const result = submitBaseline({
      baseRevision: tip.revision,
      baseHash: tip.baselineHash,
      payloadHash: hashJson({ pages: pages.value, positions: positions.value, proofs: proofs.value, spec: sheetSpec }),
      unlockProof: { proofId: unlock.id, round: unlock.round, sample: unlock.sample },
      payload: { pages: pages.value.length, positions: positions.value.length, proofs: proofs.value.length, submittedBy: TAB_ID },
    })
    if (result.ok) {
      locked.value = true
      revision.value = result.record.revision
      lastConflict.value = null
      recomputeAllTasks(tasks.value, currentHashes(), result.record.revision)
      return { ok: true }
    }
    lastConflict.value = result.conflict
    return { ok: false, reason: result.conflict.reason }
  }

  function unlock() {
    locked.value = false
    revision.value = `R${Number(revision.value.slice(1)) + 1}`
  }

  /** 新建导出任务，绑定当前已确认基线，分片按当前版本输入哈希建立 */
  function addTask() {
    const tip = ledger.confirmed[ledger.confirmed.length - 1]
    const task = createTask('package', '印刷交付包 · PDF/X-4', tip?.revision ?? revision.value, currentHashes())
    tasks.value.unshift(task)
    return task
  }

  /** 恢复中断任务：从最后完成分片继续，写入失败的分片作废后重算 */
  async function resumeTask(id: string) {
    const updated = (await exportApi.resume(id)).data
    const index = tasks.value.findIndex((task) => task.id === id)
    if (index >= 0) tasks.value[index] = updated
  }

  return {
    pages, positions, proofs, tasks, side, zoom, revision, locked, selectedPosition, selectedProof,
    validations, lastConflict,
    updatePosition, addPosition, updateProof, createProof,
    confirmBaseline, unlock, addTask, resumeTask,
  }
})
