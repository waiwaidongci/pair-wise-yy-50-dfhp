<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useImpositionStore } from '../stores/imposition'
import { labelTime, shortHash } from '../production/handoff'

const store = useImpositionStore()
const errors = computed(() => store.validations.filter((item) => item.severity === '错误').length)
const pendingProof = computed(() => store.proofs.find((proof) => proof.decision === '待决定'))
const recoverable = computed(() => store.tasks.filter((task) => task.resumable && task.status !== '已完成'))
const shardStats = computed(() => {
  const activeVersion = store.baseline?.id
  let reused = 0
  let fresh = 0
  let failed = 0
  store.shards
    .filter((shard) => shard.versionId === activeVersion)
    .forEach((shard) => {
      if (shard.status === '已完成' && shard.source !== '本次生成') reused += 1
      else if (shard.status === '已完成') fresh += 1
      else if (shard.status === '生成失败') failed += 1
    })
  const voided = store.shards.filter((shard) => shard.status === '作废').length
  return { reused, fresh, failed, voided }
})

function proofOf(versionId: string) {
  const version = store.versions.find((item) => item.id === versionId)
  return store.proofs.find((proof) => proof.id === version?.unlockProofId) ?? null
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">PRINT PRODUCTION / 生产交接总览</p>
        <h1>拼版版本 · 打样决定 · 导出任务一屏掌握</h1>
        <p class="muted">新版本锁定即触发生产交接：旧分片作废或按哈希复用，导出任务从断点续算。</p>
      </div>
      <div class="actions"><Button label="进入拼版工作区" icon="pi pi-th-large" @click="$router.push('/imposition')" /><Button label="确认生产基线" icon="pi pi-lock" @click="$router.push('/versions')" /></div>
    </div>

    <Message v-if="store.lastIncomingLock" severity="info" :closable="false" class="mb-3">
      <template #icon><i class="pi pi-bell" /></template>{{ store.lastIncomingLock }}
      <Button label="知道了" text size="small" style="margin-left: 10px" @click="store.dismissIncomingNotice()" />
    </Message>
    <Message v-if="store.conflicts.length" severity="warn" :closable="false" class="mb-3">
      <template #icon><i class="pi pi-bolt" /></template>
      有 {{ store.conflicts.length }} 条并行确认的后到内容仅作冲突留档，未影响已生效基线。
      <Button label="查看留档" text size="small" style="margin-left: 10px" @click="$router.push('/versions')" />
    </Message>

    <div class="metric-grid">
      <article class="metric"><span>生产基线</span><strong>{{ store.revision }}</strong><small>{{ store.locked ? '已锁定 · 只读' : '候选修订中' }} · {{ shortHash(store.baseline?.contentHash ?? store.draftHash, 10) }}</small></article>
      <article class="metric"><span>解锁打样</span><strong>{{ proofOf(store.baseline?.id ?? '')?.round ? `第${proofOf(store.baseline!.id)!.round}轮` : '未关联' }}</strong><small>{{ proofOf(store.baseline?.id ?? '')?.decision ?? '—' }} · ΔE {{ proofOf(store.baseline?.id ?? '')?.deltaE ?? '—' }}</small></article>
      <article class="metric"><span>分片复用 / 作废</span><strong>{{ shardStats.reused }} / {{ shardStats.voided }}</strong><small>本次新生成 {{ shardStats.fresh }} 组<template v-if="shardStats.failed"> · 失败 {{ shardStats.failed }}</template></small></article>
      <article class="metric"><span>待恢复导出</span><strong class="error">{{ recoverable.length }}</strong><small>从最后完成分片继续</small></article>
    </div>

    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head"><h3>版本解锁链与交接状态</h3><Tag :value="`${store.versions.length} 个版本`" severity="info" /></div>
        <div class="version-flow">
          <article v-for="version in store.versions.slice().reverse()" :key="version.id" :class="{ live: version.status === '已锁定' }">
            <div class="flow-top"><strong>{{ version.id }}</strong><Tag :value="version.status" :severity="version.status === '已锁定' ? 'success' : version.status === '候选' ? 'warn' : 'secondary'" /></div>
            <p><i class="pi pi-image" /><template v-if="proofOf(version.id)">第 {{ proofOf(version.id)!.round }} 轮打样 · {{ proofOf(version.id)!.decision }} · {{ proofOf(version.id)!.owner }}</template><template v-else>未关联打样</template></p>
            <small class="mono">{{ shortHash(version.contentHash, 12) }}</small>
            <ul><li v-for="(line, index) in version.changeSummary.slice(0, 2)" :key="index">{{ line }}</li></ul>
          </article>
        </div>
        <div class="checklist">
          <div><i class="pi pi-check-circle" /><span>页面尺寸与成品规格</span><Tag value="通过" severity="success" /></div>
          <div><i class="pi pi-exclamation-triangle warn" /><span>折手与页码顺序</span><Tag value="1 项警告" severity="warn" /></div>
          <div><i :class="errors ? 'pi pi-times-circle error' : 'pi pi-check-circle'" /><span>出血与版位安全区</span><Tag :value="errors ? `${errors} 项错误` : '通过'" :severity="errors ? 'danger' : 'success'" /></div>
          <div><i class="pi pi-sync" /><span>新版本分片对账</span><Tag :value="`复用 ${shardStats.reused} · 作废 ${shardStats.voided}`" severity="info" /></div>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>导出断点</h3><Button label="导出页" text size="small" @click="$router.push('/exports')" /></div>
          <div class="export-mini" v-if="store.tasks.length">
            <div v-for="task in store.tasks" :key="task.id">
              <div><span>{{ task.name }}</span><strong>{{ task.progress }}%</strong></div>
              <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '7px' }" />
              <small>{{ task.status }} · {{ task.versionId }} · {{ labelTime(task.updatedAt) }}<template v-if="task.lastCompletedShardId"> · 续点 {{ task.lastCompletedShardId.split('-SH-')[1] }} 组</template></small>
            </div>
          </div>
          <p v-else class="empty muted">暂无导出任务。</p>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>最近打样</h3><Button label="审批" text size="small" @click="$router.push('/proofs')" /></div>
          <div class="proof-summary">
            <div v-for="proof in store.proofs.slice().reverse().slice(0, 4)" :key="proof.id" class="proof-row">
              <div><strong>第 {{ proof.round }} 轮 · {{ proof.sample }}</strong><small>{{ proof.date }} · ΔE {{ proof.deltaE }}<template v-if="store.versions.some((v) => v.unlockProofId === proof.id)"> · 已解锁版本</template></small></div>
              <Tag :value="proof.decision" :severity="proof.decision === '通过' ? 'success' : proof.decision === '退回' ? 'danger' : 'warn'" />
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>旧数据迁移</h3><Tag :value="`${store.migrations.length} 次`" /></div>
          <div class="migration-mini">
            <div v-for="record in store.migrations" :key="record.id">
              <strong>{{ record.kind }}</strong>
              <small class="mono">源 {{ shortHash(record.sourceHash, 10) }} → 目标 {{ shortHash(record.targetHash, 10) }}</small>
              <small>{{ record.taskCount }} 任务 / {{ record.shardCount }} 分片已挂接新版本结构</small>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mb-3 { margin-bottom: 12px; }
