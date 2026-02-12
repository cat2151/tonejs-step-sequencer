import defaultRandomDefinitions from './randomToneDefinitions.json' with { type: 'json' }

export type RandomParamDefinition = { path: string; min: number; max: number; integer?: boolean }
export const DEFAULT_RANDOM_DEFINITIONS = JSON.stringify(defaultRandomDefinitions, null, 2)

type ToneJsonBlock = {
  nodeType: string | null
  jsonStart: number
  jsonEnd: number
  json: Record<string, unknown>
}

const FILTER_ROLLOFF_OPTIONS = [-12, -24, -48, -96]

function adjustRandomValue(path: string, value: number) {
  if (path.endsWith('.rolloff')) {
    return FILTER_ROLLOFF_OPTIONS.reduce((closest, option) => {
      return Math.abs(option - value) < Math.abs(closest - value) ? option : closest
    }, FILTER_ROLLOFF_OPTIONS[0])
  }
  return value
}

function normalizeRandomEntry(entry: unknown, index: number): RandomParamDefinition {
  if (Array.isArray(entry)) {
    const [path, min, max, integer] = entry
    if (typeof path !== 'string' || typeof min !== 'number' || typeof max !== 'number') {
      throw new Error(`Entry at index ${index} must be [path, min, max, integer?]`)
    }
    return { path, min, max, integer: typeof integer === 'boolean' ? integer : undefined }
  }
  if (entry && typeof entry === 'object') {
    const path = (entry as { path?: unknown }).path ?? (entry as { name?: unknown }).name
    const min = (entry as { min?: unknown }).min
    const max = (entry as { max?: unknown }).max
    const integer = (entry as { integer?: unknown }).integer
    if (typeof path !== 'string' || typeof min !== 'number' || typeof max !== 'number') {
      throw new Error(`Entry at index ${index} must include path, min, and max`)
    }
    return { path, min, max, integer: typeof integer === 'boolean' ? integer : undefined }
  }
  throw new Error(`Entry at index ${index} must be an array or object`)
}

export function parseRandomDefinitions(text: string): RandomParamDefinition[] {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Random tone definition JSON must be an array')
  }
  return parsed.map((entry, index) => normalizeRandomEntry(entry, index))
}

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
  const pattern = /@([A-Za-z0-9_]+)\s*{/g
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
        blocks.push({
          nodeType: match[1] ?? null,
          jsonStart: braceIndex,
          jsonEnd: endIndex,
          json: parsed as Record<string, unknown>,
        })
      }
    } catch (error) {
      throw new Error('ランダム適用対象のトーンJSONが壊れています')
    }
    pattern.lastIndex = endIndex + 1
  }
  return blocks
}

function setValueAtPath(target: unknown, segments: string[], value: number) {
  if (!target || typeof target !== 'object') return false
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

export function applyRandomDefinitionsToMml(mmlText: string, definitions: RandomParamDefinition[]) {
  const blocks = extractToneJsonBlocks(mmlText)
  if (!blocks.length) return { applied: false, mml: mmlText }

  let applied = false
  definitions.forEach((definition) => {
    if (typeof definition.min !== 'number' || typeof definition.max !== 'number') return
    const min = Math.min(definition.min, definition.max)
    const max = Math.max(definition.min, definition.max)
    const nodeSegments = definition.path.split('.')
    const candidateNodeType = nodeSegments.length > 1 ? nodeSegments[0] ?? '' : ''
    const hasNodePrefix = Boolean(candidateNodeType) && blocks.some((block) => block.nodeType === candidateNodeType)
    const pathSegments = hasNodePrefix ? nodeSegments.slice(1) : nodeSegments
    const randomValue = min + Math.random() * (max - min)
    const numericValue = definition.integer
      ? (() => {
          const intMin = Math.ceil(min)
          const intMax = Math.floor(max)
          if (intMin <= intMax) {
            return intMin + Math.floor(Math.random() * (intMax - intMin + 1))
          }
          const rounded = Math.round(randomValue)
          return Math.min(Math.max(rounded, min), max)
        })()
      : Math.round(randomValue * 1000) / 1000
    const valueToSet = adjustRandomValue(definition.path, numericValue)
    for (const block of blocks) {
      if (hasNodePrefix && block.nodeType !== candidateNodeType) continue
      if (setValueAtPath(block.json, pathSegments, valueToSet)) {
        applied = true
        break
      }
    }
  })

  if (!applied) return { applied: false, mml: mmlText }
  return { applied: true, mml: rebuildMmlFromBlocks(mmlText, blocks) }
}
