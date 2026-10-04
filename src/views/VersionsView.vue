<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import ImpositionCanvas from '../components/ImpositionCanvas.vue'
import { useImpositionStore } from '../stores/imposition'
import { ledger, submitBaseline, recomputeAllTasks, scopeHashes, r5Snapshot, hashJson, sheetSpec, TAB_ID } from '../handoff'

const store = useImpositionStore()
const accepted = ref(['CH-01', 'CH-02'])
const changes = [
  { id: 'CH-01', title: 'P7 右移 18mm 并增加 2mm 出血', before: 'x 34 / bleed 1mm', after: 'x 52 / bleed 3mm', risk: '中' },
  { id: 'CH-02', title: 'P4/P5 跨页按 6mm 折手收紧', before: 'gutter 10mm', after: 'gutter 6mm', risk: '中' },
  { id: 'CH-03', title: 'P2 版权页低出血文件放行', before: 'bleed 2mm', after: 'bleed 1mm', risk: '高' },
]

const r5 = r5Snapshot()
const r6Hashes = scopeHashes({ pages: store.pages, positions: store.positions, proofs: store.proofs, spec: sheetSpec })

const lockError = ref<string | null>(null)
const lockOk = ref<string | null>(null)

function confirmLock() {
  lockError.value = null
  lockOk.value = null
  const result = store.confirmBaseline()
  if (result.ok) lockOk.value = `基线 ${store.revision} 已确认：由第 ${store.proofs.find((p) => p.decision === '通过')?.round ?? 2} 轮打样解锁，在途任务分片已按新版本重算。`
  else lockError.value = result.reason ?? '提交未生效'
}

// 两个标签页同时提交基线锁定：先确认的基线生效，后到内容只作冲突留档
const simResult = ref<{ aOk: boolean; bArchived: boolean; revision?: string } | null>(null)
function simulateConcurrent() {
  const tip = ledger.confirmed[ledger.confirmed.length - 1]
  const unlock = store.proofs.find((proof) => proof.id === 'PRF-02')!
  const baseRevision = tip.revision
  const baseHash = tip.baselineHash
  const payloadHash = hashJson({ pages: store.pages, positions: store.positions, proofs: store.proofs, spec: sheetSpec })
  const unlockProof = { proofId: unlock.id, round: unlock.round, sample: unlock.sample }
  // 标签页 A 先确认
  const a = submitBaseline({ baseRevision, baseHash, payloadHash, unlockProof, payload: { tab: 'A', accepted: accepted.value } })
  // 标签页 B 后到，基于同一旧基线
  const b = submitBaseline({ baseRevision, baseHash, payloadHash, unlockProof, payload: { tab: 'B', accepted: accepted.value } })
  if (a.ok) {
    unlock.decision = '通过'
    store.locked = true
    store.revision = a.record.revision
    recomputeAllTasks(store.tasks, r6Hashes, a.record.revision)
  }
  simResult.value = { aOk: a.ok, bArchived: !b.ok, revision: a.ok ? a.record.revision : undefined }
}

