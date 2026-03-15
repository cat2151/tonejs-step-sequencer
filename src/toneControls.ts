import type { Group } from './constants'
import {
  applyJsonToToneState,
  applyMmlToToneState,
  getPresetById,
  toneControls,
  tonePresets,
  toneStates,
} from './toneState'
import { randomInstrumentMml } from 'tonejs-mml-to-json'

type SequenceChangeHandler = () => Promise<void>

const toneMmlPromises: Record<Group, Promise<void>> = { A: Promise.resolve(), B: Promise.resolve() }

async function randomizeTone(
  group: Group,
  onSequenceChange: SequenceChangeHandler,
  options?: { clearMmlInputTimeout?: () => void },
) {
  const controls = toneControls[group]
  if (!controls) return false
  const mml = randomInstrumentMml()
  if (!mml) {
    console.warn('randomInstrumentMml returned a falsy value')
    return false
  }
  options?.clearMmlInputTimeout?.()
  controls.mmlTextarea.value = mml
  await handleToneMmlChange(group, mml, onSequenceChange)
  return true
}

export function setToneSectionOpen(group: Group, open: boolean) {
  const controls = toneControls[group]
  if (!controls) return
  toneStates[group].open = open
  controls.body.classList.toggle('collapsed', !open)
  if (open) {
    controls.body.removeAttribute('hidden')
  } else {
    controls.body.setAttribute('hidden', '')
  }
  controls.toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
}

export function updateToneStatus(group: Group) {
  const controls = toneControls[group]
  if (!controls) return
  const hasError = Boolean(toneStates[group].error)
  controls.status.textContent = hasError ? toneStates[group].error : 'Ready'
  controls.status.className = `tone-status ${hasError ? 'tone-status-error' : 'tone-status-ok'}`
}

export function updateToneControls(group: Group) {
  const controls = toneControls[group]
  if (!controls) return
  controls.presetSelect.value = toneStates[group].presetId
  if (
    document.activeElement !== controls.mmlTextarea &&
    controls.mmlTextarea.value !== toneStates[group].mmlText
  ) {
    controls.mmlTextarea.value = toneStates[group].mmlText
  }
  if (
    document.activeElement !== controls.jsonTextarea &&
    controls.jsonTextarea.value !== toneStates[group].jsonText
  ) {
    controls.jsonTextarea.value = toneStates[group].jsonText
  }
  setToneSectionOpen(group, toneStates[group].open)
  updateToneStatus(group)
}

export function toggleToneSection(group: Group) {
  setToneSectionOpen(group, !toneStates[group].open)
}

export async function handleTonePresetChange(group: Group, presetId: string, onSequenceChange: SequenceChangeHandler) {
  toneStates[group].presetId = presetId
  const preset = getPresetById(presetId)
  if (!preset) return
  toneStates[group].mmlText = preset.mml
  const controls = toneControls[group]
  if (controls) {
    controls.mmlTextarea.value = preset.mml
  }
  await handleToneMmlChange(group, preset.mml, onSequenceChange)
}

export async function handleToneMmlChange(group: Group, mmlText: string, onSequenceChange: SequenceChangeHandler) {
  toneMmlPromises[group] = toneMmlPromises[group].then(async () => {
    await applyMmlToToneState(group, mmlText)
    updateToneControls(group)
    await onSequenceChange()
  })
  await toneMmlPromises[group]
}

export async function handleToneJsonChange(group: Group, jsonText: string, onSequenceChange: SequenceChangeHandler) {
  applyJsonToToneState(group, jsonText)
  updateToneControls(group)
  await onSequenceChange()
}

