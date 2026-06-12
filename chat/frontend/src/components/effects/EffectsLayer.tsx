import { AnimatePresence } from 'framer-motion'
import { useProgressStore } from '../../state/progression'
import { LevelUpOverlay } from './LevelUpOverlay'
import { SkillAcquiredOverlay } from './SkillAcquiredOverlay'

export function EffectsLayer() {
  const queue = useProgressStore((s) => s.celebrationQueue)
  const dismissCelebration = useProgressStore((s) => s.dismissCelebration)

  const active = queue[0]

  return (
    <div className="effects-layer" aria-live="polite">
      <AnimatePresence mode="wait">
        {active?.type === 'skill_unlock' && (
          <SkillAcquiredOverlay
            key={active.id}
            toolName={active.toolName}
            onDone={() => dismissCelebration(active.id)}
          />
        )}
        {active?.type === 'level_up' && (
          <LevelUpOverlay
            key={active.id}
            fromLevel={active.fromLevel}
            toLevel={active.toLevel}
            title={active.title}
            onDone={() => dismissCelebration(active.id)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