.metric .error { color: #b84e35; }
.overview-grid { display: grid; grid-template-columns: minmax(0,1fr) 350px; gap: 14px; align-items: start; }
.version-flow { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; padding: 16px; }
.version-flow article { display: grid; gap: 6px; padding: 12px; border: 1px solid #dde5e6; border-radius: 8px; background: #fafbfb; }
.version-flow article.live { border-color: #3f8f76; background: #eef7f2; }
.flow-top { display: flex; justify-content: space-between; align-items: center; }
.version-flow p { margin: 0; display: flex; gap: 6px; align-items: center; font-size: 10px; color: #4c6d72; }
.version-flow p i { color: #c98236; }
.version-flow .mono { font-size: 9px; color: #6f7d83; }
.version-flow ul { margin: 2px 0 0; padding-left: 15px; font-size: 10px; color: #5e6e75; line-height: 1.5; }
.checklist { padding: 0 18px 16px; }
.checklist > div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 9px; padding: 11px 0; border-top: 1px solid #ecf0f0; font-size: 12px; }
.checklist i { color: #3b8a67; }
.checklist i.warn { color: #c4872f; }
.checklist i.error { color: #bb4c35; }
aside { display: grid; gap: 14px; }
.proof-summary { padding: 8px 16px 14px; }
.proof-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid #edf1f1; }
.proof-row strong, .proof-row small { display: block; }
.proof-row small { margin-top: 4px; color: #7a898e; font-size: 10px; }
.export-mini { padding: 8px 16px 14px; }
.export-mini > div { padding: 8px 0; }
.export-mini > div > div { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; }
.export-mini small { display: block; margin-top: 5px; color: #7d898e; font-size: 10px; }
.empty { padding: 18px; text-align: center; font-size: 12px; }
.migration-mini { padding: 6px 16px 14px; display: grid; gap: 10px; }
.migration-mini > div { display: grid; gap: 3px; padding: 9px 10px; background: #f6f4ef; border-radius: 5px; }
.migration-mini strong { font-size: 11px; }
.migration-mini small { font-size: 9px; color: #7a7468; }
@media (max-width: 1050px) { .overview-grid { grid-template-columns: 1fr; } }
</style>
