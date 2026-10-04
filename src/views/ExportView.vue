<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useImpositionStore } from '../stores/imposition'
import { exportApi } from '../api/exportApi'
import { labelTime, shortHash, type ExportTaskDetail, type Shard } from '../production/handoff'

const store = useImpositionStore()
const queryClient = useQueryClient()
const expanded = ref<string | null>(store.tasks[0]?.id ?? null)

const { data: taskDetails, isPending } = useQuery({
  queryKey: ['export-tasks'],
  queryFn: async () => (await exportApi.list()).data,
  initialData: () => store.tasks.map((task) => ({ ...task, shards: store.shardsOfTask(task.id) })),
  refetchInterval: 900,
})

const refresh = () => queryClient.invalidateQueries({ queryKey: ['export-tasks'] })
const createMutation = useMutation({
  mutationFn: () => exportApi.create({ name: '印刷交付包 · PDF/X-4', kind: '印刷交付包' }),
  onSuccess: () => refresh(),
})
const resumeMutation = useMutation({
  mutationFn: async (id: string) => (await exportApi.resume(id)).data,
  onSuccess: () => window.setTimeout(refresh, 480),
})
const failMutation = useMutation({
  mutationFn: async (id: string) => (await exportApi.simulateFailure(id)).data,
  onSuccess: () => window.setTimeout(refresh, 480),
})

function statusSeverity(status?: string) {
  return status === '已完成' ? 'success' : status === '已中断' ? 'danger' : status === '生成中' ? 'warn' : 'info'
}

function shardSeverity(shard: Shard) {
  if (shard.status === '已完成') return shard.source === '本次生成' ? 'success' : 'info'
  if (shard.status === '作废') return 'danger'
  if (shard.status === '生成失败') return 'danger'
  return 'secondary'
}

function shardTag(shard: Shard): string {
  if (shard.status === '作废') return `作废于 ${shard.invalidatedByVersionId ?? '—'}`
  if (shard.source === '复用') return '跨任务复用'
  if (shard.source === '旧版本迁移') return '旧版迁移复用'
  return shard.status === '已完成' ? '本次生成' : shard.status
}

