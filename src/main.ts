import './style.css'
import './controls.css'
import './responsive.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes, parseNDJSON, type SequenceEvent } from 'tonejs-json-sequencer'
import { MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, PPQ, type Group } from './constants'
import { createAutoGainManager } from './autoGain'
import {
  buildSequenceFromNotes,
  getNdjsonSequence,
  getLoopDurationSeconds,
  initializeNoteGrid,
  randomizeAll,
  updateLoopNote,
  updateNdjsonDisplay,
} from './noteGrid'
import { buildAppShell } from './appLayout'
import { initializeTonePresets, randomizeToneWithRandomPreset } from './toneControls'
import { createVisuals } from './visuals'
import { applyFilterLfos, disposeFilterLfos } from './filterLfo'

const nodes = new SequencerNodes()
const player = new NDJSONStreamingPlayer(Tone, nodes, {
  loop: true,
  loopWaitSeconds: 0,
  lookaheadMs: 60,
  ticksPerQuarter: PPQ,
})

const app = document.querySelector<HTMLDivElement>('#app')

if (app) {
  app.innerHTML = buildAppShell()
}

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')
const statusDot = document.querySelector<HTMLSpanElement>('#dot')
const ndjsonError = document.querySelector<HTMLDivElement>('#ndjson-error')
const ndjsonErrorLabel = document.querySelector<HTMLSpanElement>('#ndjson-error-label')
const ndjsonErrorToggle = document.querySelector<HTMLButtonElement>('#ndjson-error-toggle')
const ndjsonErrorDetails = document.querySelector<HTMLDivElement>('#ndjson-error-details')
const ndjsonErrorText = document.querySelector<HTMLPreElement>('#ndjson-error-text')
const ndjsonToggle = document.querySelector<HTMLButtonElement>('#ndjson-toggle')
const ndjsonContainer = document.querySelector<HTMLDivElement>('#ndjson-container')
const ndjsonTextarea = document.querySelector<HTMLTextAreaElement>('#ndjson')
const ndjsonLabel = document.querySelector<HTMLLabelElement>('#ndjson-label')
const randomAllButton = document.querySelector<HTMLButtonElement>('#random-all')
const mixingButton = document.querySelector<HTMLButtonElement>('#mixing')

toggleButton?.focus()

let startingPromise: Promise<void> | null = null
let sequenceUpdatePromise: Promise<void> | null = null

const visuals = createVisuals(nodes)

type NdjsonErrorKind = 'preview' | 'runtime'
let ndjsonErrorKind: NdjsonErrorKind | null = null

type MixingMode = { label: string; gains: Record<Group, number> }

const mixingModes: MixingMode[] = [
  { label: '1:1', gains: { A: 1, B: 1 } },
  { label: '2:1', gains: { A: 1, B: 0.5 } },
  { label: '1:2', gains: { A: 0.5, B: 1 } },
]

let mixingIndex = 0

function updateMixingLabel() {
  if (!mixingButton) return
  mixingButton.textContent = `Mixing ${mixingModes[mixingIndex]?.label ?? '1:1'}`
}

function setMonitorGain(nodeId: number, gain: number) {
  const node = nodes.get(nodeId)
  if (!node) {
    console.warn(`Monitor bus not found for node ID ${nodeId}`)
    return
  }
  if (!(node instanceof Tone.Gain)) {
    console.warn(`Expected Tone.Gain monitor bus for node ID ${nodeId}, but got:`, node)
    return
  }

  const gainParam = node.gain
  const now = Tone.now()
  const rampDuration = 0.01

  if (typeof gainParam.cancelScheduledValues === 'function') {
    gainParam.cancelScheduledValues(now)
  }

  if (
    typeof gainParam.setValueAtTime === 'function' &&
    typeof gainParam.linearRampToValueAtTime === 'function'
  ) {
    const currentValue = typeof gainParam.value === 'number' ? gainParam.value : gain
    gainParam.setValueAtTime(currentValue, now)
    gainParam.linearRampToValueAtTime(gain, now + rampDuration)
  } else if (typeof gainParam.setValueAtTime === 'function') {
    gainParam.setValueAtTime(gain, now)
  } else if (typeof gainParam.value === 'number') {
    gainParam.value = gain
  } else {
    console.warn(`Monitor bus gain param has an unexpected shape for node ID ${nodeId}:`, gainParam)
  }
}

const autoGainManager = createAutoGainManager(nodes)
let autoGains: Record<Group, number> = { A: 1, B: 1 }
let autoGainTimeoutId: number | null = null

function resetAutoGains() {
  autoGains = { A: 1, B: 1 }
}

function applyMixing() {
  const mode = mixingModes[mixingIndex] ?? mixingModes[0]
  setMonitorGain(MONITOR_A_NODE_ID, mode.gains.A * autoGains.A)
  setMonitorGain(MONITOR_B_NODE_ID, mode.gains.B * autoGains.B)
}

function resetMixing() {
  mixingIndex = 0
  updateMixingLabel()
  applyMixing()
}

