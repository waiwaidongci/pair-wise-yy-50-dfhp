import { reactive, ref, watch } from 'vue'

// ============================================================
// 生产交接核心：拼版版本 / 打样决定 / 导出任务 三方交接
//  - 版本基线由打样轮次解锁，基线哈希做乐观并发凭据
//  - 导出任务按分片绑定版本输入哈希，版本变更后分片复用或作废
//  - 先确认的基线生效，后到内容只作冲突留档
//  - 写入失败从最后完成分片恢复，旧结构迁移留哈希
// ============================================================

export type Page = { pageNo: number; name: string; width: number; height: number; bleed: number; content: string }
export type Position = { id: string; pageNo: number; x: number; y: number; rotation: number; front: boolean }
export type Proof = { id: string; round: number; date: string; sample: string; deltaE: number; feedback: string; correction: string; owner: string; decision: '待决定' | '通过' | '退回' }

export type ShardStatus = 'done' | 'pending' | 'stale' | 'failed'
export type Shard = {
  id: string
  index: number
  label: string
  scope: string
  inputHash: string
  outputHash?: string
  status: ShardStatus
  reused?: boolean
  completedAt?: string
}

export type ExportTask = {
  id: string
  name: string
  revision: string
  kind: 'package' | 'proof'
  progress: number
  status: '排队中' | '生成中' | '已完成' | '已中断'
  updatedAt: string
  resumable: boolean
  shards: Shard[]
}

export type VersionRecord = {
  id: string
  revision: string
  unlockedBy: { proofId: string; round: number; sample: string }
  baselineHash: string
  lockedAt: string
  tabId: string
}

export type ConflictRecord = {
  id: string
  at: string
  tabId: string
  baseRevision: string
  baseHash: string
  payloadHash: string
  reason: string
  payload: Record<string, unknown>
}

export type MigrationRecord = {
  id: string
  at: string
  fromShape: string
  toShape: string
  fromHash: string
  toHash: string
  summary: string
}

export type HandoffRecord = {
  id: string
  at: string
  fromRevision: string
  toRevision: string
  taskId: string
  taskName: string
  reused: number
  invalidated: number
}

export type Ledger = {
  confirmed: VersionRecord[]
  conflicts: ConflictRecord[]
  migrations: MigrationRecord[]
  handoffs: HandoffRecord[]
  remoteNotice: string | null
}

// ---------- 哈希（cyrb53，确定性，用于基线/分片/迁移留痕） ----------

export function hashJson(value: unknown): string {
  const str = JSON.stringify(value)
  let h1 = 0xdeadbeef ^ 0x9e3779b9
  let h2 = 0x41c6ce57 ^ 0x9e3779b9
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
  return n.padStart(16, '0').slice(0, 16)
}

// ---------- 种子数据 ----------

export const sheetSpec = {
  width: 720,
  height: 1020,
  bleed: 3,
  safe: 5,
  gutter: 6,
  binding: '骑马订',
  grain: '纵向',
}

export const seedPages: Page[] = [
  { pageNo: 1, name: '封面', width: 210, height: 297, bleed: 3, content: '潮汐来信 / 节目册' },
  { pageNo: 2, name: '版权页', width: 210, height: 297, bleed: 2, content: '版权与演职人员' },
  { pageNo: 3, name: '序言', width: 210, height: 297, bleed: 3, content: '导演手记' },
  { pageNo: 4, name: '剧照跨页左', width: 210, height: 297, bleed: 3, content: '第一幕剧照' },
  { pageNo: 5, name: '剧照跨页右', width: 210, height: 297, bleed: 3, content: '第一幕剧照延伸' },
  { pageNo: 6, name: '曲目表', width: 210, height: 297, bleed: 3, content: '曲目与时长' },
  { pageNo: 7, name: '创作团队', width: 210, height: 297, bleed: 1, content: '主创与制作团队' },
  { pageNo: 8, name: '封底', width: 210, height: 297, bleed: 3, content: '巡演信息' },
]

