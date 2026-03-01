import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BPM, PPQ, SIXTEENTH_TICKS, STEPS } from '../src/constants'
import { buildSequenceFromNotes, getCurrentStep, getLoopDurationSeconds, getNdjsonSequence } from '../src/noteGrid'

const expectedLoopTicks = Math.round(SIXTEENTH_TICKS * STEPS)

describe('noteGrid sequencing', () => {
  beforeEach(() => {
    buildSequenceFromNotes()
  })

  it('builds NDJSON with tone setup, triggers, and loop boundaries', () => {
    const events = getNdjsonSequence()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { eventType?: string; args?: unknown[] })

    const triggerEvents = events.filter((event) => event.eventType === 'triggerAttackRelease')
    const loopEvents = events.filter((event) => event.eventType === 'loopEnd')
    const setupEvents = events.filter(
      (event) => event.eventType === 'createNode' || event.eventType === 'connect',
    )

    expect(events.length).toBe(STEPS * 2 + 6)
    expect(triggerEvents).toHaveLength(STEPS * 2)
    expect(setupEvents).toHaveLength(4)
    expect(loopEvents).toHaveLength(2)
    expect(loopEvents.every((event) => event.args?.[0] === `${expectedLoopTicks}i`)).toBe(true)
  })

  it('computes loop duration using cached ticks', () => {
    const duration = getLoopDurationSeconds()
    expect(duration).toBeGreaterThan(0)
    const expectedSeconds = (expectedLoopTicks / PPQ) * (60 / DEFAULT_BPM)
    expect(duration).toBeCloseTo(expectedSeconds, 5)
  })
})

describe('getCurrentStep', () => {
  beforeEach(() => {
    buildSequenceFromNotes()
  })

  it('returns step 0 at tick 0', () => {
    expect(getCurrentStep(0)).toBe(0)
  })

  it('returns step 0 just before first step boundary', () => {
    expect(getCurrentStep(SIXTEENTH_TICKS - 1)).toBe(0)
  })

  it('returns step 1 at exact first step boundary', () => {
    expect(getCurrentStep(SIXTEENTH_TICKS)).toBe(1)
  })

  it('returns step 1 just before second step boundary', () => {
    expect(getCurrentStep(SIXTEENTH_TICKS * 2 - 1)).toBe(1)
  })

  it('returns step 15 (last step) near end of loop', () => {
    expect(getCurrentStep(expectedLoopTicks - 1)).toBe(STEPS - 1)
  })

  it('wraps around at exactly loopTicks (back to step 0)', () => {
    expect(getCurrentStep(expectedLoopTicks)).toBe(0)
  })

  it('wraps around at loopTicks + SIXTEENTH_TICKS (step 1)', () => {
    expect(getCurrentStep(expectedLoopTicks + SIXTEENTH_TICKS)).toBe(1)
  })
})
