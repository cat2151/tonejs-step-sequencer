import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BPM, PPQ, SIXTEENTH_TICKS, STEPS } from '../src/constants'
import { buildSequenceFromNotes, getLoopDurationSeconds, getNdjsonSequence } from '../src/noteGrid'

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
