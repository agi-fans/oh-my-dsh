/**
 * Procedural 120 BPM electronic soundtrack + frame-locked UI SFX generator
 * for the Oh My DSH 72-second Flagship Bilingual Promotional Video (4320 frames @ 60fps).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SR = 48000
const DURATION = 72.0
const TOTAL_SAMPLES = Math.floor(SR * DURATION)
const BPM = 120
const BEAT = 60 / BPM // 0.5s

const L = new Float32Array(TOTAL_SAMPLES)
const R = new Float32Array(TOTAL_SAMPLES)

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12)
}

let seed = 20261122
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return (seed / 0xffffffff) * 2 - 1
}

function addSample(idx, valL, valR) {
  if (idx >= 0 && idx < TOTAL_SAMPLES) {
    L[idx] += valL
    R[idx] += valR
  }
}

function addKick(t, gain = 0.65) {
  const start = Math.floor(t * SR)
  const len = Math.floor(0.28 * SR)
  let phase = 0
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const freq = 42 + 125 * Math.exp(-dt * 36)
    phase += (2 * Math.PI * freq) / SR
    const env = Math.exp(-dt * 12) * (1 - Math.exp(-dt * 700))
    const click = Math.exp(-dt * 160) * Math.sin(2 * Math.PI * 1900 * dt) * 0.25
    const s = (Math.tanh(Math.sin(phase) * 1.45) * env + click) * gain
    addSample(start + i, s, s)
  }
}

function addHat(t, gain = 0.14, decay = 48, pan = 0) {
  const start = Math.floor(t * SR)
  const len = Math.floor(0.11 * SR)
  let prev = 0
  const lGain = gain * Math.cos(((pan + 1) * Math.PI) / 4)
  const rGain = gain * Math.sin(((pan + 1) * Math.PI) / 4)
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const n = rand()
    const hp = n - prev * 0.85
    prev = n
    const env = Math.exp(-dt * decay) * (1 - Math.exp(-dt * 1500))
    const s = hp * env
    addSample(start + i, s * lGain, s * rGain)
  }
}

function addClap(t, gain = 0.25) {
  const start = Math.floor(t * SR)
  const len = Math.floor(0.18 * SR)
  let lp = 0
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const n = rand()
    lp = lp * 0.6 + n * 0.4
    const bp = n - lp
    const burst =
      Math.exp(-dt * 26) +
      (dt > 0.011 ? Math.exp(-(dt - 0.011) * 34) * 0.7 : 0) +
      (dt > 0.023 ? Math.exp(-(dt - 0.023) * 28) * 0.55 : 0)
    const body = Math.sin(2 * Math.PI * 195 * dt) * Math.exp(-dt * 38) * 0.35
    const s = (bp * burst * 0.45 + body) * gain
    addSample(start + i, s * 0.96, s * 1.04)
  }
}

function addImpact(t, gain = 0.72, dur = 1.4) {
  const start = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  let phase = 0
  let lp = 0
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const freq = 34 + 62 * Math.exp(-dt * 4.5)
    phase += (2 * Math.PI * freq) / SR
    const sub = Math.sin(phase) * Math.exp(-dt * 2.4) * (1 - Math.exp(-dt * 180))
    const n = rand()
    lp = lp * 0.93 + n * 0.07
    const air = lp * Math.exp(-dt * 4.2) * 0.45
    const s = (Math.tanh(sub * 1.5) + air) * gain
    addSample(start + i, s, s)
  }
}

function addPadChord(t, dur, notes, gain = 0.13) {
  const start = Math.floor(t * SR)
  const len = Math.floor((dur + 0.6) * SR)
  const voices = notes.flatMap((m) => [
    { hz: midiToHz(m) * 0.997, pan: -0.45 },
    { hz: midiToHz(m) * 1.003, pan: 0.45 },
  ])
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const att = Math.min(1, dt / 0.45)
    const rel = dt > dur ? Math.max(0, 1 - (dt - dur) / 0.6) : 1
    const env = att * att * rel * rel
    const shimmer = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * dt)
    let sumL = 0
    let sumR = 0
    for (let v = 0; v < voices.length; v++) {
      const { hz, pan } = voices[v]
      const w = 2 * Math.PI * hz * dt
      const osc =
        Math.sin(w) * 0.68 +
        Math.sin(w * 2) * (0.18 + 0.1 * shimmer) +
        Math.sin(w * 3) * 0.06
      const lg = Math.cos(((pan + 1) * Math.PI) / 4)
      const rg = Math.sin(((pan + 1) * Math.PI) / 4)
      sumL += osc * lg
      sumR += osc * rg
    }
    const norm = gain / Math.sqrt(voices.length)
    addSample(start + i, sumL * env * norm, sumR * env * norm)
  }
}

function addPluck(t, midi, gain = 0.15, pan = 0, decay = 7.5) {
  const start = Math.floor(t * SR)
  const len = Math.floor(0.55 * SR)
  const hz = midiToHz(midi)
  const lg = gain * Math.cos(((pan + 1) * Math.PI) / 4)
  const rg = gain * Math.sin(((pan + 1) * Math.PI) / 4)
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const env = Math.exp(-dt * decay) * (1 - Math.exp(-dt * 900))
    const bright = Math.exp(-dt * 18)
    const w = 2 * Math.PI * hz * dt
    const s =
      (Math.sin(w) * 0.65 +
        Math.sin(w * 2) * 0.25 * bright +
        Math.sin(w * 3) * 0.14 * bright +
        Math.sin(w * 4) * 0.06 * bright) *
      env
    addSample(start + i, s * lg, s * rg)
  }
}

function addBassNote(t, midi, dur = 0.24, gain = 0.25) {
  const start = Math.floor(t * SR)
  const len = Math.floor((dur + 0.06) * SR)
  const hz = midiToHz(midi)
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const att = 1 - Math.exp(-dt * 320)
    const rel = dt > dur ? Math.exp(-(dt - dur) * 28) : 1
    const env = att * rel * (0.45 + 0.55 * Math.exp(-dt * 8))
    const w = 2 * Math.PI * hz * dt
    const raw = Math.sin(w) * 0.72 + Math.sin(w * 2) * 0.22 + Math.sin(w * 3) * 0.08
    const s = Math.tanh(raw * 1.35) * env * gain
    addSample(start + i, s, s)
  }
}

function addRiser(tStart, dur, gain = 0.24) {
  const start = Math.floor(tStart * SR)
  const len = Math.floor(dur * SR)
  let lp = 0
  let lp2 = 0
  for (let i = 0; i < len; i++) {
    const p = i / len
    const n = rand()
    const cutoff = 0.02 + p * p * 0.45
    lp += (n - lp) * cutoff
    lp2 += (lp - lp2) * cutoff
    const env = Math.pow(p, 2.2) * (1 - Math.pow(Math.max(0, (p - 0.94) / 0.06), 2))
    const sweepTone = Math.sin(2 * Math.PI * (140 + p * p * 680) * (i / SR)) * 0.15 * p
    const s = (lp2 * 1.4 + sweepTone) * env * gain
    addSample(start + i, s * (0.85 + 0.3 * Math.sin(p * 6)), s * (0.85 - 0.3 * Math.sin(p * 6)))
  }
}

function addKeyClick(t, gain = 0.13, pitchMul = 1.0) {
  const start = Math.floor(t * SR)
  const len = Math.floor(0.032 * SR)
  for (let i = 0; i < len; i++) {
    const dt = i / SR
    const env = Math.exp(-dt * 190)
    const s =
      (Math.sin(2 * Math.PI * 1650 * pitchMul * dt) * 0.5 +
        Math.sin(2 * Math.PI * 3400 * pitchMul * dt) * 0.3 +
        rand() * 0.35) *
      env *
      gain
    addSample(start + i, s, s)
  }
}

function addShortcutChime(t, midi1 = 79, midi2 = 86, gain = 0.18) {
  addPluck(t, midi1, gain * 0.85, -0.25, 11)
  addPluck(t + 0.055, midi2, gain, 0.25, 9)
}

function addFoldWhoosh(t, up = true, gain = 0.16) {
  const start = Math.floor(t * SR)
  const len = Math.floor(0.22 * SR)
  let lp = 0
  for (let i = 0; i < len; i++) {
    const p = i / len
    const env = Math.sin(p * Math.PI)
    const f = up ? 280 + p * 720 : 950 - p * 650
    const n = rand()
    lp += (n - lp) * (up ? 0.08 + p * 0.25 : 0.3 - p * 0.22)
    const tone = Math.sin(2 * Math.PI * f * (i / SR)) * 0.28
    const s = (lp * 0.7 + tone) * env * gain
    addSample(start + i, s * (1 - 0.2 * p), s * (0.8 + 0.2 * p))
  }
}

const CHORDS = [
  { root: 38, pad: [50, 57, 60, 64, 69], arp: [62, 65, 69, 72, 74, 72, 69, 65] }, // Dm9
  { root: 34, pad: [46, 53, 57, 62, 65], arp: [58, 62, 65, 69, 74, 69, 65, 62] }, // Bbmaj7
  { root: 41, pad: [48, 53, 57, 60, 64], arp: [60, 65, 69, 72, 76, 72, 69, 65] }, // Fmaj9
  { root: 36, pad: [48, 55, 60, 62, 67], arp: [60, 64, 67, 72, 74, 72, 67, 64] }, // Cadd9
]

// --- Scene 1: Intro (0.0 - 8.0s) ---
for (let t = 0.08; t < 1.82; t += 0.11) {
  addKeyClick(t, 0.055, 0.8 + (t % 0.3))
}
addRiser(0.5, 1.48, 0.28)
addImpact(2.0, 0.76, 1.8)
addPadChord(2.0, 5.8, [50, 57, 62, 64, 69], 0.15)
addShortcutChime(2.15, 74, 81, 0.16)
addRiser(6.4, 1.55, 0.24)

// --- Main Musical Engine (8.0s -> 66.0s, bars 4..32) ---
for (let bar = 4; bar < 33; bar++) {
  const barStart = bar * 2.0
  const chord = CHORDS[(bar - 4) % 4]
  const isPerformanceAct = bar >= 30 // 60s - 66s
  const isHighEnergy = bar >= 10 && bar < 30 // 20s - 60s

  addPadChord(barStart, 2.05, chord.pad, isPerformanceAct ? 0.17 : 0.12)

  if (!isPerformanceAct) {
    for (let step = 0; step < 8; step++) {
      const t = barStart + step * 0.25
      const pan = ((step % 4) - 1.5) * 0.28
      const arpGain = isHighEnergy ? 0.12 : 0.088
      addPluck(t, chord.arp[step], arpGain, pan, isHighEnergy ? 9.5 : 7.0)
    }
  } else {
    for (let step = 0; step < 4; step++) {
      addPluck(barStart + step * 0.5, chord.arp[step * 2] + 12, 0.12, step % 2 ? 0.35 : -0.35, 8.5)
    }
  }

  const bassPattern = isPerformanceAct
    ? [0, 0.5, 1.0, 1.5]
    : [0, 0.375, 0.75, 1.0, 1.375, 1.75]
  for (const offset of bassPattern) {
    const octaveBump = offset === 1.375 ? 12 : 0
    addBassNote(barStart + offset, chord.root + octaveBump, 0.21, isHighEnergy ? 0.26 : 0.2)
  }

  for (let b = 0; b < 4; b++) {
    const bt = barStart + b * BEAT
    addKick(bt, isPerformanceAct ? 0.72 : isHighEnergy ? 0.6 : 0.5)
    addHat(bt + 0.25, isHighEnergy ? 0.145 : 0.095, 40, b % 2 === 0 ? -0.25 : 0.25)
    if (isHighEnergy) {
      addHat(bt + 0.125, 0.055, 75, 0.35)
      addHat(bt + 0.375, 0.07, 65, -0.35)
    }
    if ((b === 1 || b === 3) && bar >= 6) {
      addClap(bt, isHighEnergy ? 0.25 : 0.16)
    }
  }
}

// --- Frame-locked UI SFX across all 7 Acts ---
// Scene 2: DSH Agent Presets (8.0s - 20.0s)
addImpact(8.0, 0.54, 0.9) // /agent opens
addKeyClick(9.0, 0.15, 1.05) // scroll presets
addKeyClick(9.8, 0.15, 1.15)
addKeyClick(10.6, 0.15, 1.25)
addShortcutChime(11.45, 76, 83, 0.2) // select PTC (code)
addFoldWhoosh(11.5, true, 0.18) // PTC run_code + nested subcalls
addShortcutChime(13.8, 79, 86, 0.16) // expand PTC source + output
addFoldWhoosh(15.95, true, 0.18) // Creator (cordis) + DeepSeek account

// Scene 3: Full 6-Tab Settings + Dark/Light + Plugins & MCP (20.0s - 32.0s)
addImpact(20.0, 0.58, 0.9)
addKeyClick(21.4, 0.15, 1.1) // Tab -> Models -> Plugins
addKeyClick(22.6, 0.15, 1.2)
addFoldWhoosh(23.95, true, 0.16) // Tab -> Terminal
addKeyClick(25.1, 0.16, 1.25) // Status verbose
addShortcutChime(26.0, 86, 93, 0.24) // Dark -> Light crisp flash!
addKeyClick(26.0, 0.22, 1.5)
addFoldWhoosh(27.95, true, 0.18) // /plugins (Codex / Claude Code) & /mcp probe
addShortcutChime(30.0, 74, 86, 0.18) // MCP probe ok

// Scene 4: Terminal Craft & Flow (32.0s - 48.0s)
addImpact(32.0, 0.56, 0.85) // Deep Driving -> Fold -> Ctrl+O -> Telemetry
addFoldWhoosh(33.9, false, 0.19) // Auto fold
addShortcutChime(35.0, 76, 83, 0.2) // Ctrl+O expand
addFoldWhoosh(35.05, true, 0.17)
addFoldWhoosh(36.6, false, 0.15)
// !shell + @mention (38.0s - 41.0s)
addFoldWhoosh(37.95, true, 0.17)
addKeyClick(39.4, 0.16, 1.2) // Tab pick @file
addShortcutChime(39.5, 74, 81, 0.15)
// /btw coherent typing -> answer (41.0s - 44.0s)
addFoldWhoosh(40.95, true, 0.16)
for (let i = 0; i < 14; i++) {
  addKeyClick(41.15 + i * 0.065, 0.1, 1.0 + (i % 3) * 0.06)
}
addShortcutChime(42.2, 79, 86, 0.18) // /btw answer pops in!
// /diff + Alt+Y + Click file link (44.0s - 48.0s)
addFoldWhoosh(43.95, true, 0.18)
addShortcutChime(45.2, 81, 88, 0.2) // Alt+Y quote
addKeyClick(46.2, 0.18, 1.35) // Click #L142 link
addShortcutChime(46.3, 76, 88, 0.18)

// Scene 5: Autonomy, Teams & Safety (48.0s - 60.0s)
addImpact(48.0, 0.62, 1.0) // /goal + /permission Auto review + /schedule
addShortcutChime(50.0, 74, 81, 0.16)
addFoldWhoosh(51.95, true, 0.18) // /team Agent Teams + Subagents
addShortcutChime(54.0, 76, 83, 0.16)
addFoldWhoosh(55.95, true, 0.18) // /trajectory -> Esc Esc Session Tree -> Alt+R
addKeyClick(57.4, 0.18, 1.2)
addKeyClick(57.56, 0.18, 1.25)
addShortcutChime(58.8, 74, 86, 0.22) // Alt+R snapshot restored
addRiser(58.5, 1.45, 0.3)

// Scene 6: Speed & Precision impacts (60.0s - 66.0s)
addImpact(60.0, 0.8, 1.3) // 2.567 ms
addImpact(62.0, 0.78, 1.3) // 0.383 ms
addImpact(64.0, 0.82, 1.4) // 0.212 ms

// Scene 7: Outro CTA (66.0s - 72.0s)
addImpact(66.0, 0.65, 2.2)
addPadChord(66.0, 5.2, [50, 57, 62, 64, 69, 74], 0.16)
for (let i = 0; i < 24; i++) {
  addKeyClick(66.55 + i * 0.068, 0.12, 0.92 + (i % 4) * 0.06)
}
addShortcutChime(68.45, 74, 86, 0.24)
addPluck(68.55, 93, 0.16, 0, 2.2)

// Subtle stereo dotted-8th delay
const delaySamples = Math.floor(0.375 * SR)
for (let i = delaySamples; i < TOTAL_SAMPLES; i++) {
  L[i] += R[i - delaySamples] * 0.15
  R[i] += L[i - delaySamples] * 0.15
}

// Smooth fade-out last 1.2s + soft limiter
const fadeSamples = Math.floor(1.2 * SR)
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  let gain = 1.0
  if (i > TOTAL_SAMPLES - fadeSamples) {
    const p = (TOTAL_SAMPLES - i) / fadeSamples
    gain = p * p
  }
  L[i] = Math.tanh(L[i] * 0.95) * gain
  R[i] = Math.tanh(R[i] * 0.95) * gain
}

const outDir = path.resolve(import.meta.dirname, '../public/media')
fs.mkdirSync(outDir, { recursive: true })
const wavPath = path.join(outDir, 'soundtrack-72s.wav')
const m4aPath = path.join(outDir, 'soundtrack-72s.m4a')
const numChannels = 2
const bytesPerSample = 2
const dataSize = TOTAL_SAMPLES * numChannels * bytesPerSample
const buf = Buffer.alloc(44 + dataSize)

buf.write('RIFF', 0)
buf.writeUInt32LE(36 + dataSize, 4)
buf.write('WAVE', 8)
buf.write('fmt ', 12)
buf.writeUInt32LE(16, 16)
buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(numChannels, 22)
buf.writeUInt32LE(SR, 24)
buf.writeUInt32LE(SR * numChannels * bytesPerSample, 28)
buf.writeUInt16LE(numChannels * bytesPerSample, 32)
buf.writeUInt16LE(16, 34)
buf.write('data', 36)
buf.writeUInt32LE(dataSize, 40)

let off = 44
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  const sL = Math.max(-1, Math.min(1, L[i]))
  const sR = Math.max(-1, Math.min(1, R[i]))
  buf.writeInt16LE(Math.round(sL * 32767), off)
  buf.writeInt16LE(Math.round(sR * 32767), off + 2)
  off += 4
}

fs.writeFileSync(wavPath, buf)
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    wavPath,
    '-af',
    'highpass=f=28,acompressor=threshold=-14dB:ratio=2.4:attack=8:release=120,alimiter=limit=0.95',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-ar',
    '48000',
    '-ac',
    '2',
    m4aPath,
  ],
  { stdio: 'pipe' },
)
fs.rmSync(wavPath, { force: true })
console.log(`Mastered ${m4aPath} (${(fs.statSync(m4aPath).size / 1024 / 1024).toFixed(2)} MB)`)
