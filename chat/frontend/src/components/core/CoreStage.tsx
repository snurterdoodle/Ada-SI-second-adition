import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { motion } from 'framer-motion'
import { COMPANION_NAME } from '../../constants'
import { useProgressStore } from '../../state/progression'
import { useAppStore } from '../../state/store'
import { AiCoreScene } from './AiCoreScene'
import { deriveCoreMood } from './coreMood'

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = () => setReduced(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

function CoreHud() {
  const level = useProgressStore((s) => s.level)
  const title = useProgressStore((s) => s.title)
  const xpIntoLevel = useProgressStore((s) => s.xpIntoLevel)
  const xpToNext = useProgressStore((s) => s.xpToNext)
  const skillsLearned = useProgressStore((s) => s.skillsLearned)
  const lastXpGain = useProgressStore((s) => s.lastXpGain)

  const pct = xpToNext > 0 ? (xpIntoLevel / xpToNext) * 100 : 0

  return (
    <div className="core-hud">
      <div className="core-hud-top">
        <span className="core-hud-name">{COMPANION_NAME}</span>
        <span className="core-hud-sep">·</span>
        <span className="core-hud-level">Lv {level}</span>
        <span className="core-hud-sep">·</span>
        <span className="core-hud-title">{title}</span>
        {skillsLearned > 0 && (
          <span className="core-hud-skills">{skillsLearned} skill{skillsLearned !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="core-xp-bar" aria-label={`Bond progress ${Math.round(pct)} percent`}>
        <motion.div
          className="core-xp-fill"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
        {lastXpGain > 0 && (
          <motion.span
            key={lastXpGain + xpIntoLevel}
            className="core-xp-tick"
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 0, y: -12 }}
            transition={{ duration: 1.2 }}
          >
            +{lastXpGain} bond
          </motion.span>
        )}
      </div>
    </div>
  )
}

type CoreStageProps = {
  expanded?: boolean
}

export function CoreStage({ expanded = false }: CoreStageProps) {
  const isSending = useAppStore((s) => s.isSending)
  const feed = useAppStore((s) => s.feed)
  const tier = useProgressStore((s) => s.tier)
  const celebrationQueue = useProgressStore((s) => s.celebrationQueue)
  const reducedMotion = useReducedMotion()
  const [tabHidden, setTabHidden] = useState(document.hidden)

  useEffect(() => {
    const handler = () => setTabHidden(document.hidden)
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const mood = deriveCoreMood({
    isSending,
    feed,
    celebrationActive: celebrationQueue.length > 0,
  })

  return (
    <section
      className={`core-stage holo-panel${expanded ? ' core-stage-expanded' : ''}`}
      aria-label="ADA core visualizer"
    >
      <CoreHud />
      <div className="core-canvas-wrap">
        <Canvas
          dpr={Math.min(window.devicePixelRatio, 1.5)}
          frameloop={tabHidden ? 'never' : 'always'}
          camera={{ position: [0, 0, 3.5], fov: 45 }}
          gl={{ alpha: true, antialias: true }}
        >
          <Suspense fallback={null}>
            <AiCoreScene mood={mood} tier={tier} reducedMotion={reducedMotion} />
          </Suspense>
        </Canvas>
      </div>
    </section>
  )
}
