import type { Group } from './constants'
import {
  applyJsonToToneState,
  applyMmlToToneState,
  getPresetById,
  toneControls,
  tonePresets,
  toneStates,
} from './toneState'

type SequenceChangeHandler = () => Promise<void>

const toneMmlPromises: Record<Group, Promise<void>> = { A: Promise.resolve(), B: Promise.resolve() }

type RandomParamDefinition = { path: string; min: number; max: number }
type RandomState = { text: string; open: boolean; error: string; saveTimeout: number | null }

const RANDOM_STORAGE_KEY = 'tonejs-random-definitions'
const DEFAULT_RANDOM_DEFINITIONS = JSON.stringify(
  [
    ['envelope.attack', 0.02, 0.35],
    ['envelope.decay', 0.08, 0.8],
    ['envelope.sustain', 0.25, 0.95],
    ['envelope.release', 0.35, 1.6],
    ['detune', -60, 60],
    ['harmonicity', 0.6, 7],
  ],
  null,
  2,
)
const randomStates: Record<Group, RandomState> = {
  A: { text: '', open: false, error: '', saveTimeout: null },
  B: { text: '', open: false, error: '', saveTimeout: null },
}

function getRandomStorageKey(group: Group) {
  return `${RANDOM_STORAGE_KEY}-${group}`
}

function loadRandomDefinitions(group: Group) {
  if (randomStates[group].text) return randomStates[group].text
  const key = getRandomStorageKey(group)
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      randomStates[group].text = stored
      return stored
    }
  } catch (error) {
    console.warn('Failed to read random tone definitions', error)
  }
  randomStates[group].text = DEFAULT_RANDOM_DEFINITIONS
  return DEFAULT_RANDOM_DEFINITIONS
}

function scheduleRandomSave(group: Group, text: string) {
  const state = randomStates[group]
  if (state.saveTimeout !== null) {
    window.clearTimeout(state.saveTimeout)
  }
  state.saveTimeout = window.setTimeout(() => {
    try {
      localStorage.setItem(getRandomStorageKey(group), text)
    } catch (error) {
      console.warn('Failed to persist random tone definitions', error)
    }
    state.saveTimeout = null
  }, 400)
}

function setRandomError(group: Group, message: string) {
  randomStates[group].error = message
  const controls = toneControls[group]
  if (!controls) return
  if (message) {
    controls.randomError.textContent = message
    controls.randomError.removeAttribute('hidden')
  } else {
    controls.randomError.textContent = ''
    controls.randomError.setAttribute('hidden', '')
  }
}

function setRandomSectionOpen(group: Group, open: boolean) {
  randomStates[group].open = open
  const controls = toneControls[group]
  if (!controls) return
  controls.randomBody.classList.toggle('collapsed', !open)
  if (open) {
    controls.randomBody.removeAttribute('hidden')
  } else {
    controls.randomBody.setAttribute('hidden', '')
  }
  controls.randomToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
}

function normalizeRandomEntry(entry: unknown, index: number): RandomParamDefinition {
  if (Array.isArray(entry)) {
    const [path, min, max] = entry
    if (typeof path !== 'string' || typeof min !== 'number' || typeof max !== 'number') {
      throw new Error(`Entry at index ${index} must be [path, min, max]`)
    }
    return { path, min, max }
  }
  if (entry && typeof entry === 'object') {
    const path = (entry as { path?: unknown }).path ?? (entry as { name?: unknown }).name
    const min = (entry as { min?: unknown }).min
    const max = (entry as { max?: unknown }).max
    if (typeof path !== 'string' || typeof min !== 'number' || typeof max !== 'number') {
      throw new Error(`Entry at index ${index} must include path, min, and max`)
    }
    return { path, min, max }
  }
  throw new Error(`Entry at index ${index} must be an array or object`)
}

function parseRandomDefinitions(text: string): RandomParamDefinition[] {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Random tone definition JSON must be an array')
  }
  return parsed.map((entry, index) => normalizeRandomEntry(entry, index))
}

type ToneJsonBlock = { jsonStart: number; jsonEnd: number; json: Record<string, unknown> }