export function renderToneControl(group: Group, noteGrid: HTMLDivElement | null, onSequenceChange: SequenceChangeHandler) {
  if (!noteGrid) return
  const section = document.createElement('div')
  section.className = 'tone-section'

  const header = document.createElement('div')
  header.className = 'tone-section-header'
  const headerMain = document.createElement('div')
  headerMain.className = 'tone-section-header-main'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'tone-toggle'
  toggle.textContent = `Group ${group} Tone`
  toggle.setAttribute('aria-expanded', 'false')

  const randomizeButton = document.createElement('button')
  randomizeButton.type = 'button'
  randomizeButton.className = 'random-button tone-random-button'
  randomizeButton.textContent = 'ランダム音色'

  const status = document.createElement('span')
  status.className = 'tone-status tone-status-ok'
  status.textContent = 'Ready'

  headerMain.appendChild(toggle)
  headerMain.appendChild(randomizeButton)
  header.appendChild(headerMain)
  header.appendChild(status)
  section.appendChild(header)

  const body = document.createElement('div')
  body.className = 'tone-body collapsed'
  body.setAttribute('hidden', '')

  const presetLabel = document.createElement('label')
  presetLabel.className = 'field'
  const presetSpan = document.createElement('span')
  presetSpan.className = 'label'
  presetSpan.textContent = 'Tone preset (MML)'
  const presetSelect = document.createElement('select')
  presetSelect.className = 'text-input'
  tonePresets.forEach((preset) => {
    const option = document.createElement('option')
    option.value = preset.id
    option.textContent = preset.label
    presetSelect.appendChild(option)
  })
  presetLabel.appendChild(presetSpan)
  presetLabel.appendChild(presetSelect)
  body.appendChild(presetLabel)

  const mmlLabel = document.createElement('label')
  mmlLabel.className = 'field'
  const mmlSpan = document.createElement('span')
  mmlSpan.className = 'label'
  mmlSpan.textContent = 'MML edit'
  const mmlTextarea = document.createElement('textarea')
  mmlTextarea.className = 'text-input tone-textarea'
  mmlTextarea.rows = 4
  mmlLabel.appendChild(mmlSpan)
  mmlLabel.appendChild(mmlTextarea)
  body.appendChild(mmlLabel)

  const jsonLabel = document.createElement('label')
  jsonLabel.className = 'field'
  const jsonSpan = document.createElement('span')
  jsonSpan.className = 'label'
  jsonSpan.textContent = 'JSON edit'
  const jsonTextarea = document.createElement('textarea')
  jsonTextarea.className = 'text-input tone-textarea'
  jsonTextarea.rows = 4
  jsonLabel.appendChild(jsonSpan)
  jsonLabel.appendChild(jsonTextarea)
  body.appendChild(jsonLabel)

  section.appendChild(body)
  noteGrid.appendChild(section)

  let mmlInputTimeout: number | null = null
  const clearMmlInputTimeout = () => {
    if (mmlInputTimeout !== null) {
      window.clearTimeout(mmlInputTimeout)
      mmlInputTimeout = null
    }
  }
  let jsonInputTimeout: number | null = null
  const clearJsonInputTimeout = () => {
    if (jsonInputTimeout !== null) {
      window.clearTimeout(jsonInputTimeout)
      jsonInputTimeout = null
    }
  }
  toneControls[group] = {
    toggle,
    body,
    presetSelect,
    mmlTextarea,
    jsonTextarea,
    status,
    clearMmlInputTimeout,
  }
  toggle.addEventListener('click', () => toggleToneSection(group))
  presetSelect.addEventListener('change', () => {
    void handleTonePresetChange(group, presetSelect.value, onSequenceChange)
  })
  mmlTextarea.addEventListener('input', () => {
    clearMmlInputTimeout()
    mmlInputTimeout = window.setTimeout(() => {
      void handleToneMmlChange(group, mmlTextarea.value, onSequenceChange)
      mmlInputTimeout = null
    }, 300)
  })
  mmlTextarea.addEventListener('change', () => {
    clearMmlInputTimeout()
    void handleToneMmlChange(group, mmlTextarea.value, onSequenceChange)
  })
  jsonTextarea.addEventListener('input', () => {
    clearJsonInputTimeout()
    jsonInputTimeout = window.setTimeout(() => {
      void handleToneJsonChange(group, jsonTextarea.value, onSequenceChange)
      jsonInputTimeout = null
    }, 300)
  })
  jsonTextarea.addEventListener('change', () => {
    clearJsonInputTimeout()
    void handleToneJsonChange(group, jsonTextarea.value, onSequenceChange)
  })
  randomizeButton.addEventListener('click', () => {
    void randomizeTone(group, onSequenceChange, { clearMmlInputTimeout })
  })

  updateToneControls(group)
}

export async function randomizeToneWithRandomPreset(
  group: Group,
  onSequenceChange: SequenceChangeHandler,
) {
  const controls = toneControls[group]
  const clearMmlInputTimeout =
    controls?.clearMmlInputTimeout ?? (() => undefined)
  return randomizeTone(group, onSequenceChange, { clearMmlInputTimeout })
}

export async function initializeTonePresets(onSequenceChange: SequenceChangeHandler) {
  const groups: Group[] = ['A', 'B']
  for (const group of groups) {
    const preset = getPresetById(toneStates[group].presetId)
    if (preset) {
      toneStates[group].mmlText = preset.mml
    }
    updateToneControls(group)
    if (preset?.mml) {
      await applyMmlToToneState(group, preset.mml)
      updateToneControls(group)
    }
  }
  void onSequenceChange()
}
