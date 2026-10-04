<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Position, Validation } from '../stores/imposition'

const props = defineProps<{
  positions: Position[]
  side: 'front' | 'back'
  zoom: number
  selected: string | null
  validations: Validation[]
}>()

const emit = defineEmits<{
  update: [id: string, patch: Partial<Position>]
  select: [id: string]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const dragging = ref<string | null>(null)
const dragOffset = ref({ x: 0, y: 0 })

function draw() {
  const element = canvas.value
  if (!element) return
  const ctx = element.getContext('2d')
  if (!ctx) return
  const width = 800
  const height = 1120
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#d7dddf'
  ctx.fillRect(0, 0, width, height)
  ctx.shadowColor = 'rgba(23,45,54,.22)'
  ctx.shadowBlur = 18
  ctx.fillStyle = '#fffefb'
  ctx.fillRect(24, 24, 752, 1072)
  ctx.shadowBlur = 0
  ctx.strokeStyle = '#b8c3c6'
  ctx.setLineDash([5, 5])
  ctx.strokeRect(42, 42, 716, 1036)
  ctx.setLineDash([])
  ctx.fillStyle = '#e69a4b'
  ctx.fillRect(52, 1060, 696, 12)
  for (let index = 0; index < 7; index += 1) {
    ctx.fillStyle = ['#28a4d8', '#ef3b9b', '#f4d62c', '#1a1a1a', '#30c3aa', '#ef4c36', '#5c67cd'][index]
    ctx.fillRect(52 + index * 99, 1060, 99, 12)
  }
  ctx.fillStyle = '#26373d'
  ctx.font = 'bold 15px sans-serif'
  ctx.fillText(`${props.side === 'front' ? '正面' : '反面'}拼版版式`, 48, 28)
  ctx.font = '11px sans-serif'
  ctx.fillStyle = '#76848a'
  ctx.fillText(`纸张 720 × 1020 mm · 出血 3mm · 安全区 5mm · 骑马订`, 180, 28)

  props.positions.filter((item) => item.front === (props.side === 'front')).forEach((position) => {
    const x = position.x
    const y = position.y + 20
    const pageWidth = 300
    const pageHeight = 410
    const hasIssue = props.validations.some((issue) => issue.pageNo === position.pageNo)
    ctx.save()
    ctx.translate(x + pageWidth / 2, y + pageHeight / 2)
    ctx.rotate((position.rotation * Math.PI) / 180)
    ctx.translate(-pageWidth / 2, -pageHeight / 2)
    if (position.id === props.selected) {
      ctx.shadowColor = 'rgba(31,113,123,.35)'
      ctx.shadowBlur = 14
    }
    ctx.fillStyle = '#f7f7f2'
    ctx.fillRect(0, 0, pageWidth, pageHeight)
    ctx.shadowBlur = 0
    ctx.strokeStyle = hasIssue ? '#c64f35' : '#647c82'
    ctx.lineWidth = position.id === props.selected ? 3 : 1.5
    ctx.strokeRect(0, 0, pageWidth, pageHeight)
    ctx.strokeStyle = '#df7654'
    ctx.setLineDash([7, 5])
    ctx.strokeRect(-8, -8, pageWidth + 16, pageHeight + 16)
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = '#5a9d9b'
    ctx.strokeRect(14, 14, pageWidth - 28, pageHeight - 28)
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(48,110,115,.08)'
    ctx.fillRect(18, 18, pageWidth - 36, pageHeight - 36)
    ctx.fillStyle = '#31474e'
    ctx.font = 'bold 18px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`P${position.pageNo}`, pageWidth / 2, pageHeight / 2 - 10)
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#718187'
    ctx.fillText(position.rotation ? `旋转 ${position.rotation}°` : '方向 0°', pageWidth / 2, pageHeight / 2 + 14)
    ctx.restore()
  })
}

function pointerDown(event: PointerEvent) {
  const canvasElement = canvas.value
  if (!canvasElement) return
  const rect = canvasElement.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 800
  const y = ((event.clientY - rect.top) / rect.height) * 1120 - 20
  const hit = props.positions
    .filter((item) => item.front === (props.side === 'front'))
    .find((item) => x >= item.x && x <= item.x + 300 && y >= item.y && y <= item.y + 410)
  if (!hit) return
  dragging.value = hit.id
  dragOffset.value = { x: x - hit.x, y: y - hit.y }
  emit('select', hit.id)
  canvasElement.setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  if (!dragging.value || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 800 - dragOffset.value.x
  const y = ((event.clientY - rect.top) / rect.height) * 1120 - 20 - dragOffset.value.y
  emit('update', dragging.value, { x: Math.max(28, Math.min(470, Math.round(x))), y: Math.max(24, Math.min(580, Math.round(y))) })
}

onMounted(draw)
watch(() => [props.positions, props.side, props.selected, props.validations], draw, { deep: true })
</script>

<template>
  <div class="canvas-wrap" :style="{ width: `${Math.round(800 * zoom / 100)}px` }">
    <canvas
      ref="canvas"
      width="800"
      height="1120"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="dragging = null"
      @pointercancel="dragging = null"
    />
  </div>
</template>

<style scoped>
.canvas-wrap { width: 800px; max-width: none; transform-origin: left top; transition: width .15s ease; }
canvas { display: block; width: 100%; height: auto; touch-action: none; cursor: grab; }
canvas:active { cursor: grabbing; }
</style>
