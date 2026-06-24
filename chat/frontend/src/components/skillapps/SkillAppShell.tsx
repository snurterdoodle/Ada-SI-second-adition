import { motion } from 'framer-motion'
import { AnimatePresence } from 'framer-motion'
import { useEffect } from 'react'
import { IconSkill } from '../icons/GamifiedIcons'
import { useAppStore } from '../../state/store'
import { CalendarApp } from './CalendarApp'
import { CustomSkillApp } from './CustomSkillApp'
import { ListApp } from './ListApp'
import { TableApp } from './TableApp'

export function SkillAppShell() {
  const activeSkillApp = useAppStore((s) => s.activeSkillApp)
  const closeSkillApp = useAppStore((s) => s.closeSkillApp)
  const tools = useAppStore((s) => s.tools)

  const tool = tools.find((t) => t.name === activeSkillApp)
  const displayName = tool?.display_name || tool?.name || activeSkillApp
  const ui = tool?.ui

  useEffect(() => {
    if (!activeSkillApp) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSkillApp()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeSkillApp, closeSkillApp])

  return (
    <AnimatePresence>
      {activeSkillApp && tool && ui && (
        <motion.div
          className="skill-app-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-app-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.button
            type="button"
            className="skill-app-backdrop"
            aria-label="Close skill app"
            onClick={closeSkillApp}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            className="skill-app-window glass-panel"
            data-skill-app-capture="window"
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          >
            <header className="skill-app-header">
              <div className="skill-app-header-title">
                <span className="skill-app-header-icon" aria-hidden="true">
                  <IconSkill size={18} />
                </span>
                <h2 id="skill-app-title">{displayName}</h2>
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={closeSkillApp}>
                Close
              </button>
            </header>

            <div
              className={`skill-app-body${ui.template === 'custom' ? ' skill-app-body-iframe' : ''}`}
            >
              {ui.template === 'calendar' && (
                <CalendarApp skillName={activeSkillApp} ui={ui} />
              )}
              {ui.template === 'list' && <ListApp skillName={activeSkillApp} ui={ui} />}
              {ui.template === 'table' && <TableApp skillName={activeSkillApp} ui={ui} />}
              {ui.template === 'custom' && (
                <CustomSkillApp skillName={activeSkillApp} ui={ui} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
