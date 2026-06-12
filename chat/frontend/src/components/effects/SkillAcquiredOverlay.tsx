import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { audioManager } from '../../audio/AudioManager'
import { COMPANION_NAME } from '../../constants'

type SkillAcquiredOverlayProps = {
  toolName: string
  onDone: () => void
}

function SparkBurst({ reducedMotion }: { reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const particles = Array.from({ length: 80 }, () => ({
      x: cx,
      y: cy,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      life: 1,
      color: Math.random() > 0.5 ? '#22d3ee' : '#fbbf24',
      size: 2 + Math.random() * 3,
    }))

    let frame: number
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let alive = false
      for (const p of particles) {
        if (p.life <= 0) continue
        alive = true
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.08
        p.life -= 0.025
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      if (alive) frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [reducedMotion])

  if (reducedMotion) return null
  return <canvas ref={canvasRef} className="celebration-sparks" aria-hidden="true" />
}

export function SkillAcquiredOverlay({ toolName, onDone }: SkillAcquiredOverlayProps) {
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    void audioManager.play('skill_fanfare')
    const timer = setTimeout(onDone, 2800)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <motion.div
      className="celebration-overlay skill-acquired"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={onDone}
      role="dialog"
      aria-label={`Skill acquired: ${toolName}`}
    >
      <div className="celebration-dim" />
      <SparkBurst reducedMotion={reducedMotion} />
      <div className="celebration-beam" aria-hidden="true" />
      <motion.div
        className="celebration-content"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
      >
        <p className="celebration-kicker">Skill Acquired</p>
        <h2 className="celebration-title">{toolName}</h2>
        <p className="celebration-sub">Bound to {COMPANION_NAME}</p>
      </motion.div>
    </motion.div>
  )
}