function findMatchingBrace(text: string, startIndex: number) {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (char === '\\') {
      escape = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

function extractToneJsonBlocks(mmlText: string): ToneJsonBlock[] {
  const blocks: ToneJsonBlock[] = []
  const pattern = /@[A-Za-z0-9_]+\s*{/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(mmlText)) !== null) {
    const braceIndex = mmlText.indexOf('{', match.index)
    if (braceIndex === -1) continue
    const endIndex = findMatchingBrace(mmlText, braceIndex)
    if (endIndex === -1) continue
    const jsonText = mmlText.slice(braceIndex, endIndex + 1)
    try {
      const parsed = JSON.parse(jsonText) as unknown
      if (parsed && typeof parsed === 'object') {
        blocks.push({ jsonStart: braceIndex, jsonEnd: endIndex, json: parsed as Record<string, unknown> })
      }
    } catch (error) {
      console.warn('Failed to parse tone JSON block', error)
    }
    pattern.lastIndex = endIndex + 1
  }
  return blocks
}

function setValueAtPath(target: unknown, path: string, value: number) {
  if (!target || typeof target !== 'object') return false
  const segments = path.split('.')
  let current: unknown = target
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] ?? ''
    const isLast = i === segments.length - 1
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false
      if (isLast) {
        if (typeof current[index] !== 'number') return false
        current[index] = value
        return true
      }
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object') return false
    const container = current as Record<string, unknown>
    if (!(segment in container)) return false
    if (isLast) {
      if (typeof container[segment] !== 'number') return false
      container[segment] = value
      return true
    }
    current = container[segment]
  }
  return false
}

function rebuildMmlFromBlocks(mmlText: string, blocks: ToneJsonBlock[]) {
  let result = ''
  let cursor = 0
  blocks.forEach((block) => {
    result += mmlText.slice(cursor, block.jsonStart)
    result += JSON.stringify(block.json, null, 2)
    cursor = block.jsonEnd + 1
  })
  result += mmlText.slice(cursor)
  return result
}