function cycleMixing() {
  mixingIndex = (mixingIndex + 1) % mixingModes.length
  updateMixingLabel()
  applyMixing()
}

updateMixingLabel()
mixingButton?.addEventListener('click', cycleMixing)

function refreshAutoGain() {
  if (!player.playing) return
  const loopSeconds = getLoopDurationSeconds()
  autoGainManager
    .measure(loopSeconds)
    .then((gains: Record<Group, number>) => {
      autoGains = gains
      applyMixing()
    })
    .catch((error: unknown) => {
      console.warn('Failed to refresh auto gain', error)
    })
}

function scheduleAutoGainRefresh() {
  if (autoGainTimeoutId !== null) {
    window.clearTimeout(autoGainTimeoutId)
    autoGainTimeoutId = null
  }
  if (!player.playing) return
  const loopSeconds = getLoopDurationSeconds()
  if (!Number.isFinite(loopSeconds) || loopSeconds <= 0) return
  autoGainTimeoutId = window.setTimeout(() => {
    autoGainTimeoutId = null
    if (player.playing) {
      refreshAutoGain()
    }
  }, loopSeconds * 1000)
}

function formatErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return `${error}`
  }
}

function setNdjsonError(message: string, detail?: unknown, kind: NdjsonErrorKind = 'runtime') {
  if (!ndjsonError || !ndjsonErrorLabel || !ndjsonErrorToggle || !ndjsonErrorDetails || !ndjsonErrorText) return
  ndjsonErrorKind = kind
  ndjsonErrorLabel.textContent = message
  ndjsonError.removeAttribute('hidden')
  ndjsonErrorToggle.removeAttribute('hidden')
  ndjsonErrorToggle.setAttribute('aria-expanded', 'false')
  ndjsonErrorToggle.textContent = 'Show error'
  ndjsonErrorDetails.setAttribute('hidden', '')
  ndjsonErrorText.textContent = detail !== undefined ? formatErrorDetail(detail) : message
}

function clearNdjsonError(kind?: NdjsonErrorKind) {
  if (kind && ndjsonErrorKind && ndjsonErrorKind !== kind) return
  if (!ndjsonError || !ndjsonErrorToggle || !ndjsonErrorDetails || !ndjsonErrorText) return
  ndjsonErrorKind = null
  ndjsonError.setAttribute('hidden', '')
  ndjsonErrorToggle.setAttribute('aria-expanded', 'false')
  ndjsonErrorToggle.textContent = 'Show error'
  ndjsonErrorDetails.setAttribute('hidden', '')
  ndjsonErrorText.textContent = ''
}

function toggleNdjsonErrorDetails(force?: boolean) {
  if (!ndjsonError || !ndjsonErrorToggle || !ndjsonErrorDetails) return
  if (ndjsonError.hasAttribute('hidden')) return
  const nextOpen = force ?? ndjsonErrorToggle.getAttribute('aria-expanded') !== 'true'
  ndjsonErrorToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')
  ndjsonErrorToggle.textContent = nextOpen ? 'Hide error' : 'Show error'
  if (nextOpen) {
    ndjsonErrorDetails.removeAttribute('hidden')
  } else {
    ndjsonErrorDetails.setAttribute('hidden', '')
  }
}

ndjsonErrorToggle?.addEventListener('click', () => toggleNdjsonErrorDetails())

function toggleNdjsonVisibility(force?: boolean) {
  if (!ndjsonToggle || !ndjsonContainer) return
  const nextOpen = force ?? ndjsonToggle.getAttribute('aria-expanded') !== 'true'
  ndjsonToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')
  ndjsonToggle.textContent = nextOpen ? 'Hide NDJSON' : 'Show NDJSON'
  if (nextOpen) {
    ndjsonContainer.removeAttribute('hidden')
  } else {
    ndjsonContainer.setAttribute('hidden', '')
  }
}

ndjsonToggle?.addEventListener('click', () => toggleNdjsonVisibility())
ndjsonLabel?.addEventListener('click', () => {
  toggleNdjsonVisibility(true)
  ndjsonTextarea?.focus()
})

function previewNdjsonValidation(ndjson: string) {
  try {
    parseNDJSON(ndjson)
    clearNdjsonError('preview')
  } catch (error) {
    setNdjsonError('Failed to parse NDJSON', error, 'preview')
  }
}

function applyToneUpdates(ndjson: string, parsedEvents?: SequenceEvent[]) {
  const events = parsedEvents ?? (() => {
    try {
      return parseNDJSON(ndjson)
    } catch (error) {
      console.warn('Failed to parse NDJSON for tone update', error)
      setNdjsonError('Failed to parse NDJSON', error)
      return null
    }
  })()
  if (!events) return
  events.forEach((event) => {
    if (event.eventType !== 'createNode') return
    const node = nodes.get(event.nodeId)
    if (!node) return
    const args = (event as { args?: unknown }).args
    const options = Array.isArray(args) ? args[0] : args
    if (!options || typeof options !== 'object') return
    if (typeof (node as { set?: unknown }).set === 'function') {
      try {
        ;(node as { set: (value: unknown) => void }).set(options)
      } catch (error) {
        console.warn('Failed to apply tone update', error)
        setNdjsonError('Failed to apply tone update', error)
      }
    }
  })
}

