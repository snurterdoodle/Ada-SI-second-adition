import { SOUND_STORAGE_KEY } from '../constants'

export type SfxId =
  | 'send'
  | 'receive'
  | 'click'
  | 'skill_fanfare'
  | 'level_up'
  | 'error'

type SoundPrefs = {
  muted: boolean
  volume: number
}

function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(SOUND_STORAGE_KEY)
    if (!raw) return { muted: true, volume: 0.5 }
    const parsed = JSON.parse(raw) as SoundPrefs
    return {
      muted: parsed.muted !== false,
      volume: typeof parsed.volume === 'number' ? parsed.volume : 0.5,
    }
  } catch {
    return { muted: true, volume: 0.5 }
  }
}

function savePrefs(prefs: SoundPrefs) {
  localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(prefs))
}

function playTone(
  ctx: AudioContext,
  freq: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  detune = 0,
) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.detune.value = detune
  g.gain.setValueAtTime(0, ctx.currentTime)
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01)
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  osc.connect(g)
  g.connect(ctx.destination)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + duration + 0.05)
}

function playNoise(ctx: AudioContext, duration: number, gain: number) {
  const bufferSize = ctx.sampleRate * duration
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
  }
  const source = ctx.createBufferSource()
  const g = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 800
  source.buffer = buffer
  g.gain.setValueAtTime(gain, ctx.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  source.connect(filter)
  filter.connect(g)
  g.connect(ctx.destination)
  source.start()
}

class AudioManagerImpl {
  private ctx: AudioContext | null = null
  private prefs: SoundPrefs = loadPrefs()
  private unlocked = false

  get muted() {
    return this.prefs.muted
  }

  get volume() {
    return this.prefs.volume
  }

  setMuted(muted: boolean) {
    this.prefs = { ...this.prefs, muted }
    savePrefs(this.prefs)
  }

  setVolume(volume: number) {
    this.prefs = { ...this.prefs, volume: Math.max(0, Math.min(1, volume)) }
    savePrefs(this.prefs)
  }

  toggleMute(): boolean {
    this.setMuted(!this.prefs.muted)
    return this.prefs.muted
  }

  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    void this.ensureContext()
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (this.prefs.muted) return null
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    return this.ctx
  }

  async play(id: SfxId) {
    if (this.prefs.muted) return
    const ctx = await this.ensureContext()
    if (!ctx) return
    const vol = this.prefs.volume

    switch (id) {
      case 'send':
        playTone(ctx, 440, 0.12, 'sine', vol * 0.15)
        playNoise(ctx, 0.08, vol * 0.08)
        break
      case 'receive':
        playTone(ctx, 523, 0.08, 'sine', vol * 0.12)
        setTimeout(() => playTone(ctx, 659, 0.1, 'sine', vol * 0.1), 60)
        break
      case 'click':
        playTone(ctx, 880, 0.04, 'square', vol * 0.06)
        break
      case 'skill_fanfare':
        ;[523, 659, 784, 1047].forEach((f, i) => {
          setTimeout(() => playTone(ctx, f, 0.25, 'sawtooth', vol * 0.12), i * 90)
        })
        playNoise(ctx, 0.3, vol * 0.06)
        break
      case 'level_up':
        ;[440, 554, 659, 880].forEach((f, i) => {
          setTimeout(() => playTone(ctx, f, 0.3, 'triangle', vol * 0.14, i * 20), i * 100)
        })
        break
      case 'error':
        playTone(ctx, 180, 0.2, 'sawtooth', vol * 0.12)
        setTimeout(() => playTone(ctx, 140, 0.25, 'sawtooth', vol * 0.1), 100)
        break
    }
  }
}

export const audioManager = new AudioManagerImpl()
