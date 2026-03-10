import * as Tone from 'tone'
import type { SequencerNodes } from 'tonejs-json-sequencer'
import { MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, type Group } from './constants'

type MixingMode = { label: string; gains: Record<Group, number> }

const mixingModes: MixingMode[] = [
  { label: '1:1', gains: { A: 1, B: 1 } },
  { label: '2:1', gains: { A: 1, B: 0.5 } },
  { label: '1:2', gains: { A: 0.5, B: 1 } },
]

function setMonitorGain(nodes: SequencerNodes, nodeId: number, gain: number) {
  const node = nodes.get(nodeId)
  if (!node) {
    console.warn(`Monitor bus not found for node ID ${nodeId}`)
    return
  }
  if (!(node instanceof Tone.Gain)) {
    console.warn(`Expected Tone.Gain monitor bus for node ID ${nodeId}, but got:`, node)
    return
  }

  const gainParam = node.gain
  const now = Tone.now()
  const rampDuration = 0.01

  if (typeof gainParam.cancelScheduledValues === 'function') {
    gainParam.cancelScheduledValues(now)
  }

  if (
    typeof gainParam.setValueAtTime === 'function' &&
    typeof gainParam.linearRampToValueAtTime === 'function'
  ) {
    const currentValue = typeof gainParam.value === 'number' ? gainParam.value : gain
    gainParam.setValueAtTime(currentValue, now)
    gainParam.linearRampToValueAtTime(gain, now + rampDuration)
  } else if (typeof gainParam.setValueAtTime === 'function') {
    gainParam.setValueAtTime(gain, now)
  } else if (typeof gainParam.value === 'number') {
    gainParam.value = gain
  } else {
    console.warn(`Monitor bus gain param has an unexpected shape for node ID ${nodeId}:`, gainParam)
  }
}

export function createMixingController(nodes: SequencerNodes, mixingButton: HTMLButtonElement | null) {
  let mixingIndex = 0
  let autoGains: Record<Group, number> = { A: 1, B: 1 }

  function updateMixingLabel() {
    if (!mixingButton) return
    mixingButton.textContent = `Mixing ${mixingModes[mixingIndex]?.label ?? '1:1'}`
  }

  function applyMixing() {
    const mode = mixingModes[mixingIndex] ?? mixingModes[0]
    setMonitorGain(nodes, MONITOR_A_NODE_ID, mode.gains.A * autoGains.A)
    setMonitorGain(nodes, MONITOR_B_NODE_ID, mode.gains.B * autoGains.B)
  }

  function resetAutoGains() {
    autoGains = { A: 1, B: 1 }
  }

  function setAutoGains(gains: Record<Group, number>) {
    autoGains = gains
    applyMixing()
  }

  function resetMixing() {
    mixingIndex = 0
    updateMixingLabel()
    applyMixing()
  }

  function cycleMixing() {
    mixingIndex = (mixingIndex + 1) % mixingModes.length
    updateMixingLabel()
    applyMixing()
  }

  updateMixingLabel()
  mixingButton?.addEventListener('click', cycleMixing)

  return { applyMixing, resetAutoGains, setAutoGains, resetMixing }
}