function setStatus(state: 'idle' | 'starting' | 'playing') {
  if (!statusDot || !toggleButton) return

  if (statusLabel) {
    statusLabel.textContent = ''
  }

  if (state === 'idle') {
    statusDot.className = 'dot dot-idle'
    toggleButton.textContent = 'Play'
    toggleButton.disabled = false
  } else if (state === 'starting') {
    statusDot.className = 'dot dot-pending'
    toggleButton.disabled = true
  } else {
    statusDot.className = 'dot dot-active'
    toggleButton.textContent = 'Stop'
    toggleButton.disabled = false
  }
}

function stopLoop() {
  if (!player.playing) return
  if (autoGainTimeoutId !== null) {
    window.clearTimeout(autoGainTimeoutId)
    autoGainTimeoutId = null
  }
  player.stop()
  Tone.Transport.stop()
  disposeFilterLfos()
  nodes.disposeAll()
  setStatus('idle')
  visuals.stopVisuals()
}

async function queueSequenceUpdate() {
  const startup = startingPromise
  if (!player.playing && !startup) return

  const thisUpdate = (sequenceUpdatePromise ?? Promise.resolve()).then(async () => {
    if (startup) {
      await startup
    }
    if (!player.playing) return
    const ndjson = getNdjsonSequence()
    let events: SequenceEvent[] | null = null
    try {
      events = parseNDJSON(ndjson)
    } catch (error) {
      setNdjsonError('Failed to parse NDJSON', error)
      return
    }
    applyToneUpdates(ndjson, events)
    try {
      await player.start(ndjson)
      if (events) {
        applyFilterLfos(nodes, events)
      }
      clearNdjsonError('runtime')
      scheduleAutoGainRefresh()
    } catch (error) {
      setNdjsonError('Failed to apply sequence update', error)
      throw error
    }
  })

  sequenceUpdatePromise = thisUpdate

  try {
    await thisUpdate
  } catch (error) {
    console.error('Failed to apply sequence update', error)
    stopLoop()
  } finally {
    if (sequenceUpdatePromise === thisUpdate) {
      sequenceUpdatePromise = null
    }
  }
}

async function applySequenceChange() {
  buildSequenceFromNotes()
  updateNdjsonDisplay()
  previewNdjsonValidation(getNdjsonSequence())
  await queueSequenceUpdate()
}

initializeNoteGrid(applySequenceChange, queueSequenceUpdate)
updateLoopNote()
updateNdjsonDisplay()
ndjsonTextarea?.addEventListener('input', () => {
  if (!ndjsonTextarea) return
  previewNdjsonValidation(ndjsonTextarea.value)
})
void initializeTonePresets(applySequenceChange)

async function startLoop() {
  if (player.playing) return
  if (startingPromise) return startingPromise

  const thisStart = (async () => {
    setStatus('starting')
    const ndjson = getNdjsonSequence()
    previewNdjsonValidation(ndjson)
    let events: SequenceEvent[] | null = null
    try {
      events = parseNDJSON(ndjson)
    } catch (error) {
      setNdjsonError('Failed to parse NDJSON', error)
      throw error
    }
    await Tone.start()
    Tone.Transport.stop()
    nodes.disposeAll()
    visuals.setupMonitorBus()
    resetAutoGains()
    applyMixing()

    try {
      await player.start(ndjson)
      if (events) {
        applyFilterLfos(nodes, events)
      }
      clearNdjsonError('runtime')
    } catch (error) {
      setNdjsonError('Failed to start loop', error)
      throw error
    }
    setStatus('playing')
    visuals.startVisuals()
    scheduleAutoGainRefresh()
  })()

  startingPromise = thisStart
  try {
    await thisStart
  } catch (error) {
    console.error('Failed to start loop', error)
    setStatus('idle')
    visuals.stopVisuals()
    throw error
  } finally {
    if (startingPromise === thisStart) {
      startingPromise = null
    }
  }
}

toggleButton?.addEventListener('click', () => {
  if (player.playing) {
    stopLoop()
  } else {
    startLoop().catch((error) => {
      console.error('Failed to start loop', error)
      setStatus('idle')
    })
  }
})

randomAllButton?.addEventListener('click', () => {
  resetMixing()
  const noopSequenceChange = () => Promise.resolve()
  const randomizePromise = Promise.all([
    randomizeToneWithRandomPreset('A', noopSequenceChange),
    randomizeToneWithRandomPreset('B', noopSequenceChange),
  ])
    .then(() => randomizeAll(noopSequenceChange))
    .then(() => applySequenceChange())
  if (player.playing) {
    void randomizePromise
    return
  }
  randomizePromise
    .then(() => startLoop())
    .catch((error) => {
      console.error('Failed to randomize all and start loop', error)
      setStatus('idle')
      visuals.stopVisuals()
    })
})
