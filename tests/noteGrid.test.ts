import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BPM, PPQ, SIXTEENTH_TICKS, STEPS } from '../src/constants'
import {
  buildSequenceFromNotes,
  getCurrentStep,
  getCurrentStepFromSeconds,
  getLoopDurationSeconds,
  getNdjsonSequence,
  resetStepStates,
  setStepState,
} from '../src/noteGrid'

const expectedLoopTicks = Math.round(SIXTEENTH_TICKS * STEPS)

describe('noteGrid sequencing', () => {
  beforeEach(() => {
    resetStepStates()
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

describe('noteGrid rest/tie states', () => {
  beforeEach(() => {
    resetStepStates()
  })

  it('skips trigger events for rest steps', () => {
    setStepState(0, 'rest')
    buildSequenceFromNotes()
    const events = getNdjsonSequence()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { eventType?: string; args?: unknown[] })
    const triggerEvents = events.filter((event) => event.eventType === 'triggerAttackRelease')
    expect(triggerEvents).toHaveLength((STEPS - 1) * 2)
  })

  it('skips trigger events for tie steps', () => {
    setStepState(1, 'tie')
    buildSequenceFromNotes()
    const events = getNdjsonSequence()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { eventType?: string; args?: unknown[] })
    const triggerEvents = events.filter((event) => event.eventType === 'triggerAttackRelease')
    expect(triggerEvents).toHaveLength((STEPS - 1) * 2)
  })

  it('extends note duration to cover tied steps', () => {
    setStepState(1, 'tie')
    buildSequenceFromNotes()
    const events = getNdjsonSequence()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { eventType?: string; args?: unknown[] })
    const triggerEvents = events.filter((event) => event.eventType === 'triggerAttackRelease')
    // Step 0 now covers 2 sixteenth notes (steps 0 and 1)
    const step0Events = triggerEvents.filter((e) => {
      const args = e.args as string[]
      return args[2] === `+0i`
    })
    expect(step0Events.length).toBe(2)
    expect(step0Events[0]?.args?.[1]).toBe(`${SIXTEENTH_TICKS * 2}i`)
  })

  it('uses single-step tick duration when no ties follow', () => {
    buildSequenceFromNotes()
    const events = getNdjsonSequence()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { eventType?: string; args?: unknown[] })
    const triggerEvents = events.filter((event) => event.eventType === 'triggerAttackRelease')
    // All steps are 'note' with no ties, so each has SIXTEENTH_TICKS duration
    expect(triggerEvents[0]?.args?.[1]).toBe(`${SIXTEENTH_TICKS}i`)
  })

  it('skips multiple consecutive rest steps', () => {
    setStepState(2, 'rest')
    setStepState(5, 'rest')
    setStepState(10, 'rest')
    buildSequenceFromNotes()
    const events = getNdjsonSequence()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { eventType?: string; args?: unknown[] })
    const triggerEvents = events.filter((event) => event.eventType === 'triggerAttackRelease')
    expect(triggerEvents).toHaveLength((STEPS - 3) * 2)
  })

  it('extends duration across multiple consecutive ties', () => {
    setStepState(3, 'tie')
    setStepState(4, 'tie')
    buildSequenceFromNotes()
    const events = getNdjsonSequence()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { eventType?: string; args?: unknown[] })
    const triggerEvents = events.filter((event) => event.eventType === 'triggerAttackRelease')
    // Steps 3 and 4 are ties, so step 2 covers 3 sixteenth notes
    expect(triggerEvents).toHaveLength((STEPS - 2) * 2)
    const step2StartTicks = SIXTEENTH_TICKS * 2
    const step2Events = triggerEvents.filter((e) => {
      const args = e.args as string[]
      return args[2] === `+${step2StartTicks}i`
    })
    expect(step2Events.length).toBe(2)
    expect(step2Events[0]?.args?.[1]).toBe(`${SIXTEENTH_TICKS * 3}i`)
  })
})

describe('getCurrentStep', () => {
  beforeEach(() => {
    resetStepStates()
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

describe('getCurrentStepFromSeconds', () => {
  beforeEach(() => {
    resetStepStates()
    buildSequenceFromNotes()
  })

  const stepSeconds = (SIXTEENTH_TICKS / PPQ) * (60 / DEFAULT_BPM)

  it('returns step 0 at elapsed 0', () => {
    expect(getCurrentStepFromSeconds(0)).toBe(0)
  })

  it('returns step 0 just before first step boundary', () => {
    expect(getCurrentStepFromSeconds(stepSeconds - 0.001)).toBe(0)
  })

  it('returns step 1 at exact first step boundary', () => {
    expect(getCurrentStepFromSeconds(stepSeconds)).toBe(1)
  })

  it('returns step 1 just before second step boundary', () => {
    expect(getCurrentStepFromSeconds(stepSeconds * 2 - 0.001)).toBe(1)
  })

  it('returns step 15 (last step) near end of loop', () => {
    const loopSeconds = getLoopDurationSeconds()
    expect(getCurrentStepFromSeconds(loopSeconds - 0.001)).toBe(STEPS - 1)
  })

  it('wraps around at exactly loopDuration (back to step 0)', () => {
    expect(getCurrentStepFromSeconds(getLoopDurationSeconds())).toBe(0)
  })

  it('wraps around at loopDuration + stepSeconds (step 1)', () => {
    expect(getCurrentStepFromSeconds(getLoopDurationSeconds() + stepSeconds)).toBe(1)
  })
})
