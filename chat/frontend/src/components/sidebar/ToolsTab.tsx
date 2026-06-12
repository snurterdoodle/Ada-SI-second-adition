import { deleteTool } from '../../api/client'
import { useToolBuildStream } from '../../hooks/useToolBuildStream'
import { useAppStore } from '../../state/store'
import type { ToolSummary } from '../../types/events'

function ToolsEmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77A6 6 0 0 1 21 12v0a6 6 0 0 1-6 6H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1" />
          <path d="M16 2l4 4" />
        </svg>
      </div>
      <p className="empty-state-title">No skills yet</p>
      <p className="empty-state-text">Forged skills appear here automatically.</p>
    </div>
  )
}

function iconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

type ToolsTabProps = {
  tools: ToolSummary[]
}

export function ToolsTab({ tools }: ToolsTabProps) {
  const setStatus = useAppStore((s) => s.setStatus)
  const { refreshTools, refreshPackages } = useToolBuildStream()

  const handleDelete = async (toolName: string) => {
    if (!confirm(`Delete tool "${toolName}"? This cannot be undone.`)) return
    try {
      await deleteTool(toolName)
      await refreshTools()
      await refreshPackages()
      setStatus(`Tool "${toolName}" deleted.`)
    } catch (error) {
      setStatus(`Delete failed: ${(error as Error).message}`, true)
    }
  }

  if (tools.length === 0) {
    return <ToolsEmptyState />
  }

  return (
    <>
      {tools.map((tool) => (
        <div key={tool.name} className="tool-card" data-tool-name={tool.name}>
          <button
            type="button"
            className="tool-delete-btn"
            title="Delete tool"
            onClick={() => void handleDelete(tool.name)}
          >
            {iconTrash()}
          </button>
          <div className="tool-card-header">
            <span className="tool-card-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77A6 6 0 0 1 21 12v0a6 6 0 0 1-6 6H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1" />
              </svg>
            </span>
            <h3 className="tool-card-name">{tool.name}</h3>
          </div>
          <p className="tool-card-desc">{tool.description || 'No description.'}</p>
        </div>
      ))}
    </>
  )
}
