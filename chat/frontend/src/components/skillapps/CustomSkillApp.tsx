import { useEffect, useRef } from 'react'
import { useAppStore } from '../../state/store'
import type { SkillUiConfig } from '../../types/events'

type CustomSkillAppProps = {
  skillName: string
  ui: SkillUiConfig
}

export function CustomSkillApp({ skillName, ui }: CustomSkillAppProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const skillDataRevision = useAppStore((s) => s.skillDataRevision)
  const entry = ui.entry || 'index.html'

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: 'ada:skill_data_changed', skillName },
      window.location.origin,
    )
  }, [skillDataRevision, skillName])

  return (
    <iframe
      ref={iframeRef}
      className="skill-app-iframe"
      title={`${skillName} app`}
      src={`/api/skills/${encodeURIComponent(skillName)}/ui/${encodeURIComponent(entry)}`}
      sandbox="allow-scripts allow-same-origin"
    />
  )
}
