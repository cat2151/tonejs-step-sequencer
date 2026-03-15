import { describe, expect, it } from 'vitest'
import {
  applyRandomDefinitionsToMml,
  parseRandomDefinitions,
  DEFAULT_RANDOM_DEFINITIONS,
} from '../src/randomTone'

const SAMPLE_MML = `@FMSynth{
  "harmonicity": 3,
  "modulationIndex": 10,
  "envelope": {
    "attack": 0.02,
    "decay": 0.15,
    "sustain": 0.6,
    "release": 0.8
  }
}
o4 l8 cdefgab<c`

describe('applyRandomDefinitionsToMml (pure function with injectable rng)', () => {
  it('returns applied:false when no tone JSON blocks are found', () => {
    const result = applyRandomDefinitionsToMml('o4 l8 cdef', [], () => 0.5)
    expect(result.applied).toBe(false)
    expect(result.mml).toBe('o4 l8 cdef')
  })

  it('is deterministic when given a fixed rng', () => {
    const definitions = parseRandomDefinitions(DEFAULT_RANDOM_DEFINITIONS)
    const rng = () => 0.5
    const result1 = applyRandomDefinitionsToMml(SAMPLE_MML, definitions, rng)
    const result2 = applyRandomDefinitionsToMml(SAMPLE_MML, definitions, rng)
    expect(result1.mml).toBe(result2.mml)
    expect(result1.applied).toBe(result2.applied)
  })

  it('produces different output for different rng values', () => {
    const definitions = parseRandomDefinitions(
      JSON.stringify([['FMSynth.harmonicity', 1, 10]]),
    )
    const result0 = applyRandomDefinitionsToMml(SAMPLE_MML, definitions, () => 0)
    const result1 = applyRandomDefinitionsToMml(SAMPLE_MML, definitions, () => 1)
    expect(result0.applied).toBe(true)
    expect(result1.applied).toBe(true)
    expect(result0.mml).not.toBe(result1.mml)
  })

  it('uses Math.random by default (no rng argument needed)', () => {
    const definitions = parseRandomDefinitions(DEFAULT_RANDOM_DEFINITIONS)
    const result = applyRandomDefinitionsToMml(SAMPLE_MML, definitions)
    expect(result.applied).toBe(true)
  })

  it('applies values-array definition deterministically', () => {
    const definitions = parseRandomDefinitions(
      JSON.stringify([['FMSynth.harmonicity', [1, 2, 3]]]),
    )
    // rng returning 0 picks index 0 -> value 1
    const result = applyRandomDefinitionsToMml(SAMPLE_MML, definitions, () => 0)
    expect(result.applied).toBe(true)
    expect(result.mml).toContain('"harmonicity": 1')
  })

  it('clamps values-array index when rng returns exactly 1', () => {
    const definitions = parseRandomDefinitions(
      JSON.stringify([['FMSynth.harmonicity', [1, 2, 3]]]),
    )
    // rng=1 must not go out of bounds; should pick the last element (3)
    const result = applyRandomDefinitionsToMml(SAMPLE_MML, definitions, () => 1)
    expect(result.applied).toBe(true)
    expect(result.mml).toContain('"harmonicity": 3')
  })

  it('clamps integer range result when rng returns exactly 1', () => {
    const definitions = parseRandomDefinitions(
      JSON.stringify([['FMSynth.harmonicity', 1, 5, true]]),
    )
    // rng=1 must produce at most intMax (5), not 6
    const result = applyRandomDefinitionsToMml(SAMPLE_MML, definitions, () => 1)
    expect(result.applied).toBe(true)
    const match = result.mml.match(/"harmonicity":\s*(\d+)/)
    expect(match).not.toBeNull()
    const value = Number(match![1])
    expect(value).toBeLessThanOrEqual(5)
  })
})
