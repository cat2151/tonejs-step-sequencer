import { DEFAULT_BPM } from './constants'

export function buildAppShell() {
  return `
    <main class="shell">
      <section class="panel">
        <div class="controls">
          <button id="toggle" type="button" class="primary">Play</button>
          <button id="random-all" type="button" class="note-grid-button">すべてランダム</button>
          <button id="mixing" type="button" class="note-grid-button">Mixing 1:1</button>
          <div class="status">
            <span class="dot dot-idle" id="dot"></span>
            <span id="status-label"></span>
          </div>
        </div>
      </section>
      <section class="panel visuals">
        <div class="visual-layout">
          <div class="note-controls">
            <div class="note-controls-header">
              <label class="field" for="bpm-input">
                <span class="label">BPM</span>
                <input id="bpm-input" class="text-input" type="number" inputmode="decimal" min="1" max="300" value="${DEFAULT_BPM}">
              </label>
              <div class="note-grid-title">
                <p class="label">Note grid</p>
                <div class="note-grid-actions">
                  <button id="random-pitch" type="button" class="note-grid-button">ランダムpitch</button>
                  <button id="random-grid" type="button" class="note-grid-button">ランダムgrid</button>
                </div>
              </div>
          </div>
          <div class="note-grid" id="note-grid"></div>
        </div>
        <div class="visual-grid">
          <div class="auto-gain-monitor">
            <p class="visual-label">Auto gain monitor</p>
            <div class="auto-gain-grid" role="presentation">
              <span class="auto-gain-cell auto-gain-header"></span>
              <span class="auto-gain-cell auto-gain-header">Source dB</span>
              <span class="auto-gain-cell auto-gain-header">Gain</span>
              <span class="auto-gain-cell auto-gain-header">After gain</span>
              <span class="auto-gain-cell auto-gain-group">Group A</span>
              <span class="auto-gain-cell" id="auto-gain-a-source">-- dB</span>
              <span class="auto-gain-cell" id="auto-gain-a-gain">x1.00</span>
              <span class="auto-gain-cell" id="auto-gain-a-applied">-- dB</span>
              <span class="auto-gain-cell auto-gain-group">Group B</span>
              <span class="auto-gain-cell" id="auto-gain-b-source">-- dB</span>
              <span class="auto-gain-cell" id="auto-gain-b-gain">x1.00</span>
              <span class="auto-gain-cell" id="auto-gain-b-applied">-- dB</span>
            </div>
          </div>
          <div class="visual-group">
            <p class="visual-label">Group A</p>
            <canvas id="waveform-a" width="720" height="120" role="img" aria-label="Group A Waveform display"></canvas>
            <p class="visual-timing" id="waveform-a-time"></p>
            <canvas id="fft-a" width="720" height="120" role="img" aria-label="Group A FFT display"></canvas>
              <p class="visual-timing" id="fft-a-time"></p>
            </div>
            <div class="visual-group">
              <p class="visual-label">Group B</p>
              <canvas id="waveform-b" width="720" height="120" role="img" aria-label="Group B Waveform display"></canvas>
              <p class="visual-timing" id="waveform-b-time"></p>
              <canvas id="fft-b" width="720" height="120" role="img" aria-label="Group B FFT display"></canvas>
              <p class="visual-timing" id="fft-b-time"></p>
            </div>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="details">
          <div class="ndjson-header">
            <label class="label" for="ndjson" id="ndjson-label">NDJSON payload</label>
            <div class="ndjson-actions">
              <button
                type="button"
                class="ndjson-toggle"
                id="ndjson-toggle"
                aria-expanded="false"
                aria-controls="ndjson-container"
              >
                Show NDJSON
              </button>
              <div class="ndjson-error" id="ndjson-error" hidden>
                <span class="dot dot-error" aria-hidden="true"></span>
                <span class="ndjson-error-label" id="ndjson-error-label">Error</span>
                <button
                  type="button"
                  class="ndjson-error-button"
                  id="ndjson-error-toggle"
                  aria-expanded="false"
                  aria-controls="ndjson-error-details"
                >
                  Show error
                </button>
              </div>
            </div>
          </div>
          <div
            class="ndjson-error-details"
            id="ndjson-error-details"
            role="region"
            aria-labelledby="ndjson-error-label"
            hidden
          >
            <pre id="ndjson-error-text"></pre>
          </div>
          <div class="ndjson-container" id="ndjson-container" hidden>
            <textarea id="ndjson" class="text-input tone-textarea" rows="8" spellcheck="false"></textarea>
            <p class="note" id="loop-note">Loop runs at ${DEFAULT_BPM} BPM with a 16-step 16n sequence and explicit loop boundary.</p>
          </div>
        </div>
      </section>
    </main>
    <a class="repo-link" href="https://github.com/cat2151/tonejs-step-sequencer" target="_blank" rel="noreferrer noopener">
      cat2151/tonejs-step-sequencer
    </a>
  `
}