export const seedPositions: Position[] = [
  { id: 'P-01', pageNo: 8, x: 34, y: 44, rotation: 0, front: true },
  { id: 'P-02', pageNo: 1, x: 372, y: 44, rotation: 180, front: true },
  { id: 'P-03', pageNo: 6, x: 34, y: 548, rotation: 180, front: true },
  { id: 'P-04', pageNo: 3, x: 372, y: 548, rotation: 0, front: true },
  { id: 'P-05', pageNo: 2, x: 34, y: 44, rotation: 0, front: false },
  { id: 'P-06', pageNo: 7, x: 372, y: 44, rotation: 180, front: false },
  { id: 'P-07', pageNo: 4, x: 34, y: 548, rotation: 0, front: false },
  { id: 'P-08', pageNo: 5, x: 372, y: 548, rotation: 180, front: false },
]

// R5 基线由第 1 轮打样通过后解锁；第 2 轮待决定，将解锁 R6
export const seedProofs: Proof[] = [
  { id: 'PRF-01', round: 1, date: '2026-09-18', sample: '数字样张 v1', deltaE: 1.2, feedback: '首版封面蓝偏紫、暗部层次压缩，修正 CMYK 曲线并对 P7 增加出血后复验通过。', correction: 'CMYK 曲线修正，黑色通道减少 4%；P7 版位重排并补足 3mm 出血。', owner: '周默 / 色彩管理', decision: '通过' },
  { id: 'PRF-02', round: 2, date: '2026-09-25', sample: '数字样张 v2', deltaE: 1.9, feedback: '整体色差改善，P7 出血仍不足，跨页折手间距需按 6mm 收紧。', correction: 'P7 右移 18mm 并增加 2mm 出血；P4/P5 跨页间距收紧 4mm。', owner: '林青 / 拼版', decision: '待决定' },
]

// ---------- 基线快照与 R6 候选差异 ----------

export type BaselineState = { pages: Page[]; positions: Position[]; proofs: Proof[]; spec: typeof sheetSpec }

/** R5 已锁定基线：P7 仍在原位、出血 1mm，折手间距 10mm */
export function r5Snapshot(): BaselineState {
  return {
    pages: structuredClone(seedPages),
    positions: structuredClone(seedPositions),
    proofs: structuredClone(seedProofs),
    spec: { ...sheetSpec, gutter: 10 },
  }
}

/** R6 候选相对 R5 的真实差异（第 2 轮打样修正内容） */
export function applyR6Deltas(pages: Page[], positions: Position[]) {
  const page7 = pages.find((item) => item.pageNo === 7)
  if (page7) page7.bleed = 3
  const position7 = positions.find((item) => item.pageNo === 7 && item.front === false)
  if (position7) position7.x = 52
}

// ---------- 分片输入哈希（按依赖范围分别哈希，决定版本变更后分片复用/作废） ----------

export function scopeHashes(state: BaselineState): Record<string, string> {
  const { pages, positions, proofs, spec } = state
  const page = (no: number) => pages.find((item) => item.pageNo === no)
  const pos = (no: number) => positions.filter((item) => item.pageNo === no)
  return {
    'raster-1': hashJson([1, 2, 3, 4].map((no) => ({ page: page(no), positions: pos(no) }))),
    'raster-2': hashJson([5, 6, 7, 8].map((no) => ({ page: page(no), positions: pos(no) }))),
    validation: hashJson({ pages: pages.map((item) => ({ pageNo: item.pageNo, bleed: item.bleed })), positions, spec: { bleed: spec.bleed, safe: spec.safe, gutter: spec.gutter } }),
    impose: hashJson(positions.map((item) => ({ pageNo: item.pageNo, x: item.x, y: item.y, rotation: item.rotation, front: item.front }))),
    colorbar: hashJson({ spec }),
    pdf: hashJson({ pages, positions, spec }),
    precheck: hashJson({ pages: pages.map((item) => ({ pageNo: item.pageNo, bleed: item.bleed })), positions: positions.map((item) => ({ pageNo: item.pageNo, x: item.x, y: item.y, rotation: item.rotation, front: item.front })), spec: { bleed: spec.bleed, safe: spec.safe, binding: spec.binding } }),
    proof: hashJson(proofs.map((item) => ({ id: item.id, round: item.round, decision: item.decision, deltaE: item.deltaE }))),
  }
}

