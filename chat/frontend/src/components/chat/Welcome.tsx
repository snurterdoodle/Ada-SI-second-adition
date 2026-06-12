import { motion } from 'framer-motion'

export function Welcome() {
  const chips = ['Ask a question', 'Forge a new skill', 'Run an installed skill']

  return (
    <div className="welcome">
      <p className="welcome-tagline">Bond with ADA through conversation and skill forging.</p>
      <div className="welcome-chips">
        {chips.map((chip, index) => (
          <motion.span
            key={chip}
            className="welcome-chip"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.25 }}
          >
            {chip}
          </motion.span>
        ))}
      </div>
    </div>
  )
}
