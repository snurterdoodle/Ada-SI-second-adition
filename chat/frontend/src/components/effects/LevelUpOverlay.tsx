import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { audioManager } from '../../audio/AudioManager'
import { COMPANION_NAME } from '../../constants'
import type { LevelTitle } from '../../state/progression'

type LevelUpOverlayProps = {
  fromLevel: number
  toLevel: number
  title: LevelTitle
  onDone: () => void
}

export function LevelUpOverlay({ fromLevel, toLevel, title, onDone }: LevelUpOverlayProps) {
  useEffect(() => {
    void audioManager.play('level_up')
    const timer = setTimeout(onDone, 2600)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <motion.div
      className="celebration-overlay level-up"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={onDone}
      role="dialog"
      aria-label={`${COMPANION_NAME} leveled up to level ${toLevel}`}
    >
      <div className="celebration-dim" />
      <motion.div
        className="level-up-ring"
        initial={{ scale: 0.3, opacity: 0.8 }}
        animate={{ scale: 3, opacity: 0 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        aria-hidden="true"
      />
      <motion.div
        className="celebration-content"
        initial={{ scale: 0.7, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      >
        <p className="celebration-kicker">{COMPANION_NAME} Leveled Up</p>
        <h2 className="celebration-title">
          Lv {fromLevel} → Lv {toLevel}
        </h2>
        <p className="celebration-sub">{title}</p>
      </motion.div>
    </motion.div>
  )
}