const reconciledNow = computed(() => store.lastReconciliation.filter((stat) => stat.reused || stat.invalidated || stat.recompute))
const unlockProof = (versionId: string) => {
  const version = store.versions.find((item) => item.id === versionId)
  return store.proofs.find((proof) => proof.id === version?.unlockProofId)
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">EXPORT JOBS / 生产交接导出</p>
        <h1>交付包 · 分片恢复 · 版本对账</h1>
        <p class="muted">任务绑定基线哈希；新版本锁定后旧分片按内容哈希作废或复用，写入失败从最后完成分片继续。</p>
      </div>
      <Button label="新建印刷交付包" icon="pi pi-plus" :loading="createMutation.isPending.value" @click="createMutation.mutate()" />
    </div>

    <Message v-if="reconciledNow.length" severity="warn" :closable="false" class="mb-3">
      <template #icon><i class="pi pi-sync" /></template>
      最近一次锁定已完成对账：
      <span v-for="stat in reconciledNow" :key="stat.taskId" class="recon-chip">
        {{ stat.taskId }} 复用 {{ stat.reused }} · 作废 {{ stat.invalidated }} · 重算 {{ stat.recompute }}
      </span>
    </Message>

    <div class="export-grid">
      <section class="panel">
        <div class="panel-head"><h3>导出队列</h3><span class="muted">分片 2 页/组 · Axios 模拟 REST</span></div>
        <div v-if="isPending" class="loading">正在加载导出任务…</div>
        <div v-else class="task-list">
          <article v-for="task in (taskDetails ?? [])" :key="task.id" class="task">
            <div class="task-head">
              <div>
                <strong>{{ task.name }}</strong>
                <small>{{ task.id }} · 基线 {{ task.versionId }} · {{ labelTime(task.updatedAt) }}</small>
                <small class="hash">内容哈希 {{ shortHash(task.baselineHash) }}<template v-if="task.packageHash"> · 交付包哈希 {{ shortHash(task.packageHash) }}</template></small>
              </div>
              <Tag :value="task.status" :severity="statusSeverity(task.status)" />
            </div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '8px' }" />
            <div class="task-foot">
              <span>
                {{ task.progress }}%
                <template v-if="task.lastCompletedShardId"> · 断点 {{ task.lastCompletedShardId.split('-SH-')[1] }} 组</template>
                <template v-if="task.failCount"> · 失败 {{ task.failCount }} 次</template>
              </span>
              <span class="task-actions">
                <Button label="分片明细" size="small" text @click="expanded = expanded === task.id ? null : task.id" />
                <Button v-if="task.resumable && task.status === '已中断'" label="从断点恢复" icon="pi pi-play" size="small"
                        :loading="resumeMutation.isPending.value" @click="resumeMutation.mutate(task.id)" />
                <Button v-if="task.status === '排队中' || task.status === '生成中'" label="演练写入失败" icon="pi pi-bolt"
                        size="small" severity="danger" outlined :loading="failMutation.isPending.value" @click="failMutation.mutate(task.id)" />
                <Tag v-if="task.status === '已完成'" value="哈希已校验" severity="success" />
              </span>
            </div>

            <div v-if="expanded === task.id" class="shard-table">
              <div class="shard-row shard-head-row"><span>分片</span><span>页面</span><span>输入哈希</span><span>产物哈希</span><span>来源/去向</span><span>状态</span></div>
              <template v-for="shard in task.shards" :key="shard.id">
                <div class="shard-row" :class="{ voided: shard.status === '作废' }">
                  <span>第 {{ shard.index }} 组</span>
                  <span>{{ shard.pageNos.map((no) => `P${no}`).join(' / ') }}</span>
                  <span class="mono">{{ shortHash(shard.inputHash, 8) }}</span>
                  <span class="mono">{{ shortHash(shard.outputHash, 8) }}</span>
                  <span>{{ shardTag(shard) }}<em v-if="shard.attempts > 1"> · 尝试 {{ shard.attempts }} 次</em></span>
                  <Tag :value="shard.status" :severity="shardSeverity(shard)" />
                </div>
                <div v-if="shard.lastError" class="shard-error"><i class="pi pi-exclamation-triangle" />{{ shard.lastError }} —— 已完成分片不受影响，恢复时仅重写本组。</div>
              </template>
            </div>
          </article>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>版本解锁血缘</h3><Tag :value="store.revision" /></div>
          <div class="lineage">
            <div v-for="version in store.versions.slice().reverse()" :key="version.id" class="lineage-row">
              <div>
                <strong>{{ version.id }} · {{ version.status }}</strong>
                <small v-if="version.parentId">基于 {{ version.parentId }}</small>
              </div>
              <div class="proof-link">
                <i class="pi pi-image" />
                <template v-if="unlockProof(version.id)">
                  第 {{ unlockProof(version.id)!.round }} 轮打样 · {{ unlockProof(version.id)!.decision }}
                </template>
                <template v-else>未关联打样</template>
              </div>
              <small class="mono hash">{{ shortHash(version.contentHash) }}</small>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>交付包内容（{{ store.revision }}）</h3></div>
          <div class="package-list">
            <div><i class="pi pi-file-pdf" /><span>拼版 PDF/X-4</span><strong>按版本哈希生成</strong></div>
            <div><i class="pi pi-list" /><span>预检报告 JSON</span><strong>{{ store.validations.length }} 项</strong></div>
            <div><i class="pi pi-palette" /><span>色彩控制条报告</span><strong>已包含</strong></div>
            <div><i class="pi pi-image" /><span>解锁打样记录</span><strong>{{ store.proofs.filter((p) => p.decision === '通过').length }} 轮通过</strong></div>
            <div><i class="pi pi-sync" /><span>分片复用/作废清单</span><strong>见明细</strong></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>旧数据迁移哈希</h3><Tag :value="`${store.migrations.length} 次`" severity="info" /></div>
          <div class="migration-list">
            <div v-for="record in store.migrations" :key="record.id">
              <strong>{{ record.kind }}</strong>
              <small>{{ labelTime(record.at) }} · {{ record.fromSchema }} → {{ record.toSchema }}</small>
              <small class="mono">源 {{ shortHash(record.sourceHash, 12) }}</small>
              <small class="mono">目标 {{ shortHash(record.targetHash, 12) }}</small>
              <small>迁移 {{ record.taskCount }} 任务 / {{ record.shardCount }} 分片</small>
            </div>
          </div>
        </section>

        <section class="panel recovery">
          <div class="panel-head"><h3>断点恢复说明</h3></div>
          <p>分片按 2 页一组写入并登记产物哈希。写入失败只保留错误标记；恢复时跳过全部已完成分片，从最后完成分片的下一组继续。锁定新版本时，运行中的旧任务立即对账，不会继续生成旧内容。</p>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.mb-3 { margin-bottom: 12px; }
