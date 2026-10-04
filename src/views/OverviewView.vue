<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { useImpositionStore } from '../stores/imposition'
import { ledger, type Shard } from '../handoff'

const store = useImpositionStore()
const errors = computed(() => store.validations.filter((item) => item.severity === '错误').length)
const pendingProof = computed(() => store.proofs.find((proof) => proof.decision === '待决定'))
const activeTasks = computed(() => store.tasks.filter((task) => task.status !== '已完成'))
const reusedCount = (task: { shards: Shard[] }) => task.shards.filter((shard) => shard.status === 'done' && shard.reused).length
const invalidCount = (task: { shards: Shard[] }) => task.shards.filter((shard) => shard.status === 'stale' || shard.status === 'failed').length
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">PRINT PRODUCTION / 印刷生产</p><h1>拼版预检与打样总览</h1><p class="muted">在当前拼版版本进入生产前，集中处理页序、出血、色彩与装订风险，并跟踪版本解锁、分片复用与交接留档。</p></div>
      <div class="actions"><Button label="运行完整预检" icon="pi pi-check-circle" outlined /><Button label="进入拼版工作区" icon="pi pi-th-large" @click="$router.push('/imposition')" /></div>
    </div>

    <div class="metric-grid">
      <article class="metric"><span>页面文件</span><strong>{{ store.pages.length }}</strong><small>{{ store.positions.length }} 个已排版位</small></article>
      <article class="metric"><span>预检错误</span><strong class="error">{{ errors }}</strong><small>必须处理后方可锁定</small></article>
      <article class="metric"><span>打样轮次</span><strong>{{ store.proofs.length }}</strong><small>当前 ΔE {{ pendingProof?.deltaE ?? '—' }}</small></article>
      <article class="metric"><span>待恢复导出</span><strong>{{ activeTasks.length }}</strong><small>断点可继续</small></article>
    </div>

    <div class="handoff-grid">
      <section class="panel">
        <div class="panel-head"><h3>版本解锁链</h3><Tag value="打样决定 → 基线" severity="info" /></div>
        <div class="version-chain">
          <div v-for="record in ledger.confirmed" :key="record.revision" class="version-row">
            <div class="version-dot" />
            <div class="version-body">
              <strong>{{ record.revision }} 基线<span v-if="record.tabId === 'system'" class="origin">初始基线</span></strong>
              <small>第 {{ record.unlockedBy.round }} 轮打样解锁 · {{ record.unlockedBy.sample }} · {{ record.unlockedBy.proofId }}</small>
            </div>
            <div class="hash" :title="record.baselineHash">{{ record.baselineHash.slice(0, 10) }}</div>
          </div>
        </div>
        <div v-if="ledger.handoffs.length" class="handoff-log">
          <h4>交接记录</h4>
          <div v-for="handoff in ledger.handoffs" :key="handoff.id" class="handoff-row">
            <Tag :value="`${handoff.fromRevision} → ${handoff.toRevision}`" severity="info" />
            <span>{{ handoff.taskName }}</span>
            <em>{{ handoff.reused }} 复用 · {{ handoff.invalidated }} 作废</em>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>在途分片复用 / 作废</h3><Tag :value="`${activeTasks.length} 个任务`" /></div>
        <div v-if="!activeTasks.length" class="empty-note">所有导出任务均已封存。</div>
        <div v-for="task in activeTasks" :key="task.id" class="shard-task">
          <div class="shard-task-head">
            <strong>{{ task.name }}</strong>
            <Tag :value="`发起于 ${task.revision}`" severity="info" />
          </div>
          <div class="shard-chips">
            <span
              v-for="shard in task.shards"
              :key="shard.id"
              :class="['chip', shard.status, { reused: shard.status === 'done' && shard.reused }]"
              :title="`${shard.label} · 输入 ${shard.inputHash}`"
            >{{ shard.index + 1 }}</span>
          </div>
          <small>{{ task.progress }}% · 复用 {{ reusedCount(task) }} · 作废 {{ invalidCount(task) }}</small>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>冲突留档</h3><Tag :value="`${ledger.conflicts.length} 条`" severity="warn" /></div>
        <div v-if="!ledger.conflicts.length" class="empty-note">两个标签页同时提交时，先确认的基线生效，后到内容只在此留档。</div>
        <div v-for="conflict in ledger.conflicts" :key="conflict.id" class="conflict-row">
          <div class="conflict-head">
            <strong>{{ conflict.tabId }}</strong>
            <Tag value="未生效" severity="warn" />
          </div>
          <small>{{ conflict.at }} · 基于 {{ conflict.baseRevision }} · 载荷哈希 {{ conflict.payloadHash.slice(0, 10) }}</small>
          <p>{{ conflict.reason }}</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>迁移与哈希留档</h3><Tag value="旧结构 → 新结构" /></div>
        <div v-for="migration in ledger.migrations" :key="migration.id" class="migration-row">
          <strong>{{ migration.fromShape }} → {{ migration.toShape }}</strong>
          <small>{{ migration.at }}</small>
          <div class="hash-row"><span title="旧数据哈希">旧 {{ migration.fromHash.slice(0, 10) }}</span><i class="pi pi-arrow-right" /><span title="迁移后哈希">新 {{ migration.toHash.slice(0, 10) }}</span></div>
          <p>{{ migration.summary }}</p>
        </div>
      </section>
    </div>

    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head"><h3>当前拼版任务</h3><Tag :value="store.revision" severity="info" /></div>
        <div class="project-card">
          <div>
            <strong>《潮汐来信》上海巡演节目册</strong>
            <p>成品 210 × 297mm · 8P · 骑马订 · 720 × 1020mm 对开纸</p>
            <div class="specs"><span>CMYK + 专色</span><span>纵向纸纹</span><span>PDF/X-4</span><span>色彩控制条已配置</span></div>
          </div>
          <Button label="打开拼版" icon="pi pi-arrow-right" @click="$router.push('/imposition')" />
        </div>
        <div class="checklist">
          <div><i class="pi pi-check-circle" /><span>页面尺寸与成品规格</span><Tag value="通过" severity="success" /></div>
          <div><i class="pi pi-exclamation-triangle warn" /><span>折手与页码顺序</span><Tag value="1 项警告" severity="warn" /></div>
          <div><i class="pi pi-times-circle error" /><span>出血与版位安全区</span><Tag :value="`${errors} 项错误`" severity="danger" /></div>
          <div><i class="pi pi-check-circle" /><span>色彩控制条与纸张规格</span><Tag value="通过" severity="success" /></div>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>最近打样</h3><Button label="查看全部" text size="small" @click="$router.push('/proofs')" /></div>
          <div class="proof-summary">
            <template v-for="proof in store.proofs.slice().reverse()" :key="proof.id">
              <div class="proof-row">
                <div><strong>第 {{ proof.round }} 轮 · {{ proof.sample }}</strong><small>{{ proof.date }} · ΔE {{ proof.deltaE }}</small></div>
                <Tag :value="proof.decision" :severity="proof.decision === '通过' ? 'success' : proof.decision === '退回' ? 'danger' : 'warn'" />
              </div>
            </template>
          </div>
        </section>
        <section class="panel export-mini">
          <div class="panel-head"><h3>导出任务</h3></div>
          <div v-for="task in store.tasks" :key="task.id">
            <div><span>{{ task.name }}</span><strong>{{ task.progress }}%</strong></div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '7px' }" />
            <small>{{ task.status }} · {{ task.revision }} · {{ task.updatedAt }}</small>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.metric .error { color: #b84e35; }
.handoff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.version-chain { padding: 10px 16px; }
.version-row { display: grid; grid-template-columns: 16px 1fr auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid #edf1f1; }
.version-dot { width: 10px; height: 10px; border: 2px solid #337b79; border-radius: 50%; background: white; }
.version-row strong, .version-row small { display: block; }
.version-row small { margin-top: 3px; color: #7a878d; font-size: 10px; }
.origin { margin-left: 6px; padding: 1px 6px; border-radius: 4px; color: #5a6b70; background: #eef2f2; font-size: 9px; font-weight: 500; }
.hash { color: #506f75; font-family: monospace; font-size: 10px; }
.handoff-log { padding: 10px 16px 14px; }
.handoff-log h4 { margin: 4px 0 8px; color: #6f7d83; font-size: 11px; }
.handoff-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px dashed #e4eaea; font-size: 11px; }
.handoff-row span { flex: 1; color: #5a6b70; }
.handoff-row em { color: #b07a1f; font-style: normal; font-size: 10px; }
.shard-task { padding: 12px 16px; border-bottom: 1px solid #edf1f1; }
.shard-task-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.shard-task-head strong { font-size: 12px; }
.shard-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
.chip { display: inline-grid; width: 24px; height: 24px; place-items: center; border: 1px solid #d3dcde; border-radius: 6px; color: #8a999d; background: #f4f6f6; font-size: 10px; font-weight: 700; }
.chip.done { color: #2d735b; border-color: #bfe2d4; background: #e9f5ef; }
.chip.done.reused { color: #2a6f97; border-color: #b9dcef; background: #eaf4fb; }
.chip.stale { color: #b07a1f; border-color: #ecd9ae; background: #fdf6e7; }
.chip.failed { color: #b84e35; border-color: #f0c4ba; background: #fdeeea; }
.shard-task small { color: #7a878d; font-size: 10px; }
.empty-note { padding: 18px 16px; color: #8a999d; font-size: 11px; line-height: 1.6; }
.conflict-row { padding: 10px 16px; border-bottom: 1px solid #edf1f1; }
.conflict-head { display: flex; align-items: center; justify-content: space-between; }
.conflict-row strong { font-size: 12px; }
.conflict-row small { display: block; margin-top: 3px; color: #7a878d; font-size: 10px; }
.conflict-row p { margin: 6px 0 0; color: #8a6a5a; font-size: 10px; line-height: 1.5; }
.migration-row { padding: 10px 16px; border-bottom: 1px solid #edf1f1; }
.migration-row strong { font-size: 11px; }
.migration-row small { display: block; margin-top: 3px; color: #7a878d; font-size: 10px; }
.hash-row { display: flex; align-items: center; gap: 6px; margin-top: 5px; color: #506f75; font-family: monospace; font-size: 10px; }
.migration-row p { margin: 5px 0 0; color: #7a878d; font-size: 10px; line-height: 1.5; }
.overview-grid { display: grid; grid-template-columns: minmax(0,1fr) 350px; gap: 14px; align-items: start; }
.project-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px; }
.project-card strong { font-size: 17px; }
.project-card p { margin: 7px 0 14px; color: #66757c; }
.specs { display: flex; flex-wrap: wrap; gap: 7px; }
.specs span { padding: 5px 8px; border-radius: 5px; color: #45676d; background: #eef4f4; font-size: 10px; }
.checklist { padding: 0 18px 16px; }
.checklist > div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 9px; padding: 11px 0; border-top: 1px solid #ecf0f0; font-size: 12px; }
.checklist i { color: #3b8a67; }
.checklist i.warn { color: #c4872f; }
.checklist i.error { color: #bb4c35; }
aside { display: grid; gap: 14px; }
.proof-summary { padding: 8px 16px 14px; }
.proof-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid #edf1f1; }
.proof-row strong, .proof-row small { display: block; }
.proof-row small { margin-top: 4px; color: #7a878d; font-size: 10px; }
.export-mini > div:not(.panel-head) { padding: 11px 16px 4px; }
.export-mini > div > div { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; }
.export-mini small { display: block; margin-top: 5px; color: #7d898e; }
@media (max-width: 1050px) { .overview-grid { grid-template-columns: 1fr; } }
@media (max-width: 1200px) { .handoff-grid { grid-template-columns: 1fr; } }
</style>
