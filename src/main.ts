import './style.css'
import './controls.css'
import './responsive.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes, parseNDJSON, type SequenceEvent } from 'tonejs-json-sequencer'
import { MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, PPQ, STEPS, type Group } from './constants'
import { createAutoGainManager, MIN_DURATION as AUTO_GAIN_MIN_DURATION } from './autoGain'
import { createAutoGainDisplay } from './autoGainDisplay'
import {
  buildSequenceFromNotes,
  getNdjsonSequence,
  getLoopDurationSeconds,
  initializeNoteGrid,
  randomizeAll,
  updateLoopNote,
  updateNdjsonDisplay,
  getCurrentStepFromSeconds,
  setPlayingStep,
} from './noteGrid'
import { buildAppShell } from './appLayout'
import { createMixingController } from './mixing'
import { initializeTonePresets, randomizeToneWithRandomPreset } from './toneControls'
import { getToneEventsVersion } from './toneState'
import { createVisuals } from './visuals'
import { createNdjsonErrorUI } from './ndjsonErrorUI'

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
const autoGainDisplayA = document.querySelector<HTMLElement>('#auto-gain-a')
const autoGainDisplayB = document.querySelector<HTMLElement>('#auto-gain-b')
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
let lastRestartedToneVersion = -1

// Access playbackState via any-cast since it's private in the library's typedefs,
// consistent with how createdNodeIds is accessed elsewhere in this file.
function getPlayerElapsedSeconds(): number | null {
  const startTime = (player as any).playbackState?.startTime as number | undefined
  if (startTime == null) return null
  return Math.max(0, Tone.now() - startTime)
}

const visuals = createVisuals(nodes, getPlayerElapsedSeconds)

const { setNdjsonError, clearNdjsonError, toggleNdjsonErrorDetails, toggleNdjsonVisibility } =
  createNdjsonErrorUI(
    { ndjsonError, ndjsonErrorLabel, ndjsonErrorToggle, ndjsonErrorDetails, ndjsonErrorText },
    { ndjsonToggle, ndjsonContainer },
  )

const autoGainManager = createAutoGainManager(nodes)
const autoGainDisplay = createAutoGainDisplay(autoGainManager, autoGainDisplayA, autoGainDisplayB)
const { applyMixing, resetAutoGains, setAutoGains, resetMixing } = createMixingController(nodes, mixingButton)
let autoGainTimeoutId: number | null = null
let autoGainStepsCompleted = 0

function getAutoGainDuration(): number {
  const loopSeconds = getLoopDurationSeconds()
  if (autoGainStepsCompleted < STEPS) {
    return loopSeconds / STEPS
  }
  return loopSeconds
}

function refreshAutoGain() {
  if (!player.playing) return
  const durationSeconds = getAutoGainDuration()
  if (autoGainStepsCompleted < STEPS) {
    autoGainStepsCompleted++
  }
  autoGainManager
    .measure(durationSeconds)
    .then((gains: Record<Group, number>) => {
      if (!player.playing) return
      setAutoGains(gains)
    })
    .catch((error: unknown) => {
      console.warn('Failed to refresh auto gain', error)
    })
    .finally(() => {
      scheduleNextAutoGainRefresh()
    })
}

function scheduleNextAutoGainRefresh() {
  if (autoGainTimeoutId !== null) {
    window.clearTimeout(autoGainTimeoutId)
    autoGainTimeoutId = null
  }
  if (!player.playing) return
  const intervalSeconds = Math.max(getAutoGainDuration(), AUTO_GAIN_MIN_DURATION)
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return
  autoGainTimeoutId = window.setTimeout(() => {
    autoGainTimeoutId = null
    if (player.playing) {
      refreshAutoGain()
    }
  }, intervalSeconds * 1000)
}

function scheduleAutoGainRefresh() {
  autoGainStepsCompleted = 0
  scheduleNextAutoGainRefresh()
}

ndjsonErrorToggle?.addEventListener('click', () => toggleNdjsonErrorDetails())

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

