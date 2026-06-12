import type { LevelTier } from '../../state/progression'
import type { FeedItem } from '../../types/events'

export type CoreMood = 'idle' | 'listening' | 'thinking' | 'forging' | 'celebrating'

type MoodInput = {
  isSending: boolean
  feed: FeedItem[]
  celebrationActive: boolean
}

export function deriveCoreMood({ isSending, feed, celebrationActive }: MoodInput): CoreMood {
  if (celebrationActive) return 'celebrating'

  const forging = feed.some(
    (item) =>
      item.type === 'tool-plan' &&
      (item.card.mode === 'building' || item.card.busy),
  )
  if (forging) return 'forging'

  const thinking = feed.some(
    (item) =>
      item.type === 'assistant' &&
      item.streaming &&
      item.reasoningText &&
      !item.content,
  )
  if (thinking) return 'thinking'

  if (isSending) return 'listening'

  return 'idle'
}

export type TierVisuals = {
  scale: number
  particleCount: number
  ringCount: number
  innerGlow: number
  outerGlow: number
  hueShift: number
}

export function tierVisuals(tier: LevelTier): TierVisuals {
  switch (tier) {
    case 'spark':
      return { scale: 0.75, particleCount: 400, ringCount: 0, innerGlow: 0.6, outerGlow: 0.3, hueShift: 0 }
    case 'apprentice':
      return { scale: 0.9, particleCount: 800, ringCount: 2, innerGlow: 0.8, outerGlow: 0.5, hueShift: 0.05 }
    case 'partner':
      return { scale: 1.0, particleCount: 1200, ringCount: 3, innerGlow: 1.0, outerGlow: 0.7, hueShift: 0.12 }
    case 'ascended':
      return { scale: 1.15, particleCount: 1600, ringCount: 3, innerGlow: 1.2, outerGlow: 1.0, hueShift: 0.2 }
  }
}

export const MOOD_COLORS: Record<CoreMood, { core: string; particle: string; ring: string }> = {
  idle: { core: '#22d3ee', particle: '#67e8f9', ring: '#22d3ee' },
  listening: { core: '#38bdf8', particle: '#7dd3fc', ring: '#0ea5e9' },
  thinking: { core: '#a855f7', particle: '#c084fc', ring: '#9333ea' },
  forging: { core: '#fbbf24', particle: '#fcd34d', ring: '#f59e0b' },
  celebrating: { core: '#fbbf24', particle: '#fde68a', ring: '#fbbf24' },
}

export const MOOD_PULSE: Record<CoreMood, number> = {
  idle: 1.0,
  listening: 1.8,
  thinking: 2.2,
  forging: 2.8,
  celebrating: 3.5,
}
