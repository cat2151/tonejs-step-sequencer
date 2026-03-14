import { describe, expect, it } from 'vitest'
import {
  parseRandomDefinitions,
  applyRandomDefinitionsToMml,
  applyRandomDefinitionsToJson,
  type RandomParamDefinition,
} from '../src/randomTone'

describe('parseRandomDefinitions', () => {
  it('parses array-format entries', () => {
    const defs = parseRandomDefinitions(JSON.stringify([['FMSynth.volume', -1, 0]]))
    expect(defs).toHaveLength(1)
    expect(defs[0]).toMatchObject({ path: 'FMSynth.volume', min: -1, max: 0 })
  })

  it('parses object-format entries', () => {
    const defs = parseRandomDefinitions(JSON.stringify([{ path: 'FMSynth.harmonicity', min: 1, max: 7, integer: true }]))
    expect(defs).toHaveLength(1)
    expect(defs[0]).toMatchObject({ path: 'FMSynth.harmonicity', min: 1, max: 7, integer: true })
  })

  it('parses values entries', () => {
    const defs = parseRandomDefinitions(JSON.stringify([{ path: 'MonoSynth.filter.rolloff', values: [-12, -24, -48, -96] }]))
    expect(defs[0]).toMatchObject({ path: 'MonoSynth.filter.rolloff', values: [-12, -24, -48, -96] })
  })

  it('throws on invalid input', () => {
    expect(() => parseRandomDefinitions('{}')).toThrow()
  })
})

describe('applyRandomDefinitionsToMml', () => {
  const mml = `@FMSynth{
  "volume": 0,
  "harmonicity": 3,
  "envelope": {
    "attack": 0.02
  }
}
o4 l8 c`

  it('applies a definition and changes the value within range', () => {
    const defs: RandomParamDefinition[] = [{ path: 'FMSynth.harmonicity', min: 1, max: 7, integer: true }]
    const result = applyRandomDefinitionsToMml(mml, defs)
    expect(result.applied).toBe(true)
    const parsed = JSON.parse(result.mml.match(/{[\s\S]*}/)?.[0] ?? '{}') as { harmonicity: number }
    expect(parsed.harmonicity).toBeGreaterThanOrEqual(1)
    expect(parsed.harmonicity).toBeLessThanOrEqual(7)
    expect(Number.isInteger(parsed.harmonicity)).toBe(true)
  })

  it('applies a nested definition', () => {
    const defs: RandomParamDefinition[] = [{ path: 'FMSynth.envelope.attack', min: 0.01, max: 0.5 }]
    const result = applyRandomDefinitionsToMml(mml, defs)
    expect(result.applied).toBe(true)
    const parsed = JSON.parse(result.mml.match(/{[\s\S]*}/)?.[0] ?? '{}') as { envelope: { attack: number } }
    expect(parsed.envelope.attack).toBeGreaterThanOrEqual(0.01)
    expect(parsed.envelope.attack).toBeLessThanOrEqual(0.5)
  })

  it('returns applied: false when MML has no JSON blocks', () => {
    const result = applyRandomDefinitionsToMml('o4 l8 c', [{ path: 'FMSynth.volume', min: -1, max: 0 }])
    expect(result.applied).toBe(false)
    expect(result.mml).toBe('o4 l8 c')
  })

  it('returns applied: false when path does not match any block', () => {
    const defs: RandomParamDefinition[] = [{ path: 'MonoSynth.volume', min: -1, max: 0 }]
    const result = applyRandomDefinitionsToMml(mml, defs)
    expect(result.applied).toBe(false)
  })

  it('selects a value from a values list', () => {
    const defs: RandomParamDefinition[] = [{ path: 'FMSynth.harmonicity', values: [1, 2, 4] }]
    const result = applyRandomDefinitionsToMml(mml, defs)
    expect(result.applied).toBe(true)
    const parsed = JSON.parse(result.mml.match(/{[\s\S]*}/)?.[0] ?? '{}') as { harmonicity: number }
    expect([1, 2, 4]).toContain(parsed.harmonicity)
  })
})

