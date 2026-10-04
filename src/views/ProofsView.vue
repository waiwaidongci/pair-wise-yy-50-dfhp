<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { useImpositionStore, type Proof } from '../stores/imposition'

const store = useImpositionStore()
const active = computed(() => store.proofs.find((proof) => proof.id === store.selectedProof) ?? store.proofs[0])
const draft = ref<Proof>({ ...active.value })
watch(active, (value) => (draft.value = { ...value }), { immediate: true })
const sampleFile = ref('当前使用数字样张 v2_09025.tif')

function save() {
  store.updateProof(draft.value.id, draft.value)
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">PROOFING / 打样审批</p><h1>打样轮次与色彩反馈</h1><p class="muted">每轮记录样张、色差、修正说明与负责人决定，修改后生成新拼版版本。</p></div>
      <Button label="新建打样轮次" icon="pi pi-plus" @click="store.createProof" />
    </div>

    <div class="proof-layout">
      <section class="panel">
        <div class="panel-head"><h3>打样轮次</h3><Tag :value="`${store.proofs.length} 轮`" /></div>
        <div class="proof-list">
          <button v-for="proof in store.proofs.slice().reverse()" :key="proof.id" :class="{ active: proof.id === store.selectedProof }" @click="store.selectedProof = proof.id">
            <div><strong>第 {{ proof.round }} 轮 · {{ proof.sample }}</strong><small>{{ proof.date }} · {{ proof.owner }}</small></div>
            <span>ΔE {{ proof.deltaE }}</span>
            <Tag :value="proof.decision" :severity="proof.decision === '通过' ? 'success' : proof.decision === '退回' ? 'danger' : 'warn'" />
          </button>
        </div>
      </section>

      <section class="panel proof-editor">
        <div class="panel-head"><h3>{{ draft.id }} · 第 {{ draft.round }} 轮打样记录</h3><Tag :value="draft.decision" :severity="draft.decision === '通过' ? 'success' : draft.decision === '退回' ? 'danger' : 'warn'" /></div>
        <div v-if="active" class="proof-body">
          <div class="sample-preview">
            <div class="print-sample"><span>P1 / P8</span><strong>潮汐来信</strong><i>数字样张色靶</i></div>
            <div>
              <strong>{{ sampleFile }}</strong>
              <p>样张文件已关联当前拼版版本 {{ store.revision }}，包含 P1、P3、P7、P8 重点页面。</p>
              <label class="file-button"><i class="pi pi-upload" /> 替换样张照片<input type="file" accept="image/*,.pdf,.tif" style="display:none" @change="sampleFile = ($event.target as HTMLInputElement).files?.[0]?.name ?? sampleFile" /></label>
            </div>
          </div>
          <div class="form-grid">
            <label>样张名称<InputText v-model="draft.sample" /></label>
            <label>打样日期<InputText v-model="draft.date" /></label>
            <label>负责人<InputText v-model="draft.owner" /></label>
            <label>平均色差 ΔE<InputNumber v-model="draft.deltaE" :min="0" :max="10" :minFractionDigits="1" :maxFractionDigits="1" /></label>
          </div>
          <label>色差与外观反馈<Textarea v-model="draft.feedback" rows="4" /></label>
          <label>修正说明<Textarea v-model="draft.correction" rows="4" /></label>
          <div class="decision-row">
            <Select v-model="draft.decision" :options="['待决定','通过','退回']" />
            <Button label="保存打样记录" icon="pi pi-save" @click="save" />
            <Button label="退回修改" icon="pi pi-undo" severity="danger" outlined @click="draft.decision = '退回'; save()" />
          </div>
        </div>
      </section>

      <aside class="panel">
        <div class="panel-head"><h3>色彩控制</h3><span class="muted">CMYK + 专色</span></div>
        <div class="color-bars">
          <div v-for="color in ['Cyan','Magenta','Yellow','Black','PANTONE 2965 C']" :key="color"><i :class="color.toLowerCase().replaceAll(' ','-')" /><span>{{ color }}</span><strong>{{ color.includes('PANTONE') ? '1.2' : '0.8' }} ΔE</strong></div>
        </div>
        <div class="threshold"><strong>通过阈值</strong><p>重点页面平均 ΔE ≤ 2.0，单点最高不超过 3.0。</p></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.proof-layout { display: grid; grid-template-columns: 350px minmax(0,1fr) 300px; gap: 14px; align-items: start; }
.proof-list { padding: 8px; }
.proof-list button { display: grid; width: 100%; grid-template-columns: 1fr 58px auto; gap: 8px; align-items: center; padding: 11px; border: 0; border-radius: 7px; text-align: left; background: transparent; cursor: pointer; }
.proof-list button.active { background: #edf5f4; box-shadow: inset 3px 0 #337b79; }
.proof-list strong, .proof-list small { display: block; }
.proof-list strong { font-size: 12px; }
.proof-list small { margin-top: 4px; color: #7a878e; font-size: 10px; }
.proof-list > button > span { color: #506f75; font-family: monospace; font-weight: 700; }
.proof-body { display: grid; gap: 15px; padding: 18px; }
.sample-preview { display: grid; grid-template-columns: 190px 1fr; gap: 16px; align-items: center; padding: 14px; background: #f4f6f5; }
.print-sample { position: relative; display: grid; width: 150px; aspect-ratio: .72; place-items: center; padding: 12px; color: #dce9e8; background: linear-gradient(145deg,#173a4a,#306a6d); box-shadow: 0 8px 18px rgba(29,54,62,.18); }
.print-sample span { position: absolute; top: 8px; left: 9px; font-size: 9px; }
.print-sample strong { font-size: 16px; }
.print-sample i { font-size: 9px; font-style: normal; }
.sample-preview p { color: #68777d; font-size: 11px; line-height: 1.55; }
.file-button { display: inline-flex; width: fit-content; align-items: center; gap: 6px; padding: 7px 9px; border: 1px solid #bdc9cb; border-radius: 6px; color: #38666d; background: white; cursor: pointer; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.proof-body label { display: grid; gap: 6px; color: #5e6e75; font-size: 11px; font-weight: 700; }
.decision-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.color-bars { padding: 12px 16px 16px; }
.color-bars > div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid #edf1f1; font-size: 11px; }
.color-bars i { width: 18px; height: 18px; border-radius: 4px; background: #2a2a2a; }
.color-bars i.cyan { background: #18b6d6; }
.color-bars i.magenta { background: #e33d98; }
.color-bars i.yellow { background: #f1d22d; }
.color-bars i.black { background: #222; }
.color-bars i.pantone-2965-c { background: #1f4e6e; }
.color-bars strong { color: #4c6d72; }
.threshold { margin: 0 16px 16px; padding: 12px; border-left: 3px solid #c98236; background: #fff5e8; }
.threshold p { margin: 5px 0 0; color: #716555; font-size: 10px; line-height: 1.5; }
@media (max-width: 1200px) { .proof-layout { grid-template-columns: 300px 1fr; } .proof-layout > aside { grid-column: 1 / -1; } }
@media (max-width: 760px) { .proof-layout { grid-template-columns: 1fr; } .sample-preview { grid-template-columns: 1fr; } }
</style>
