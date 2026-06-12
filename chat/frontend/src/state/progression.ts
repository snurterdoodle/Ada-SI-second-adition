import { PROGRESS_STORAGE_KEY, XP_AWARD_COOLDOWN_MS } from '../constants'
import { create } from 'zustand'

export type LevelTitle = 'Spark' | 'Apprentice' | 'Partner' | 'Ascended'

export type LevelTier = 'spark' | 'apprentice' | 'partner' | 'ascended'

export type Celebration =
  | { id: string; type: 'skill_unlock'; toolName: string }
  | { id: string; type: 'level_up'; fromLevel: number; toLevel: number; title: LevelTitle }

export type CelebrationInput =
  | { type: 'skill_unlock'; toolName: string }
  | { type: 'level_up'; fromLevel: number; toLevel: number; title: LevelTitle }

type PersistedProgress = {
  totalXp: number
  skillsLearned: number
}

type ProgressState = {
  totalXp: number
  skillsLearned: number
  level: number
  xpIntoLevel: number
  xpToNext: number
  title: LevelTitle
  tier: LevelTier
  celebrationQueue: Celebration[]
  lastAwardAt: number
  lastXpGain: number

  awardXp: (amount: number) => { leveledUp: boolean; fromLevel: number; toLevel: number } | null
  recordSkillLearned: (toolName: string) => void
  queueCelebration: (celebration: CelebrationInput) => void
  dismissCelebration: (id: string) => void
  hydrate: () => void
}

export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.4))
}

export function levelFromTotalXp(totalXp: number): {
  level: number
  xpIntoLevel: number
  xpToNext: number
} {
  let level = 1
  let remaining = totalXp
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level)
    level++
  }
  return {
    level,
    xpIntoLevel: remaining,
    xpToNext: xpForLevel(level),
  }
}

export function titleForLevel(level: number): LevelTitle {
  if (level >= 31) return 'Ascended'
  if (level >= 16) return 'Partner'
  if (level >= 6) return 'Apprentice'
  return 'Spark'
}

export function tierForLevel(level: number): LevelTier {
  if (level >= 31) return 'ascended'
  if (level >= 16) return 'partner'
  if (level >= 6) return 'apprentice'
  return 'spark'
}

function deriveFromXp(totalXp: number) {
  const { level, xpIntoLevel, xpToNext } = levelFromTotalXp(totalXp)
  return {
    level,
    xpIntoLevel,
    xpToNext,
    title: titleForLevel(level),
    tier: tierForLevel(level),
  }
}

function loadProgress(): PersistedProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) return { totalXp: 0, skillsLearned: 0 }
    const parsed = JSON.parse(raw) as PersistedProgress
    return {
      totalXp: typeof parsed.totalXp === 'number' ? parsed.totalXp : 0,
      skillsLearned: typeof parsed.skillsLearned === 'number' ? parsed.skillsLearned : 0,
    }
  } catch {
    return { totalXp: 0, skillsLearned: 0 }
  }
}

function saveProgress(data: PersistedProgress) {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data))
}

function createCelebrationId(): string {
  return `cel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const initial = loadProgress()
const initialDerived = deriveFromXp(initial.totalXp)

export const useProgressStore = create<ProgressState>((set, get) => ({
  totalXp: initial.totalXp,
  skillsLearned: initial.skillsLearned,
  level: initialDerived.level,
  xpIntoLevel: initialDerived.xpIntoLevel,
  xpToNext: initialDerived.xpToNext,
  title: initialDerived.title,
  tier: initialDerived.tier,
  celebrationQueue: [],
  lastAwardAt: 0,
  lastXpGain: 0,

  hydrate: () => {
    const data = loadProgress()
    const derived = deriveFromXp(data.totalXp)
    set({ ...data, ...derived })
  },

  awardXp: (amount) => {
    if (amount <= 0) return null
    const now = Date.now()
    const state = get()
    if (now - state.lastAwardAt < XP_AWARD_COOLDOWN_MS) return null

    const fromLevel = state.level
    const totalXp = state.totalXp + amount
    const derived = deriveFromXp(totalXp)
    saveProgress({ totalXp, skillsLearned: state.skillsLearned })

    set({
      totalXp,
      ...derived,
      lastAwardAt: now,
      lastXpGain: amount,
    })

    if (derived.level > fromLevel) {
      get().queueCelebration({
        type: 'level_up',
        fromLevel,
        toLevel: derived.level,
        title: derived.title,
      })
      return { leveledUp: true, fromLevel, toLevel: derived.level }
    }
    return null
  },

  recordSkillLearned: (toolName) => {
    const state = get()
    const skillsLearned = state.skillsLearned + 1
    saveProgress({ totalXp: state.totalXp, skillsLearned })
    set({ skillsLearned })
    get().queueCelebration({ type: 'skill_unlock', toolName })
  },

  queueCelebration: (celebration) => {
    const item = { ...celebration, id: createCelebrationId() } as Celebration
    set((s) => ({ celebrationQueue: [...s.celebrationQueue, item] }))
  },

  dismissCelebration: (id) => {
    set((s) => ({
      celebrationQueue: s.celebrationQueue.filter((c) => c.id !== id),
    }))
  },
}))

export function chatTurnXpBonus(contentLength: number): number {
  const bonus = Math.min(Math.floor(contentLength / 80), 15)
  return bonus
}