const currentTip = computed(() => ledger.confirmed[ledger.confirmed.length - 1])
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">VERSION COMPARE / 版本对比</p><h1>拼版版本并排审阅</h1><p class="muted">基线 {{ currentTip?.revision }} 与候选 R6 对比；打样通过后锁定新版本，旧分片与未完成结果失效重算，可复用进度保留。</p></div>
      <div class="actions">
        <Button label="导出对比报告" icon="pi pi-file-export" outlined />
        <Button :label="store.locked ? '已锁定' : '接受变更并锁定'" icon="pi pi-lock" :disabled="store.locked || accepted.length === 0" @click="confirmLock" />
      </div>
    </div>

    <Message v-if="lockOk" severity="success" :closable="false" class="mb-3">{{ lockOk }}</Message>
    <Message v-if="lockError" severity="warn" :closable="false" class="mb-3">{{ lockError }}；后到内容已在下方冲突留档。</Message>
    <Message v-if="ledger.remoteNotice" severity="info" :closable="false" class="mb-3">
      <i class="pi pi-bolt" /> {{ ledger.remoteNotice }}（当前标签页 {{ TAB_ID }}）
    </Message>

    <div class="compare-grid">
      <section class="panel">
        <div class="panel-head"><h3>基线 {{ currentTip?.revision ?? 'R5' }}</h3><Tag value="只读" /></div>
        <div class="canvas-box"><ImpositionCanvas :positions="r5.positions" side="front" :zoom="38" :selected="null" :validations="[]" @update="() => {}" @select="() => {}" /></div>
      </section>
      <section class="panel candidate">
        <div class="panel-head"><h3>候选 R6</h3><Tag value="2 项变更" severity="warn" /></div>
        <div class="canvas-box"><ImpositionCanvas :positions="store.positions" side="front" :zoom="38" :selected="null" :validations="store.validations" @update="() => {}" @select="() => {}" /></div>
      </section>
    </div>

    <section class="panel change-panel">
      <div class="panel-head"><h3>版式变更差异</h3><span class="muted">接受 {{ accepted.length }}/{{ changes.length }} 项</span></div>
      <div class="change-list">
        <article v-for="change in changes" :key="change.id">
          <Checkbox v-model="accepted" :inputId="change.id" :value="change.id" />
          <div><strong>{{ change.id }} · {{ change.title }}</strong><div class="diff"><span class="before">{{ change.before }}</span><i class="pi pi-arrow-right" /><span class="after">{{ change.after }}</span></div></div>
          <Tag :value="`${change.risk}风险`" :severity="change.risk === '高' ? 'danger' : change.risk === '中' ? 'warn' : 'success'" />
        </article>
      </div>
    </section>

    <section class="panel concurrency-panel">
      <div class="panel-head"><h3>多标签页并发提交</h3><Tag value="先确认的基线生效" severity="info" /></div>
      <div class="concurrency-body">
        <p class="muted">两个标签页基于同一基线同时提交锁定：先确认的基线生效，后到内容不覆盖基线，只作冲突留档。</p>
        <div class="tab-row">
          <div class="tab-card"><strong>标签页 A（前台）</strong><small>基线 {{ currentTip?.revision }} · 哈希 {{ currentTip?.baselineHash.slice(0, 10) }}</small><Tag value="先提交" severity="success" /></div>
          <div class="tab-card"><strong>标签页 B（后台）</strong><small>基线 {{ currentTip?.revision }} · 哈希相同</small><Tag value="后提交" severity="warn" /></div>
        </div>
        <Button label="同时提交基线锁定" icon="pi pi-bolt" outlined @click="simulateConcurrent" />
        <div v-if="simResult" class="sim-result">
          <Message v-if="simResult.aOk" severity="success" :closable="false">标签页 A 先确认：基线 {{ simResult.revision }} 生效，第 2 轮打样解锁，在途任务分片已重算。</Message>
          <Message v-else severity="warn" :closable="false">标签页 A 的提交也已留档：基线在此前已被其他标签页推进。</Message>
          <Message v-if="simResult.bArchived" severity="warn" :closable="false">标签页 B 后到：基线已被 A 推进，提交未生效，内容已写入冲突留档。</Message>
        </div>
      </div>
    </section>

    <section class="panel conflict-panel">
      <div class="panel-head"><h3>冲突留档</h3><Tag :value="`${ledger.conflicts.length} 条未生效提交`" severity="warn" /></div>
      <div v-if="!ledger.conflicts.length" class="empty-note">暂无冲突。两个标签页同时提交时，后到内容会完整留档（含载荷哈希），但不改变基线。</div>
      <div v-for="conflict in ledger.conflicts" :key="conflict.id" class="conflict-row">
        <div class="conflict-head">
          <strong>{{ conflict.tabId }}</strong>
          <Tag value="未生效" severity="warn" />
        </div>
        <small>{{ conflict.at }} · 基于 {{ conflict.baseRevision }} · 基线哈希 {{ conflict.baseHash.slice(0, 10) }} · 载荷哈希 {{ conflict.payloadHash.slice(0, 10) }}</small>
        <p>{{ conflict.reason }}</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; }
.mb-3 { margin-bottom: 12px; }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.candidate { border-color: #5d9693; }
.canvas-box { height: 440px; overflow: auto; padding: 12px; background: #35474d; }
.change-panel { overflow: hidden; margin-bottom: 14px; }
.change-list article { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center; padding: 14px 16px; border-bottom: 1px solid #edf1f1; }
.change-list strong { font-size: 12px; }
.diff { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-family: monospace; font-size: 10px; }
.diff span { padding: 4px 6px; border-radius: 4px; }
.before { color: #9f4c38; background: #fff0ec; }
.after { color: #2d735b; background: #e9f5ef; }
.concurrency-panel, .conflict-panel { margin-bottom: 14px; }
.concurrency-body { padding: 14px 16px; }
.concurrency-body p { margin: 0 0 12px; font-size: 12px; }
.tab-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.tab-card { display: grid; gap: 4px; padding: 12px; border: 1px solid #dce3e4; border-radius: 8px; background: #f8fafa; }
.tab-card strong { font-size: 12px; }
.tab-card small { color: #7a878d; font-size: 10px; }
.sim-result { display: grid; gap: 8px; margin-top: 12px; }
.empty-note { padding: 18px 16px; color: #8a999d; font-size: 11px; line-height: 1.6; }
.conflict-row { padding: 10px 16px; border-bottom: 1px solid #edf1f1; }
.conflict-head { display: flex; align-items: center; justify-content: space-between; }
.conflict-row strong { font-size: 12px; }
.conflict-row small { display: block; margin-top: 3px; color: #7a878d; font-size: 10px; }
.conflict-row p { margin: 6px 0 0; color: #8a6a5a; font-size: 10px; line-height: 1.5; }
@media (max-width: 1000px) { .compare-grid { grid-template-columns: 1fr; } .tab-row { grid-template-columns: 1fr; } }
</style>
