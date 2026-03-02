import * as Tone from 'tone'
import { DEFAULT_BPM, PPQ, SIXTEENTH_TICKS, STEPS } from './constants'
import { clampBpm } from './noteGridUtils'

let bpmValue = DEFAULT_BPM
export const bpmMap = Array.from({ length: STEPS }, () => DEFAULT_BPM)

export function getBpmValue(): number {
  return bpmValue
}

export function setBpmValue(value: number) {
  bpmValue = value
}

let loopTicksCache = 0
let loopSecondsCache = 0
let startTicksCache: number[] = []

function getStepBpm(stepIndex: number) {
  return clampBpm(bpmMap[stepIndex] ?? DEFAULT_BPM)
}

function getStepTicks(stepIndex: number) {
  return SIXTEENTH_TICKS * (DEFAULT_BPM / getStepBpm(stepIndex))
}

export function buildTimingMap() {
  const startTicks: number[] = []
  let tickCursor = 0
  for (let step = 0; step < STEPS; step++) {
    startTicks.push(Math.round(tickCursor))
    tickCursor += getStepTicks(step)
  }
  loopTicksCache = Math.round(tickCursor)
  loopSecondsCache = ticksToSeconds(loopTicksCache)
  startTicksCache = startTicks
  return { startTicks, loopTicks: loopTicksCache }
}

function ticksToSeconds(loopTicks: number) {
  const bpmFromState = Number.isFinite(bpmValue) ? bpmValue : null
  const bpmFromTransport =
    typeof Tone.Transport.bpm?.value === 'number' && Number.isFinite(Tone.Transport.bpm.value)
      ? Tone.Transport.bpm.value
      : null
  const bpm = bpmFromState ?? bpmFromTransport ?? DEFAULT_BPM
  const secondsPerTick = (60 / bpm) / PPQ
  return loopTicks * secondsPerTick
}

export function getLoopDurationSeconds() {
  if (!Number.isFinite(loopSecondsCache) || loopSecondsCache <= 0) {
    loopSecondsCache = ticksToSeconds(loopTicksCache || buildTimingMap().loopTicks)
  }
  return loopSecondsCache
}

export function getCurrentStep(transportTicks: number): number {
  if (loopTicksCache <= 0 || startTicksCache.length === 0) return 0
  const pos = transportTicks % loopTicksCache
  for (let i = startTicksCache.length - 1; i >= 0; i--) {
    if (pos >= (startTicksCache[i] ?? 0)) {
      return i
    }
  }
  return 0
}

export function getCurrentStepFromSeconds(elapsedSeconds: number): number {
  const loopSeconds = getLoopDurationSeconds()
  if (loopSeconds <= 0 || loopTicksCache <= 0 || startTicksCache.length === 0) {
    return 0
  }
  const normalizedSeconds = elapsedSeconds % loopSeconds
  const posTicks = (normalizedSeconds / loopSeconds) * loopTicksCache
  return getCurrentStep(posTicks)
}