const SHARD_DEFS: Record<ExportTask['kind'], { scope: string; label: string }[]> = {
  package: [
    { scope: 'raster-1', label: '页面栅格化 P1–P4' },
    { scope: 'raster-2', label: '页面栅格化 P5–P8' },
    { scope: 'validation', label: '出血与安全区校验' },
    { scope: 'impose', label: '折手与版序拼版' },
    { scope: 'colorbar', label: '色彩控制条输出' },
    { scope: 'pdf', label: 'PDF/X-4 封装' },
    { scope: 'precheck', label: '预检报告 JSON' },
    { scope: 'proof', label: '打样审批记录' },
  ],
  proof: [
    { scope: 'raster-1', label: '低分辨率栅格 P1–P4' },
    { scope: 'raster-2', label: '低分辨率栅格 P5–P8' },
    { scope: 'colorbar', label: '色彩控制条预览' },
    { scope: 'proof', label: '打样审批记录' },
  ],
}

function outputHashFor(shard: Shard, tag = 'out:v1'): string {
  return hashJson(`${shard.id}:${shard.inputHash}:${tag}`)
}

export function makeShards(kind: ExportTask['kind'], hashes: Record<string, string>, doneCount: number): Shard[] {
  return SHARD_DEFS[kind].map((def, index) => {
    const done = index < doneCount
    const shard: Shard = {
      id: `SH-${kind}-${index}`,
      index,
      label: def.label,
      scope: def.scope,
      inputHash: hashes[def.scope],
      status: done ? 'done' : 'pending',
      reused: false,
      completedAt: done ? '09-25 15:18' : undefined,
    }
    if (done) shard.outputHash = outputHashFor(shard)
    return shard
  })
}

export function createTask(kind: ExportTask['kind'], name: string, revision: string, hashes: Record<string, string>): ExportTask {
  return {
    id: `EXP-${Date.now().toString().slice(-6)}`,
    name,
    revision,
    kind,
    progress: 0,
    status: '排队中',
    updatedAt: '刚刚',
    resumable: true,
    shards: makeShards(kind, hashes, 0),
  }
}

// ---------- 交接台账（基线确认 / 冲突留档 / 迁移哈希 / 交接记录） ----------

const LEDGER_KEY = 'print-handoff-v1'
export const TAB_ID = `tab-${Math.random().toString(36).slice(2, 7)}`

function loadLedger(): Ledger {
  const raw = localStorage.getItem(LEDGER_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.confirmed)) return reactive({ ...parsed, remoteNotice: null })
    } catch {
      // 台账损坏时从空账重建
    }
  }
  return reactive({ confirmed: [], conflicts: [], migrations: [], handoffs: [], remoteNotice: null })
}

export const ledger = loadLedger()

watch(ledger, (value) => {
  localStorage.setItem(LEDGER_KEY, JSON.stringify({
    confirmed: value.confirmed,
    conflicts: value.conflicts,
    migrations: value.migrations,
    handoffs: value.handoffs,
  }))
}, { deep: true })

function nowStamp(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

/** 初始基线 R5 由第 1 轮打样通过解锁 */
export function seedLedgerIfEmpty() {
  if (ledger.confirmed.length) return
  const snap = r5Snapshot()
  ledger.confirmed.push({
    id: 'VER-R5',
    revision: 'R5',
    unlockedBy: { proofId: 'PRF-01', round: 1, sample: seedProofs[0].sample },
    baselineHash: hashJson(snap),
    lockedAt: '2026-09-18 17:05',
    tabId: 'system',
  })
}

// ---------- 多标签页协调：先确认的基线生效，后到内容只作冲突留档 ----------

type BaselineSubmission = {
  baseRevision: string
  baseHash: string
  payloadHash: string
  unlockProof: { proofId: string; round: number; sample: string }
  payload: Record<string, unknown>
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('print-handoff') : null

channel?.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type?: string; record?: VersionRecord; conflict?: ConflictRecord }
  if (msg?.type === 'baseline-confirmed' && msg.record) {
    if (!ledger.confirmed.some((item) => item.revision === msg.record!.revision)) {
      ledger.confirmed.push(msg.record)
      ledger.remoteNotice = `其他标签页已确认基线 ${msg.record.revision}（由第 ${msg.record.unlockedBy.round} 轮打样解锁）`
    }
  }
  if (msg?.type === 'conflict-archived' && msg.conflict) {
    if (!ledger.conflicts.some((item) => item.id === msg.conflict!.id)) ledger.conflicts.push(msg.conflict)
  }
})

