import type { Group } from './constants'
import type { AutoGainManager } from './autoGain'

function formatLufs(lufs: number | null): string {
  if (lufs === null || !Number.isFinite(lufs)) return '--'
  return `${lufs.toFixed(1)} LUFS`
}

function formatGain(gain: number): string {
  return `×${gain.toFixed(2)}`
}

export function createAutoGainDisplay(
  autoGainManager: AutoGainManager,
  displayA: HTMLElement | null,
  displayB: HTMLElement | null,
) {
  const groupElements: ReadonlyArray<[Group, HTMLElement | null]> = [
    ['A', displayA],
    ['B', displayB],
  ]

  function update() {
    const snapshots = autoGainManager.getSnapshots()
    const gains = autoGainManager.getAutoGains()
    for (const [group, el] of groupElements) {
      if (!el) continue
      const snap = snapshots[group]
      const gain = gains[group]
      const beforeLufs = snap.lufs
      const afterLufs =
        beforeLufs !== null && Number.isFinite(beforeLufs) && gain > 0
          ? beforeLufs + 20 * Math.log10(gain)
          : null
      const text = `before: ${formatLufs(beforeLufs)} | gain: ${formatGain(gain)} | after: ${formatLufs(afterLufs)}`
      if (el.textContent !== text) {
        el.textContent = text
      }
    }
  }

  function reset() {
    const placeholder = '--'
    if (displayA && displayA.textContent !== placeholder) {
      displayA.textContent = placeholder
    }
    if (displayB && displayB.textContent !== placeholder) {
      displayB.textContent = placeholder
    }
  }

  return { update, reset }
}
