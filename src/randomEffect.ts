/**
 * Local bridge for randomEffectMml / randomInstrumentAndEffectMml.
 * These functions exist in tonejs-mml-to-json src (added in PR #187) but the
 * library dist has not been rebuilt yet. Once the dist is updated and the
 * functions are exported from 'tonejs-mml-to-json', this file can be removed
 * and callers can import directly from the library.
 */
import { randomInstrumentMml } from 'tonejs-mml-to-json'
import defaultEffects from 'tonejs-mml-to-json/tone-edit-effects.json'

type EffectParam = {
  path: string
  min: number
  max: number
  sweetMin?: number
  sweetMax?: number
  defaultValue: number
  step: number
}

type EffectDefinition = {
  id: string
  parameters: EffectParam[]
}

function randomParamValue(param: EffectParam): number {
  const min = param.sweetMin ?? param.min
  const max = param.sweetMax ?? param.max
  const raw = min + Math.random() * (max - min)
  const step = param.step > 0 ? param.step : 0.01
  const stepped = Math.round(raw / step) * step
  return Math.min(Math.max(Number(stepped.toFixed(6)), param.min), param.max)
}

/**
 * Build an args object for the given effect parameters.
 * All effect parameter paths in tone-edit-effects.json are single-level
 * (no dots), so a simple flat object is sufficient and avoids any
 * prototype-chain traversal risk.
 */
function buildEffectArgs(params: EffectParam[]): Record<string, number> {
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
  const result: Record<string, number> = {}
  for (const param of params) {
    if (!DANGEROUS_KEYS.has(param.path) && !param.path.includes('.')) {
      result[param.path] = randomParamValue(param)
    }
  }
  return result
}

export function randomEffectMml(): string {
  const effects = (defaultEffects as EffectDefinition[]).filter((d) => d.id !== 'none')
  if (effects.length === 0) return ''
  const effectDef = effects[Math.floor(Math.random() * effects.length)]
  const args = buildEffectArgs(effectDef.parameters)
  const hasArgs = Object.keys(args).length > 0
  return hasArgs ? `@${effectDef.id}${JSON.stringify(args, null, 2)}` : `@${effectDef.id}`
}

export function randomInstrumentAndEffectMml(): { instrument: string; effect: string } {
  return {
    instrument: randomInstrumentMml(),
    effect: randomEffectMml(),
  }
}
