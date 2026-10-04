<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useImpositionStore } from './stores/imposition'

const route = useRoute()
const store = useImpositionStore()
const mobileOpen = ref(false)
const title = computed(() => String(route.meta.title ?? '拼版工作台'))
const nav = [
  { to: '/', label: '生产总览', icon: 'pi pi-chart-pie' },
  { to: '/imposition', label: '拼版工作区', icon: 'pi pi-th-large' },
  { to: '/proofs', label: '打样审批', icon: 'pi pi-image' },
  { to: '/versions', label: '版本对比', icon: 'pi pi-copy' },
  { to: '/exports', label: '导出任务', icon: 'pi pi-download' },
]
</script>

<template>
  <div class="shell">
    <header class="mobile-bar"><Button icon="pi pi-bars" text severity="contrast" @click="mobileOpen = !mobileOpen" /><strong>{{ title }}</strong><Tag :value="store.locked ? '已锁定' : '编辑中'" :severity="store.locked ? 'success' : 'warn'" /></header>
    <aside :class="{ open: mobileOpen }">
      <div class="brand"><div class="brand-mark">拼版</div><div><strong>印刷生产中心</strong><small>《潮汐来信》节目册</small></div></div>
      <nav>
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" @click="mobileOpen = false"><i :class="item.icon" />{{ item.label }}</RouterLink>
      </nav>
      <div class="sidebar-status">
        <div><span :class="{ warn: !store.locked }" />{{ store.locked ? '基线已审批锁定' : `${store.validations.length} 项预检提示` }}</div>
        <small>版本 {{ store.revision }} · 自动保存草稿</small>
      </div>
    </aside>
    <main><RouterView /></main>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; background: #eff2f2; }
aside { position: fixed; inset: 0 auto 0 0; z-index: 20; display: flex; width: 244px; flex-direction: column; color: #e8f0f1; background: #283b42; }
.brand { display: flex; align-items: center; gap: 11px; padding: 20px 16px; border-bottom: 1px solid rgba(255,255,255,.1); }
.brand-mark { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid #d49155; border-radius: 9px; color: #f3c394; font-size: 13px; font-weight: 800; }
.brand strong, .brand small { display: block; }
.brand strong { font-size: 14px; }
.brand small { margin-top: 4px; color: #9dafb4; font-size: 10px; }
nav { display: grid; gap: 5px; padding: 16px 10px; }
nav a { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 7px; color: #becdd1; text-decoration: none; font-size: 13px; }
nav a.router-link-active { color: white; background: #3a555d; box-shadow: inset 3px 0 #d59456; }
.sidebar-status { margin: auto 12px 14px; padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: rgba(255,255,255,.04); }
.sidebar-status div { font-size: 11px; font-weight: 700; }
.sidebar-status span { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: #58b38a; }
.sidebar-status span.warn { background: #d9a04d; }
.sidebar-status small { display: block; margin-top: 6px; color: #96a9ae; font-size: 9px; }
main { min-width: 0; margin-left: 244px; }
.mobile-bar { display: none; }
@media (max-width: 820px) {
  aside { left: -260px; transition: left .18s ease; }
  aside.open { left: 0; }
  main { margin-left: 0; }
  .mobile-bar { position: sticky; top: 0; z-index: 15; display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 7px 10px; color: white; background: #283b42; }
  .mobile-bar strong { flex: 1; }
}
</style>
