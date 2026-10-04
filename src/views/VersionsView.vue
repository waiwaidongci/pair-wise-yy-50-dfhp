<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import ImpositionCanvas from '../components/ImpositionCanvas.vue'
import { useImpositionStore } from '../stores/imposition'
import { shortHash } from '../production/handoff'

const store = useImpositionStore()
const unlockWithProof = ref<string | null>(null)
const lockResult = ref<string | null>(null)

const sortedVersions = computed(() => store.versions.slice().reverse())
const changes = computed(() => store.summarizeChanges())
const reuse = computed(() => store.currentReuse)
const proofOptions = computed(() => store.proofs.slice().reverse())

function proofOf(versionId: string) {
  const version = store.versions.find((item) => item.id === versionId)
  return store.proofs.find((proof) => proof.id === version?.unlockProofId) ?? null
}

function confirmLock(rival?: string) {
  const outcome = store.lockBaseline({
    unlockProofId: unlockWithProof.value ?? undefined,
    ...(rival ? { otherClient: { label: rival, lagMs: 260 } } : {}),
  })
  if ('queued' in outcome) {
    lockResult.value = rival
      ? `两个标签页几乎同时提交：等待“${rival}”与本页按确认顺序裁决…`
      : null
  } else if (!outcome.ok) {
    lockResult.value = `本页提交晚于已确认基线，内容已进入冲突留档（${outcome.conflict?.id}），未覆盖生产基线。`
  } else {
    lockResult.value = `已确认 ${outcome.version?.id}，由 ${proofOf(outcome.version!.id)?.round ? `第${proofOf(outcome.version!.id)!.round}轮打样` : '打样'}解锁；旧任务对账：复用 ${outcome.reconciliation.reduce((sum, item) => sum + item.reused, 0)} 组、作废 ${outcome.reconciliation.reduce((sum, item) => sum + item.invalidated, 0)} 组。`
  }
  unlockWithProof.value = null
}