function applyToneUpdates(ndjson: string) {
  let events: SequenceEvent[] = []
  try {
    events = parseNDJSON(ndjson)
  } catch (error) {
    console.warn('Failed to parse NDJSON for tone update', error)
    setNdjsonError('Failed to parse NDJSON', error)
    return
  }

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

let stepCursorFrameId: number | null = null

function tickStepCursor() {
  if (!player.playing) {
    stepCursorFrameId = null
    return
  }
  const elapsed = getPlayerElapsedSeconds()
  if (elapsed !== null) {
    setPlayingStep(getCurrentStepFromSeconds(elapsed))
  }
  autoGainDisplay.update()
  stepCursorFrameId = window.requestAnimationFrame(tickStepCursor)
}

function startStepCursor() {
  if (stepCursorFrameId === null) {
    stepCursorFrameId = window.requestAnimationFrame(tickStepCursor)
  }
}

function stopStepCursor() {
  if (stepCursorFrameId !== null) {
    window.cancelAnimationFrame(stepCursorFrameId)
    stepCursorFrameId = null
  }
  setPlayingStep(null)
  autoGainDisplay.reset()
}

function stopLoop() {
  if (!player.playing) return
  if (autoGainTimeoutId !== null) {
    window.clearTimeout(autoGainTimeoutId)
    autoGainTimeoutId = null
  }
  player.stop()
  Tone.Transport.stop()
  nodes.disposeAll()
  setStatus('idle')
  stopStepCursor()
  visuals.stopVisuals()
}

async function seamlessRestart(ndjson: string) {
  // Fade out monitor buses to avoid hearing the spurious note during node recreation
  const now = Tone.now()
  const FADE_SECONDS = 0.015
  const FADE_BUFFER_MS = 5 // extra wall-clock buffer after audio fade completes
  for (const nodeId of [MONITOR_A_NODE_ID, MONITOR_B_NODE_ID]) {
    const node = nodes.get(nodeId)
    if (node instanceof Tone.Gain) {
      node.gain.cancelScheduledValues(now)
      node.gain.setValueAtTime(node.gain.value, now)
      node.gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(FADE_SECONDS * 1000) + FADE_BUFFER_MS))

  // Dispose nodes without stopping the player, so that player.start() below will
  // take the updateEvents() path (not initializePlayback()), preserving the loop position.
  nodes.disposeAll()

  // Clear the player's internal createdNodeIds set so new tone nodes will be recreated
  // by the next player.start() call (via processNewCreateAndConnectEvents).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createdNodeIds: unknown = (player as any).playbackState?.createdNodeIds
  if (createdNodeIds != null) {
    if (typeof (createdNodeIds as { clear?: unknown }).clear === 'function') {
      ;(createdNodeIds as { clear: () => void }).clear()
    } else {
      throw new Error('NDJSONStreamingPlayer.playbackState.createdNodeIds is not a Set-like object')
    }
  }

  // Recreate infrastructure
  visuals.setupMonitorBus()
  resetAutoGains()
  applyMixing()

  // Update events while keeping the current loop position intact.
  // Because player.playing is still true, player.start() calls updateEvents()
  // which preserves startTime and thus does not restart from position 0.
  try {
    await player.start(ndjson)
    scheduleAutoGainRefresh()
  } catch (error) {
    if (autoGainTimeoutId !== null) {
      window.clearTimeout(autoGainTimeoutId)
      autoGainTimeoutId = null
    }
    player.stop()
    Tone.Transport.stop()
    nodes.disposeAll()
    setStatus('idle')
    stopStepCursor()
    visuals.stopVisuals()
    throw error
  }
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
    const currentToneVersion = getToneEventsVersion()
    if (currentToneVersion !== lastRestartedToneVersion) {
      lastRestartedToneVersion = currentToneVersion
      try {
        await seamlessRestart(ndjson)
        clearNdjsonError('runtime')
      } catch (error) {
        setNdjsonError('Failed to apply tone update', error)
        throw error
      }
    } else {
      applyToneUpdates(ndjson)
      try {
        await player.start(ndjson)
        clearNdjsonError('runtime')
        scheduleAutoGainRefresh()
      } catch (error) {
        setNdjsonError('Failed to apply sequence update', error)
        throw error
      }
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
    await Tone.start()
    Tone.Transport.stop()
    nodes.disposeAll()
    visuals.setupMonitorBus()
    resetAutoGains()
    applyMixing()

    try {
      await player.start(ndjson)
      clearNdjsonError('runtime')
    } catch (error) {
      setNdjsonError('Failed to start loop', error)
      throw error
    }
    lastRestartedToneVersion = getToneEventsVersion()
    setStatus('playing')
    startStepCursor()
    visuals.startVisuals()
    scheduleAutoGainRefresh()
  })()

  startingPromise = thisStart
  try {
    await thisStart
  } catch (error) {
    console.error('Failed to start loop', error)
    setStatus('idle')
    stopStepCursor()
    visuals.stopVisuals()
    throw error
  } finally {
    if (startingPromise === thisStart) {
      startingPromise = null
    }
  }
}

function togglePlayStop() {
  if (player.playing) {
    stopLoop()
  } else {
    startLoop().catch((error) => {
      console.error('Failed to start loop', error)
      setStatus('idle')
    })
  }
}

toggleButton?.addEventListener('click', () => {
  togglePlayStop()
})

document.addEventListener('keydown', (e) => {
  if (e.repeat) return
  const target = e.target as HTMLElement | null
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  ) {
    return
  }
  if ((e.shiftKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    togglePlayStop()
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