.recon-chip { margin-right: 14px; font-weight: 700; }
.export-grid { display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 14px; align-items: start; }
.loading { padding: 30px; color: #75838a; text-align: center; }
.task-list { padding: 8px 16px 16px; }
.task { padding: 15px 0; border-bottom: 1px solid #e9eeee; }
.task-head, .task-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.task-head { margin-bottom: 11px; }
.task-head strong, .task-head small { display: block; }
.task-head small { margin-top: 4px; color: #7c898f; font-size: 10px; }
.task-head .hash { font-family: monospace; }
.task-foot { margin-top: 9px; }
.task-foot > span:first-child { color: #68777e; font-size: 10px; }
.task-actions { display: flex; align-items: center; gap: 6px; }
.shard-table { margin-top: 12px; border: 1px solid #e3e9ea; border-radius: 8px; overflow: hidden; }
.shard-row { display: grid; grid-template-columns: 56px 86px 92px 92px minmax(0,1fr) 76px; gap: 8px; align-items: center; padding: 9px 12px; font-size: 10px; border-bottom: 1px solid #eef2f2; }
.shard-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shard-head-row { background: #f4f7f7; font-weight: 800; color: #5d7077; }
.shard-row em { color: #b05a32; font-style: normal; }
.shard-row.voided { opacity: .62; background: #fdf1ee; text-decoration: line-through; }
.shard-row.voided .p-tag { text-decoration: none; }
.shard-error { padding: 7px 12px; background: #fdeee9; color: #a2492f; font-size: 10px; }
.shard-error i { margin-right: 6px; }
.mono { font-family: monospace; }
aside { display: grid; gap: 14px; }
.lineage { padding: 10px 14px 14px; display: grid; gap: 10px; }
.lineage-row { display: grid; gap: 3px; padding: 9px 10px; background: #f5f8f8; border-left: 3px solid #337b79; border-radius: 4px; }
.lineage-row strong, .lineage-row small { display: block; font-size: 11px; }
.lineage-row .hash { color: #6f7f85; }
.proof-link { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #4c6d72; }
.proof-link i { color: #c98236; }
.package-list { padding: 8px 14px 14px; }
.package-list div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf1f1; font-size: 11px; }
.package-list i { color: #397d64; }
.package-list strong { color: #536b72; font-size: 10px; }
.migration-list { padding: 6px 14px 14px; display: grid; gap: 10px; }
.migration-list > div { display: grid; gap: 3px; padding: 9px 10px; background: #f6f4ef; border-radius: 5px; }
.migration-list strong { font-size: 11px; }
.migration-list small { font-size: 9px; color: #7a7468; }
.recovery p { padding: 0 16px 16px; color: #67767d; font-size: 11px; line-height: 1.6; }
@media (max-width: 1000px) { .export-grid { grid-template-columns: 1fr; } .shard-row { grid-template-columns: 48px 70px 80px 80px minmax(0,1fr) 70px; } }
</style>
