import type { ToolPlanCardState, UiPreviewState } from '../../types/events'
import { useToolBuildStream } from '../../hooks/useToolBuildStream'
import { useAppStore } from '../../state/store'

type UiPreviewCardProps = {
  feedId: string
  card: ToolPlanCardState
  preview: UiPreviewState
}

export function UiPreviewCard({ feedId, card, preview }: UiPreviewCardProps) {
  const updateToolPlanCard = useAppStore((s) => s.updateToolPlanCard)
  const openSkillApp = useAppStore((s) => s.openSkillApp)
  const { runPreviewApproval, runPreviewRevision, handlePreviewRejection } =
    useToolBuildStream()

  const feedback = preview.feedback ?? ''

  return (
    <div
      className={`ui-preview-card${preview.busy ? ' ui-preview-busy' : ''}`}
      data-preview-id={preview.previewId}
    >
      <div className="ui-preview-header">
        <span className="ui-preview-badge">App preview</span>
        <h4 className="ui-preview-title">{card.toolName || 'Skill'}</h4>
      </div>
      <div className="ui-preview-body">
        <p>
          The interactive app is open in a popup. Try creating, editing, and deleting items,
          then approve or request changes.
        </p>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={preview.busy}
          onClick={() => openSkillApp(card.toolName)}
        >
          Re-open app
        </button>
        <div className="tool-plan-feedback">
          <label htmlFor={`preview-feedback-${preview.previewId}`}>Request app changes</label>
          <textarea
            id={`preview-feedback-${preview.previewId}`}
            rows={3}
            placeholder="Describe what to change in the app UI or behavior…"
            value={feedback}
            disabled={preview.busy}
            onChange={(e) =>
              updateToolPlanCard(feedId, {
                uiPreview: { ...preview, feedback: e.target.value },
              })
            }
          />
        </div>
      </div>
      <div className="ui-preview-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={preview.busy}
          onClick={() => void runPreviewApproval(feedId, preview.previewId, card.runId)}
        >
          Looks good — install
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={preview.busy || !feedback.trim()}
          onClick={() =>
            void runPreviewRevision(feedId, preview.previewId, card.runId, feedback)
          }
        >
          Request changes
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={preview.busy}
          onClick={() => void handlePreviewRejection(feedId, preview.previewId, card.runId)}
        >
          Discard
        </button>
      </div>
    </div>
  )
}