function discardConflict(id: string) {
  store.discardConflict(id)
}
function restoreConflict(id: string) {
  store.restoreConflictContent(id)
  lockResult.value = '已把留档内容载入工作区草稿（未锁定），可修正后重新确认。'
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">VERSION HANDOFF / 版本生产交接</p>
        <h1>拼版版本 · 打样解锁 · 基线确认</h1>
        <p class="muted">每个版本记录解锁打样轮次与内容哈希；两个标签页同时确认时，先确认者生效，后到内容仅作冲突留档。</p>
      </div>
      <Tag :value="store.locked ? `基线 ${store.revision} 已锁定` : '修订中（未锁定）'" :severity="store.locked ? 'success' : 'warn'" />
    </div>

    <div class="version-chain panel">
      <div class="panel-head"><h3>版本解锁链</h3><span class="muted">新版本锁定后旧分片按哈希对账</span></div>
      <div class="chain">
        <template v-for="(version, index) in sortedVersions" :key="version.id">
          <article :class="{ current: version.status === '已锁定', draft: version.status === '候选' }">
            <header><strong>{{ version.id }}</strong><Tag :value="version.status" :severity="version.status === '已锁定' ? 'success' : version.status === '候选' ? 'warn' : 'secondary'" /></header>
            <div class="proof-cell">
              <template v-if="proofOf(version.id)">
                <i class="pi pi-image" />
                <div><strong>第 {{ proofOf(version.id)!.round }} 轮打样解锁</strong><small>{{ proofOf(version.id)!.sample }} · {{ proofOf(version.id)!.decision }} · ΔE {{ proofOf(version.id)!.deltaE }}</small></div>
              </template>
              <small v-else class="muted">未关联打样</small>
            </div>
            <small v-if="version.parentId" class="muted">父版本 {{ version.parentId }}</small>
            <small class="muted">{{ version.lockedByClientLabel ?? '—' }} 确认</small>
            <small class="mono">内容 {{ shortHash(version.contentHash, 10) }}</small>
            <ul><li v-for="(line, lineIndex) in version.changeSummary.slice(0, 3)" :key="lineIndex">{{ line }}</li></ul>
          </article>
          <i v-if="index < sortedVersions.length - 1" class="pi pi-angle-right chain-arrow" />
        </template>
      </div>
    </div>

    <Message v-if="store.lastIncomingLock" severity="info" :closable="false" class="mb-3">
      <template #icon><i class="pi pi-bell" /></template>
      {{ store.lastIncomingLock }}
      <Button label="知道了" text size="small" style="margin-left: 10px" @click="store.dismissIncomingNotice()" />
    </Message>
    <Message v-if="lockResult" severity="warn" :closable="false" class="mb-3" @close="lockResult = null">
      <template #icon><i class="pi pi-lock" /></template>{{ lockResult }}
    </Message>

    <div class="compare-grid">
      <section class="panel">
        <div class="panel-head"><h3>已锁定基线 {{ store.revision }}</h3><Tag value="只读" /></div>
        <div class="canvas-box">
          <ImpositionCanvas
            :positions="store.baseline?.snapshot?.positions ?? store.positions" side="front" :zoom="38"
            :selected="null" :validations="[]" @update="() => {}" @select="() => {}"
          />
        </div>
        <p class="canvas-note" v-if="store.baseline">由第 {{ proofOf(store.baseline.id)?.round ?? '—' }} 轮打样（{{ proofOf(store.baseline.id)?.decision ?? '—' }}）解锁 · 哈希 {{ shortHash(store.baseline.contentHash, 10) }}</p>
      </section>
      <section class="panel candidate">
        <div class="panel-head"><h3>当前工作区候选</h3><Tag :value="store.dirty ? '有未锁定修订' : '与基线一致'" :severity="store.dirty ? 'warn' : 'success'" /></div>
        <div class="canvas-box">
          <ImpositionCanvas :positions="store.positions" side="front" :zoom="38" :selected="null" :validations="store.validations" @update="() => {}" @select="() => {}" />
        </div>
        <p class="canvas-note">候选哈希 {{ shortHash(store.draftHash, 10) }} · 预计 {{ store.shards.length ? `复用 ${reuse.reused} 组 / 重算 ${reuse.recompute} 组` : '新任务将完整生成' }}</p>
      </section>
    </div>

    <section class="panel change-panel">
      <div class="panel-head"><h3>候选变更摘要</h3><span class="muted">{{ changes.length }} 项</span></div>
      <div class="change-list">
        <div v-for="(line, index) in changes" :key="index" class="change-line"><i class="pi pi-angle-right" />{{ line }}</div>
        <p v-if="!changes.length" class="muted empty-note">当前内容与基线一致。</p>
      </div>
      <div class="confirm-bar">
        <label>
          解锁打样决定
          <select v-model="unlockWithProof">
            <option :value="null">沿用最近一轮（{{ store.proofs.at(-1)?.sample ?? '无' }}）</option>
            <option v-for="proof in proofOptions" :key="proof.id" :value="proof.id">第 {{ proof.round }} 轮 · {{ proof.decision }} · ΔE {{ proof.deltaE }}</option>
          </select>
        </label>
        <Button label="确认基线并锁定（本标签页）" icon="pi pi-lock" :disabled="store.locked && !store.dirty" @click="confirmLock()" />
        <Button label="双标签页同时提交演练" icon="pi pi-bolt" severity="warn" outlined
                tooltip="模拟另一标签页抢先 120ms 确认不同内容，本页提交应只进冲突留档"
                @click="confirmLock('夜班 B 标签页')" />
        <Button v-if="store.locked" label="解锁修订" icon="pi pi-lock-open" severity="secondary" text @click="store.unlock()" />
      </div>
    </section>

    <section class="panel conflict-panel">
      <div class="panel-head"><h3>冲突留档</h3><Tag :value="`${store.conflicts.length} 条`" :severity="store.conflicts.length ? 'danger' : 'success'" /></div>
      <div v-if="!store.conflicts.length" class="empty-conflict muted">暂无后到提交；生产基线只接受先确认的内容。</div>
      <article v-for="record in store.conflicts" :key="record.id" class="conflict-card">
        <div class="conflict-main">
          <strong>{{ record.id }} · {{ record.loserClientLabel }} 的后到内容</strong>
          <p>{{ record.reason }}</p>
          <small class="mono">后到内容哈希 {{ shortHash(record.contentHash, 12) }} · 提交负载 {{ shortHash(record.payloadHash, 12) }} · {{ record.pageCount }} 页 / {{ record.positionCount }} 版位</small>
          <ul><li v-for="(line, index) in record.changeSummary" :key="index">{{ line }}</li></ul>
        </div>
        <div class="conflict-side">
          <Tag :value="`生效基线 ${record.winnerVersionId}`" severity="success" />
          <small class="muted">先确认：{{ record.winnerClientLabel }}</small>
          <Button label="载入为草稿" size="small" text @click="restoreConflict(record.id)" />
          <Button label="仅清除留档" size="small" severity="danger" outlined @click="discardConflict(record.id)" />
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.mb-3 { margin-bottom: 12px; }
.version-chain { margin-bottom: 14px; }
.chain { display: flex; align-items: stretch; gap: 0; padding: 16px; overflow-x: auto; }
.chain article { display: grid; gap: 6px; min-width: 220px; padding: 13px 14px; border: 1px solid #dde5e6; border-radius: 9px; background: #fafbfb; }
.chain article.current { border-color: #3f8f76; background: #eef7f2; box-shadow: inset 0 0 0 1px #3f8f76; }
.chain article.draft { border-style: dashed; border-color: #c98236; }
.chain header { display: flex; align-items: center; justify-content: space-between; }
.proof-cell { display: flex; gap: 8px; align-items: flex-start; padding: 8px; background: white; border-radius: 6px; }
.proof-cell i { color: #c98236; margin-top: 2px; }
.proof-cell strong, .proof-cell small { display: block; font-size: 10px; }
.proof-cell small { margin-top: 3px; color: #7a878e; line-height: 1.5; }
.mono { font-family: monospace; font-size: 9px; color: #6f7d83; }
.chain ul { margin: 4px 0 0; padding-left: 16px; color: #5e6e75; font-size: 10px; line-height: 1.5; }
.chain-arrow { align-self: center; padding: 0 8px; color: #94a4a8; }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.candidate { border-color: #5d9693; }
.canvas-box { height: 380px; overflow: auto; padding: 12px; background: #35474d; }
.canvas-note { margin: 0; padding: 10px 14px; font-size: 10px; color: #66757c; border-top: 1px solid #edf1f1; }
.change-panel { margin-bottom: 14px; }
.change-list { padding: 10px 16px; display: grid; gap: 6px; }
.change-line { display: flex; gap: 7px; align-items: baseline; font-size: 12px; color: #40545b; }
.change-line i { color: #c98236; font-size: 9px; }
.empty-note { padding: 4px 0; font-size: 11px; }
.confirm-bar { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; padding: 12px 16px 16px; border-top: 1px solid #edf1f1; }
.confirm-bar label { display: grid; gap: 5px; font-size: 10px; font-weight: 700; color: #5e6e75; }
.confirm-bar select { padding: 8px 10px; border: 1px solid #cbd5d7; border-radius: 6px; font: inherit; min-width: 230px; }
.conflict-panel .panel-head { border-bottom: 1px solid #f3d9d0; }
.empty-conflict { padding: 20px; text-align: center; font-size: 12px; }
.conflict-card { display: grid; grid-template-columns: minmax(0,1fr) 200px; gap: 16px; padding: 16px; border-bottom: 1px solid #f4e6e1; }
.conflict-main p { margin: 7px 0; color: #6d4a3e; font-size: 12px; line-height: 1.6; }
.conflict-main small { display: block; }
.conflict-main ul { margin: 8px 0 0; padding-left: 17px; font-size: 11px; color: #7d6055; line-height: 1.6; }
.conflict-side { display: grid; gap: 8px; align-content: start; justify-items: start; border-left: 1px solid #f0e0da; padding-left: 16px; }
.conflict-side small { font-size: 10px; }
@media (max-width: 1000px) { .compare-grid { grid-template-columns: 1fr; } .conflict-card { grid-template-columns: 1fr; } }
</style>