describe('applyRandomDefinitionsToJson', () => {
  const eventsJson = JSON.stringify([
    {
      eventType: 'createNode',
      nodeId: 10,
      nodeType: 'FMSynth',
      args: {
        volume: 0,
        harmonicity: 3,
        envelope: { attack: 0.02 },
      },
    },
    {
      eventType: 'createNode',
      nodeId: 11,
      nodeType: 'PingPongDelay',
      args: { wet: 1, feedback: 0.35 },
    },
    { eventType: 'connect', nodeId: 10, connectTo: 11 },
    { eventType: 'connect', nodeId: 11, connectTo: 'toDestination' },
  ])

  it('applies a definition to a matching createNode event', () => {
    const defs: RandomParamDefinition[] = [{ path: 'FMSynth.harmonicity', min: 1, max: 7, integer: true }]
    const result = applyRandomDefinitionsToJson(eventsJson, defs)
    expect(result.applied).toBe(true)
    const events = JSON.parse(result.json) as Array<{ nodeType?: string; args?: { harmonicity?: number } }>
    const fmEvent = events.find((e) => e.nodeType === 'FMSynth')
    expect(fmEvent?.args?.harmonicity).toBeGreaterThanOrEqual(1)
    expect(fmEvent?.args?.harmonicity).toBeLessThanOrEqual(7)
    expect(Number.isInteger(fmEvent?.args?.harmonicity)).toBe(true)
  })

  it('applies a nested path to a matching createNode event', () => {
    const defs: RandomParamDefinition[] = [{ path: 'FMSynth.envelope.attack', min: 0.01, max: 0.5 }]
    const result = applyRandomDefinitionsToJson(eventsJson, defs)
    expect(result.applied).toBe(true)
    const events = JSON.parse(result.json) as Array<{ nodeType?: string; args?: { envelope?: { attack?: number } } }>
    const fmEvent = events.find((e) => e.nodeType === 'FMSynth')
    expect(fmEvent?.args?.envelope?.attack).toBeGreaterThanOrEqual(0.01)
    expect(fmEvent?.args?.envelope?.attack).toBeLessThanOrEqual(0.5)
  })

  it('applies a definition to an effect node', () => {
    const defs: RandomParamDefinition[] = [{ path: 'PingPongDelay.wet', min: 0, max: 1 }]
    const result = applyRandomDefinitionsToJson(eventsJson, defs)
    expect(result.applied).toBe(true)
    const events = JSON.parse(result.json) as Array<{ nodeType?: string; args?: { wet?: number } }>
    const delayEvent = events.find((e) => e.nodeType === 'PingPongDelay')
    expect(delayEvent?.args?.wet).toBeGreaterThanOrEqual(0)
    expect(delayEvent?.args?.wet).toBeLessThanOrEqual(1)
  })

  it('selects a value from a values list', () => {
    const defs: RandomParamDefinition[] = [{ path: 'FMSynth.harmonicity', values: [1, 2, 4] }]
    const result = applyRandomDefinitionsToJson(eventsJson, defs)
    expect(result.applied).toBe(true)
    const events = JSON.parse(result.json) as Array<{ nodeType?: string; args?: { harmonicity?: number } }>
    const fmEvent = events.find((e) => e.nodeType === 'FMSynth')
    expect([1, 2, 4]).toContain(fmEvent?.args?.harmonicity)
  })

  it('does not mutate the original JSON string', () => {
    const defs: RandomParamDefinition[] = [{ path: 'FMSynth.harmonicity', min: 1, max: 7, integer: true }]
    const original = JSON.parse(eventsJson) as Array<{ args?: { harmonicity?: number } }>
    applyRandomDefinitionsToJson(eventsJson, defs)
    const after = JSON.parse(eventsJson) as Array<{ args?: { harmonicity?: number } }>
    expect(after[0]?.args?.harmonicity).toBe(original[0]?.args?.harmonicity)
  })

  it('returns applied: false when path does not match any event', () => {
    const defs: RandomParamDefinition[] = [{ path: 'MonoSynth.volume', min: -1, max: 0 }]
    const result = applyRandomDefinitionsToJson(eventsJson, defs)
    expect(result.applied).toBe(false)
    expect(result.json).toBe(eventsJson)
  })

  it('returns applied: false when JSON is not an array', () => {
    const result = applyRandomDefinitionsToJson('{}', [{ path: 'FMSynth.volume', min: -1, max: 0 }])
    expect(result.applied).toBe(false)
  })

  it('returns applied: false for invalid JSON', () => {
    const result = applyRandomDefinitionsToJson('not-json', [{ path: 'FMSynth.volume', min: -1, max: 0 }])
    expect(result.applied).toBe(false)
  })
})
