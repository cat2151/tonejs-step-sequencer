import { describe, expect, it } from 'vitest'
import { MONITOR_A_NODE_ID, GROUP_A_NODE_ID } from '../src/constants'
import { normalizeToneEvents } from '../src/toneState'

describe('normalizeToneEvents', () => {
  it('connects Instrument → Effect → Monitor in series (not Instrument → Monitor and Effect → Monitor)', () => {
    // These are the events that tonejs-mml-to-json generates for "@FMSynth{} @PingPongDelay{} c"
    const rawEvents = [
      { eventType: 'createNode', nodeId: 0, nodeType: 'FMSynth' },
      { eventType: 'createNode', nodeId: 1, nodeType: 'PingPongDelay', args: { wet: 1 } },
      { eventType: 'connect', nodeId: 0, connectTo: 1 },
      { eventType: 'connect', nodeId: 1, connectTo: 'toDestination' },
    ]

    const { events } = normalizeToneEvents(rawEvents as never, 'A')
    const connectEvents = events.filter((e) => (e as { eventType?: string }).eventType === 'connect')

    expect(connectEvents).toHaveLength(2)

    const [instrToEffect, effectToMonitor] = connectEvents as Array<{
      nodeId?: number
      connectTo?: unknown
    }>

    // FMSynth (mapped to GROUP_A_NODE_ID=10) must connect to PingPongDelay (mapped to 11)
    expect(instrToEffect.nodeId).toBe(GROUP_A_NODE_ID)
    expect(instrToEffect.connectTo).toBe(GROUP_A_NODE_ID + 1)

    // PingPongDelay (mapped to 11) must connect to the monitor bus, NOT directly to destination
    expect(effectToMonitor.nodeId).toBe(GROUP_A_NODE_ID + 1)
    expect(effectToMonitor.connectTo).toBe(MONITOR_A_NODE_ID)
  })

  it('handles direct Instrument → toDestination (no effect)', () => {
    const rawEvents = [
      { eventType: 'createNode', nodeId: 0, nodeType: 'Synth' },
      { eventType: 'connect', nodeId: 0, connectTo: 'toDestination' },
    ]

    const { events } = normalizeToneEvents(rawEvents as never, 'A')
    const connectEvents = events.filter((e) => (e as { eventType?: string }).eventType === 'connect')

    expect(connectEvents).toHaveLength(1)
    const [instrToMonitor] = connectEvents as Array<{ nodeId?: number; connectTo?: unknown }>

    expect(instrToMonitor.nodeId).toBe(GROUP_A_NODE_ID)
    expect(instrToMonitor.connectTo).toBe(MONITOR_A_NODE_ID)
  })

  it('correctly identifies the instrument node ID', () => {
    const rawEvents = [
      { eventType: 'createNode', nodeId: 0, nodeType: 'FMSynth' },
      { eventType: 'createNode', nodeId: 1, nodeType: 'PingPongDelay', args: { wet: 1 } },
      { eventType: 'connect', nodeId: 0, connectTo: 1 },
      { eventType: 'connect', nodeId: 1, connectTo: 'toDestination' },
    ]

    const { instrumentNodeId } = normalizeToneEvents(rawEvents as never, 'A')

    expect(instrumentNodeId).toBe(GROUP_A_NODE_ID)
  })
})
