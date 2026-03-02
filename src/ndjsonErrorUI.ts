export type NdjsonErrorKind = 'preview' | 'runtime'

interface NdjsonErrorElements {
  ndjsonError: HTMLDivElement | null
  ndjsonErrorLabel: HTMLSpanElement | null
  ndjsonErrorToggle: HTMLButtonElement | null
  ndjsonErrorDetails: HTMLDivElement | null
  ndjsonErrorText: HTMLPreElement | null
}

interface NdjsonVisibilityElements {
  ndjsonToggle: HTMLButtonElement | null
  ndjsonContainer: HTMLDivElement | null
}

export function createNdjsonErrorUI(
  errorElements: NdjsonErrorElements,
  visibilityElements: NdjsonVisibilityElements,
) {
  let ndjsonErrorKind: NdjsonErrorKind | null = null
  const { ndjsonError, ndjsonErrorLabel, ndjsonErrorToggle, ndjsonErrorDetails, ndjsonErrorText } =
    errorElements
  const { ndjsonToggle, ndjsonContainer } = visibilityElements

  function formatErrorDetail(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? `${error.name}: ${error.message}`
    }
    if (typeof error === 'string') {
      return error
    }
    try {
      return JSON.stringify(error, null, 2)
    } catch {
      return `${error}`
    }
  }

  function setNdjsonError(
    message: string,
    detail?: unknown,
    kind: NdjsonErrorKind = 'runtime',
  ) {
    if (
      !ndjsonError ||
      !ndjsonErrorLabel ||
      !ndjsonErrorToggle ||
      !ndjsonErrorDetails ||
      !ndjsonErrorText
    )
      return
    ndjsonErrorKind = kind
    ndjsonErrorLabel.textContent = message
    ndjsonError.removeAttribute('hidden')
    ndjsonErrorToggle.removeAttribute('hidden')
    ndjsonErrorToggle.setAttribute('aria-expanded', 'false')
    ndjsonErrorToggle.textContent = 'Show error'
    ndjsonErrorDetails.setAttribute('hidden', '')
    ndjsonErrorText.textContent = detail !== undefined ? formatErrorDetail(detail) : message
  }

  function clearNdjsonError(kind?: NdjsonErrorKind) {
    if (kind && ndjsonErrorKind && ndjsonErrorKind !== kind) return
    if (!ndjsonError || !ndjsonErrorToggle || !ndjsonErrorDetails || !ndjsonErrorText) return
    ndjsonErrorKind = null
    ndjsonError.setAttribute('hidden', '')
    ndjsonErrorToggle.setAttribute('aria-expanded', 'false')
    ndjsonErrorToggle.textContent = 'Show error'
    ndjsonErrorDetails.setAttribute('hidden', '')
    ndjsonErrorText.textContent = ''
  }

  function toggleNdjsonErrorDetails(force?: boolean) {
    if (!ndjsonError || !ndjsonErrorToggle || !ndjsonErrorDetails) return
    if (ndjsonError.hasAttribute('hidden')) return
    const nextOpen = force ?? ndjsonErrorToggle.getAttribute('aria-expanded') !== 'true'
    ndjsonErrorToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')
    ndjsonErrorToggle.textContent = nextOpen ? 'Hide error' : 'Show error'
    if (nextOpen) {
      ndjsonErrorDetails.removeAttribute('hidden')
    } else {
      ndjsonErrorDetails.setAttribute('hidden', '')
    }
  }

  function toggleNdjsonVisibility(force?: boolean) {
    if (!ndjsonToggle || !ndjsonContainer) return
    const nextOpen = force ?? ndjsonToggle.getAttribute('aria-expanded') !== 'true'
    ndjsonToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')
    ndjsonToggle.textContent = nextOpen ? 'Hide NDJSON' : 'Show NDJSON'
    if (nextOpen) {
      ndjsonContainer.removeAttribute('hidden')
    } else {
      ndjsonContainer.setAttribute('hidden', '')
    }
  }

  return { setNdjsonError, clearNdjsonError, toggleNdjsonErrorDetails, toggleNdjsonVisibility }
}