function applyRandomDefinitionsToMml(mmlText: string, definitions: RandomParamDefinition[]) {
  const blocks = extractToneJsonBlocks(mmlText)
  if (!blocks.length) return { applied: false, mml: mmlText }

  let applied = false
  definitions.forEach((definition) => {
    if (typeof definition.min !== 'number' || typeof definition.max !== 'number') return
    const min = Math.min(definition.min, definition.max)
    const max = Math.max(definition.min, definition.max)
    const randomValue = min + Math.random() * (max - min)
    const rounded = Math.round(randomValue * 1000) / 1000
    for (const block of blocks) {
      if (setValueAtPath(block.json, definition.path, rounded)) {
        applied = true
        break
      }
    }
  })

  if (!applied) return { applied: false, mml: mmlText }
  return { applied: true, mml: rebuildMmlFromBlocks(mmlText, blocks) }
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
  controls.jsonTextarea.value = toneStates[group].jsonText
  const randomText = loadRandomDefinitions(group)
  if (
    document.activeElement !== controls.randomTextarea &&
    controls.randomTextarea.value !== randomText
  ) {
    controls.randomTextarea.value = randomText
  }
  setRandomSectionOpen(group, randomStates[group].open)
  setRandomError(group, randomStates[group].error)
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

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'tone-toggle'
  toggle.textContent = `Group ${group} Tone`
  toggle.setAttribute('aria-expanded', 'false')

  const status = document.createElement('span')
  status.className = 'tone-status tone-status-ok'
  status.textContent = 'Ready'

  header.appendChild(toggle)
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

  const randomSection = document.createElement('div')
  randomSection.className = 'random-section'
  const randomHeader = document.createElement('div')
  randomHeader.className = 'random-header'
  const randomToggle = document.createElement('button')
  randomToggle.type = 'button'
  randomToggle.className = 'random-toggle'
  randomToggle.textContent = 'ランダム'
  randomToggle.setAttribute('aria-expanded', 'false')
  randomHeader.appendChild(randomToggle)
  randomSection.appendChild(randomHeader)

  const randomBody = document.createElement('div')
  randomBody.className = 'random-body collapsed'
  randomBody.setAttribute('hidden', '')

  const randomActions = document.createElement('div')
  randomActions.className = 'random-actions'
  const randomizeButton = document.createElement('button')
  randomizeButton.type = 'button'
  randomizeButton.className = 'random-button'
  randomizeButton.textContent = 'ランダム音色'
  const randomExportButton = document.createElement('button')
  randomExportButton.type = 'button'
  randomExportButton.className = 'random-button secondary'
  randomExportButton.textContent = 'export'
  const randomImportButton = document.createElement('button')
  randomImportButton.type = 'button'
  randomImportButton.className = 'random-button secondary'
  randomImportButton.textContent = 'import'
  randomActions.appendChild(randomizeButton)
  randomActions.appendChild(randomExportButton)
  randomActions.appendChild(randomImportButton)

  const randomError = document.createElement('div')
  randomError.className = 'random-error'
  randomError.setAttribute('hidden', '')

  const randomLabel = document.createElement('label')
  randomLabel.className = 'field'
  const randomSpan = document.createElement('span')
  randomSpan.className = 'label'
  randomSpan.textContent = 'ランダム音色定義JSON'
  const randomTextarea = document.createElement('textarea')
  randomTextarea.className = 'text-input tone-textarea'
  randomTextarea.rows = 4
  randomTextarea.spellcheck = false
  randomLabel.appendChild(randomSpan)
  randomLabel.appendChild(randomTextarea)

  const randomFileInput = document.createElement('input')
  randomFileInput.type = 'file'
  randomFileInput.accept = 'application/json'
  randomFileInput.setAttribute('hidden', '')

  randomBody.appendChild(randomActions)
  randomBody.appendChild(randomError)
  randomBody.appendChild(randomLabel)
  randomBody.appendChild(randomFileInput)
  randomSection.appendChild(randomBody)
  body.appendChild(randomSection)

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

  toneControls[group] = {
    toggle,
    body,
    presetSelect,
    mmlTextarea,
    jsonTextarea,
    status,
    randomToggle,
    randomBody,
    randomTextarea,
    randomError,
  }

  let mmlInputTimeout: number | null = null
  toggle.addEventListener('click', () => toggleToneSection(group))
  presetSelect.addEventListener('change', () => {
    void handleTonePresetChange(group, presetSelect.value, onSequenceChange)
  })
  mmlTextarea.addEventListener('input', () => {
    if (mmlInputTimeout !== null) {
      window.clearTimeout(mmlInputTimeout)
    }
    mmlInputTimeout = window.setTimeout(() => {
      void handleToneMmlChange(group, mmlTextarea.value, onSequenceChange)
      mmlInputTimeout = null
    }, 300)
  })
  mmlTextarea.addEventListener('change', () => {
    if (mmlInputTimeout !== null) {
      window.clearTimeout(mmlInputTimeout)
      mmlInputTimeout = null
    }
    void handleToneMmlChange(group, mmlTextarea.value, onSequenceChange)
  })
  jsonTextarea.addEventListener('change', () => {
    void handleToneJsonChange(group, jsonTextarea.value, onSequenceChange)
  })
  randomToggle.addEventListener('click', () => {
    setRandomSectionOpen(group, !randomStates[group].open)
  })
  randomTextarea.addEventListener('input', () => {
    randomStates[group].text = randomTextarea.value
    scheduleRandomSave(group, randomTextarea.value)
    setRandomError(group, '')
  })
  randomizeButton.addEventListener('click', () => {
    let definitions: RandomParamDefinition[] = []
    try {
      definitions = parseRandomDefinitions(randomTextarea.value)
    } catch (error) {
      console.warn('Failed to parse random tone definitions', error)
      setRandomError(group, 'ランダム音色定義JSONのパースに失敗しました')
      return
    }
    const currentMml = mmlTextarea.value || toneStates[group].mmlText
    const result = applyRandomDefinitionsToMml(currentMml, definitions)
    if (!result.applied) {
      setRandomError(group, '適用できるパラメータが見つかりませんでした')
      return
    }
    setRandomError(group, '')
    randomStates[group].text = randomTextarea.value
    scheduleRandomSave(group, randomTextarea.value)
    mmlTextarea.value = result.mml
    void handleToneMmlChange(group, result.mml, onSequenceChange)
  })
  randomExportButton.addEventListener('click', () => {
    const text = randomTextarea.value || '[]'
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `random-tone-${group}.json`
    link.click()
    URL.revokeObjectURL(url)
  })
  randomImportButton.addEventListener('click', () => {
    randomFileInput.value = ''
    randomFileInput.click()
  })
  randomFileInput.addEventListener('change', () => {
    const file = randomFileInput.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (!text) return
      try {
        parseRandomDefinitions(text)
        randomTextarea.value = text
        randomStates[group].text = text
        scheduleRandomSave(group, text)
        setRandomError(group, '')
      } catch (error) {
        console.warn('Failed to parse imported random tone definitions', error)
        setRandomError(group, 'インポートしたJSONを読み込めませんでした')
      }
    }
    reader.readAsText(file)
  })

  const initialRandomText = loadRandomDefinitions(group)
  randomTextarea.value = initialRandomText
  updateToneControls(group)
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
