<script setup lang="ts">
import { computed } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { useImpositionStore } from '../stores/imposition'
import { exportApi } from '../api/exportApi'
import { ledger, type Shard, type ShardStatus } from '../handoff'

const store = useImpositionStore()
const queryClient = useQueryClient()
const { data: tasks, isPending } = useQuery({
  queryKey: ['export-tasks'],
  queryFn: async () => (await exportApi.list()).data,
  initialData: store.tasks,
})
const resumeMutation = useMutation({
  mutationFn: async (id: string) => (await exportApi.resume(id)).data,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['export-tasks'] }),
})

function statusSeverity(status?: string) {
  return status === '已完成' ? 'success' : status === '已中断' ? 'danger' : status === '生成中' ? 'warn' : 'info'
}

const shardMeta: Record<ShardStatus, { label: string; severity: 'success' | 'warn' | 'danger' | 'secondary' }> = {
  done: { label: '已完成', severity: 'success' },
  pending: { label: '待生成', severity: 'secondary' },
  stale: { label: '作废待重算', severity: 'warn' },
  failed: { label: '写入失败', severity: 'danger' },
}

function shardTag(shard: Shard) {
  if (shard.status === 'done' && shard.reused) return { label: '复用', severity: 'success' as const }
  return shardMeta[shard.status]
}

function reuseCount(task: { shards: Shard[] }) {
  return task.shards.filter((shard) => shard.status === 'done' && shard.reused).length
}
function invalidCount(task: { shards: Shard[] }) {
  return task.shards.filter((shard) => shard.status === 'stale' || shard.status === 'failed').length
}