export function submitBaseline(submission: BaselineSubmission): { ok: true; record: VersionRecord } | { ok: false; conflict: ConflictRecord } {
  const tip = ledger.confirmed[ledger.confirmed.length - 1]
  const stamp = nowStamp()
  if (tip && submission.baseRevision === tip.revision && submission.baseHash === tip.baselineHash) {
    const num = Number(tip.revision.slice(1)) + 1
    const record: VersionRecord = {
      id: `VER-R${num}`,
      revision: `R${num}`,
      unlockedBy: submission.unlockProof,
      baselineHash: submission.payloadHash,
      lockedAt: stamp,
      tabId: TAB_ID,
    }
    ledger.confirmed.push(record)
    ledger.remoteNotice = null
    channel?.postMessage({ type: 'baseline-confirmed', record })
    return { ok: true, record }
  }
  const conflict: ConflictRecord = {
    id: `CF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    at: stamp,
    tabId: TAB_ID,
    baseRevision: submission.baseRevision,
    baseHash: submission.baseHash,
    payloadHash: submission.payloadHash,
    reason: tip ? `基线已由其他标签页推进至 ${tip.revision}，先确认的基线生效，后到内容不覆盖基线` : '当前无已确认基线',
    payload: submission.payload,
  }
  ledger.conflicts.push(conflict)
  channel?.postMessage({ type: 'conflict-archived', conflict })
  return { ok: false, conflict }
}

// ---------- 版本变更后分片重算：输入哈希不变 → 复用；变化 → 作废待重算 ----------

export function recomputeTask(task: ExportTask, hashes: Record<string, string>): { reused: number; invalidated: number } {
  let reused = 0
  let invalidated = 0
  task.shards.forEach((shard) => {
    if (shard.status !== 'done') return
    if (hashes[shard.scope] === shard.inputHash) {
      shard.reused = true
      reused += 1
    } else {
      shard.status = 'stale'
      shard.outputHash = undefined
      shard.reused = false
      invalidated += 1
    }
  })
  const done = task.shards.filter((shard) => shard.status === 'done').length
  task.progress = Math.round((done / task.shards.length) * 100)
  if (task.status !== '已完成') task.status = task.progress === 100 ? '已完成' : '已中断'
  return { reused, invalidated }
}

export function recomputeAllTasks(tasks: ExportTask[], hashes: Record<string, string>, toRevision: string) {
  tasks.forEach((task) => {
    if (task.status === '已完成') return
    const fromRevision = task.revision
    const { reused, invalidated } = recomputeTask(task, hashes)
    task.revision = toRevision
    if (reused > 0 || invalidated > 0) {
      ledger.handoffs.push({
        id: `HO-${Date.now().toString(36)}-${task.id}`,
        at: nowStamp(),
        fromRevision,
        toRevision,
        taskId: task.id,
        taskName: task.name,
        reused,
        invalidated,
      })
    }
  })
}

// ---------- 旧数据迁移到新结构并留下哈希 ----------

type LegacyTask = { id: string; name: string; progress: number; status: ExportTask['status']; updatedAt: string; resumable: boolean }
type LegacyShape = {
  schema?: string
  revision?: string
  pages: Page[]
  positions: Position[]
  proofs: Proof[]
  tasks: LegacyTask[]
}

const LEGACY_RAW: LegacyShape = {
  schema: 'print-imposition-v0',
  revision: 'R5',
  pages: structuredClone(seedPages),
  positions: structuredClone(seedPositions),
  proofs: structuredClone(seedProofs),
  tasks: [
    { id: 'EXP-0925-01', name: '印刷交付包 · PDF/X-4', progress: 72, status: '已中断', updatedAt: '09-25 16:42', resumable: true },
    { id: 'EXP-0925-02', name: '数字样张低分辨率预览', progress: 100, status: '已完成', updatedAt: '09-25 15:18', resumable: false },
  ],
}

function kindOf(name: string): ExportTask['kind'] {
  return name.includes('预览') ? 'proof' : 'package'
}

function migrateTasks(legacyTasks: LegacyTask[], hashes: Record<string, string>): ExportTask[] {
  return legacyTasks.map((task) => {
    const kind = kindOf(task.name)
    const total = SHARD_DEFS[kind].length
    const doneCount = task.status === '已完成' ? total : kind === 'package' ? 6 : total
    const shards = makeShards(kind, hashes, doneCount)
    return {
      id: task.id,
      name: task.name,
      kind,
      revision: 'R5',
      progress: Math.round((doneCount / total) * 100),
      status: task.status === '已完成' ? '已完成' : '已中断',
      updatedAt: task.updatedAt,
      resumable: task.resumable,
      shards,
    }
  })
}

function recordMigration(fromShape: string, toShape: string, fromHash: string, toHash: string, summary: string) {
  ledger.migrations.push({
    id: `MG-${Date.now().toString(36)}`,
    at: nowStamp(),
    fromShape,
    toShape,
    fromHash,
    toHash,
    summary,
  })
}

function migrateLegacy(raw: LegacyShape) {
  const snap = r5Snapshot()
  const hashes = scopeHashes(snap)
  const tasks = migrateTasks(raw.tasks, hashes)
  const pages = structuredClone(raw.pages ?? seedPages)
  const positions = structuredClone(raw.positions ?? seedPositions)
  applyR6Deltas(pages, positions)
  const migrated = { pages, positions, proofs: structuredClone(raw.proofs ?? seedProofs), tasks }
  recordMigration('print-imposition-v0（任务无分片、版本无解锁记录）', 'print-imposition-v2（分片 + 版本交接台账）', hashJson(raw), hashJson(migrated), `${tasks.length} 个任务重建分片结构，旧进度按 R5 输入哈希核对复用`)
  return migrated
}

function migrateV1(v1: LegacyShape) {
  const hashes = scopeHashes(r5Snapshot())
  const tasks = migrateTasks(v1.tasks, hashes)
  const migrated = { pages: structuredClone(v1.pages), positions: structuredClone(v1.positions), proofs: structuredClone(v1.proofs), tasks }
  recordMigration('print-imposition-v1（旧分片结构）', 'print-imposition-v2（分片 + 版本交接台账）', hashJson(v1), hashJson(migrated), `${tasks.length} 个任务补齐分片与版本绑定，旧进度按 R5 输入哈希核对复用`)
  return migrated
}

// ---------- 启动引导 ----------

const STORE_V1_KEY = 'print-imposition-v1'
const STORE_V2_KEY = 'print-imposition-v2'

export type BootState = {
  pages: Page[]
  positions: Position[]
  proofs: Proof[]
  tasks: ExportTask[]
  revision: string
}

function bootstrap(): BootState {
  seedLedgerIfEmpty()
  const v2 = localStorage.getItem(STORE_V2_KEY)
  if (v2) {
    try {
      const parsed = JSON.parse(v2)
      if (Array.isArray(parsed.tasks) && parsed.pages) {
        return { pages: parsed.pages, positions: parsed.positions, proofs: parsed.proofs, tasks: parsed.tasks, revision: parsed.revision ?? 'R6' }
      }
    } catch {
      // 落入旧结构迁移
    }
  }
  const v1 = localStorage.getItem(STORE_V1_KEY)
  if (v1) {
    try {
      const parsed = JSON.parse(v1) as LegacyShape
      if (parsed.pages && Array.isArray(parsed.tasks)) {
        const migrated = migrateV1(parsed)
        return { ...migrated, revision: parsed.revision ?? 'R6' }
      }
    } catch {
      // 落入 v0 迁移
    }
  }
  const migrated = migrateLegacy(LEGACY_RAW)
  return { ...migrated, revision: 'R6' }
}

export const boot = bootstrap()

// 任务状态由 store 与导出 API 共用同一份引用
export const exportTasks = ref<ExportTask[]>(boot.tasks)