const activeTasks = computed(() => store.tasks.filter((task) => task.status !== '已完成'))
const totalReused = computed(() => activeTasks.value.reduce((sum, task) => sum + reuseCount(task), 0))
const totalInvalid = computed(() => activeTasks.value.reduce((sum, task) => sum + invalidCount(task), 0))
const tipRecord = computed(() => ledger.confirmed.at(-1))
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">EXPORT JOBS / 导出任务</p><h1>交付包与分片断点恢复</h1><p class="muted">每个任务绑定发起时的拼版版本与输入哈希；版本变更后旧分片作废重算、可复用进度保留，写入失败从最后完成分片继续。</p></div>
      <Button label="新建印刷交付包" icon="pi pi-plus" @click="store.addTask(); queryClient.invalidateQueries({ queryKey: ['export-tasks'] })" />
    </div>

    <div class="export-grid">
      <section class="panel">
        <div class="panel-head"><h3>导出队列</h3><span class="muted">Axios 模拟 REST · 分片 8 页一组</span></div>
        <div v-if="isPending" class="loading">正在加载导出任务…</div>
        <div v-else class="task-list">
          <article v-for="task in (tasks ?? store.tasks)" :key="task.id">
            <div class="task-head">
              <div>
                <strong>{{ task.name }}</strong>
                <small>{{ task.id }} · {{ task.updatedAt }}</small>
              </div>
              <Tag :value="task.status" :severity="statusSeverity(task.status)" />
            </div>
            <div class="task-rev">
              <Tag :value="`发起于 ${task.revision}`" severity="info" />
              <span v-if="task.status !== '已完成'" class="muted">分片 {{ task.shards.filter((s) => s.status === 'done').length }}/{{ task.shards.length }} · 复用 {{ reuseCount(task) }} · 作废 {{ invalidCount(task) }}</span>
              <span v-else class="muted">历史基线交付包 · 分片已封存</span>
            </div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '8px' }" />
            <div class="shard-chips">
              <span
                v-for="shard in task.shards"
                :key="shard.id"
                :class="['chip', shard.status, { reused: shard.status === 'done' && shard.reused }]"
                :title="`${shard.label}\n输入 ${shard.inputHash}${shard.outputHash ? `\n输出 ${shard.outputHash}` : ''}`"
              >
                <i v-if="shard.status === 'done' && shard.reused" class="pi pi-replay" />
                <i v-else-if="shard.status === 'done'" class="pi pi-check" />
                <i v-else-if="shard.status === 'failed'" class="pi pi-times" />
                <i v-else-if="shard.status === 'stale'" class="pi pi-exclamation-triangle" />
                {{ shard.index + 1 }}
              </span>
            </div>
            <div class="task-foot">
              <span>{{ task.progress }}% · {{ task.status === '已完成' ? '文件哈希已校验' : '保留最后完成分片' }}</span>
              <Button v-if="task.resumable && task.status !== '已完成'" label="恢复任务" icon="pi pi-play" size="small" :loading="resumeMutation.isPending.value" @click="resumeMutation.mutate(task.id)" />
              <Button v-else-if="task.status !== '已完成'" label="重新生成" icon="pi pi-refresh" size="small" outlined />
              <Button v-else label="打开结果" icon="pi pi-external-link" size="small" text />
            </div>
            <div v-if="task.status === '已中断' && task.shards.some((s) => s.status === 'failed')" class="fail-note">
              <i class="pi pi-exclamation-triangle" />
              <span>写入失败：第 {{ task.shards.find((s) => s.status === 'failed')!.index + 1 }} 分片未落盘，已从最后完成分片恢复，输入哈希不变的分片继续复用。</span>
            </div>
          </article>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>交付包内容</h3><Tag :value="tipRecord?.revision ?? store.revision" /></div>
          <div class="package-list">
            <div><i class="pi pi-file-pdf" /><span>拼版 PDF/X-4</span><strong>{{ tipRecord?.revision ?? '—' }}</strong></div>
            <div><i class="pi pi-check-circle" /><span>预检报告 JSON</span><strong>{{ store.validations.length }} 项</strong></div>
            <div><i class="pi pi-check-circle" /><span>色彩控制条报告</span><strong>已包含</strong></div>
            <div><i class="pi pi-check-circle" /><span>打样审批记录</span><strong>{{ store.proofs.length }} 轮</strong></div>
            <div><i class="pi pi-check-circle" /><span>基线解锁轮次</span><strong v-if="tipRecord">第 {{ tipRecord.unlockedBy.round }} 轮 · {{ tipRecord.unlockedBy.proofId }}</strong></div>
            <div><i class="pi pi-check-circle" /><span>分片复用 / 作废</span><strong>{{ totalReused }} / {{ totalInvalid }}</strong></div>
          </div>
        </section>
        <section class="panel recovery">
          <div class="panel-head"><h3>恢复与交接说明</h3></div>
          <p>任务分片按依赖范围记录输入哈希。拼版版本锁定后，输入哈希不变的分片直接复用，变化的分片作废重算；写入失败时从最后完成分片继续，旧数据迁移到新结构并保留哈希。</p>
          <Button label="清理已完成任务" severity="secondary" outlined fluid />
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.export-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
.loading { padding: 30px; color: #75838a; text-align: center; }
.task-list { padding: 8px 16px 16px; }
.task-list article { padding: 15px 0; border-bottom: 1px solid #e9eeee; }
.task-head, .task-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.task-head { margin-bottom: 11px; }
.task-head strong, .task-head small { display: block; }
.task-head small { margin-top: 4px; color: #7c898f; font-size: 10px; }
.task-rev { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
.task-rev .muted { font-size: 10px; }
.shard-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.chip { display: inline-grid; width: 26px; height: 26px; place-items: center; border: 1px solid #d3dcde; border-radius: 6px; color: #8a999d; background: #f4f6f6; font-size: 10px; font-weight: 700; cursor: default; }
.chip i { font-size: 10px; }
.chip.done { color: #2d735b; border-color: #bfe2d4; background: #e9f5ef; }
.chip.done.reused { color: #2a6f97; border-color: #b9dcef; background: #eaf4fb; }
.chip.stale { color: #b07a1f; border-color: #ecd9ae; background: #fdf6e7; }
.chip.failed { color: #b84e35; border-color: #f0c4ba; background: #fdeeea; }
.chip.pending { color: #8a999d; }
.task-foot { margin-top: 9px; }
.task-foot span { color: #68777e; font-size: 10px; }
.fail-note { display: flex; gap: 7px; margin-top: 9px; padding: 8px 10px; border-radius: 6px; color: #8a4a3c; background: #fdeeea; font-size: 10px; line-height: 1.5; }
aside { display: grid; gap: 14px; }
.package-list { padding: 8px 16px 16px; }
.package-list div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf1f1; font-size: 11px; }
.package-list i { color: #397d64; }
.package-list strong { color: #536b72; font-size: 10px; }
.recovery p { padding: 0 16px; color: #67767d; font-size: 11px; line-height: 1.6; }
.recovery :deep(.p-button) { width: calc(100% - 32px); margin: 0 16px 16px; }
@media (max-width: 1000px) { .export-grid { grid-template-columns: 1fr; } }
</style>
