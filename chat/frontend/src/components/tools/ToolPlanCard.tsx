import type { ToolPlanCardState } from '../../types/events'
import { useToolBuildStream } from '../../hooks/useToolBuildStream'
import { useAppStore } from '../../state/store'
import { Markdown } from '../chat/Markdown'
import { ReasoningBlock } from '../chat/ReasoningBlock'
import { ToolBuildViewer } from './ToolBuildViewer'
import { PipApprovalCard } from './PipApprovalCard'
import { VIEWER_PHASES } from '../../constants'

type ToolPlanCardProps = {
  feedId: string
  card: ToolPlanCardState
}

function getBadgeText(card: ToolPlanCardState): string {
  if (card.mode === 'draft') {
    return card.kind === 'edit' ? 'Drafting skill revision' : 'Drafting skill blueprint'
  }
  if (card.mode === 'building' || card.mode === 'success') {
    return 'Skill Forge'
  }
  return card.kind === 'edit' ? 'Skill revision proposal' : 'Skill blueprint'
}

export function ToolPlanCard({ feedId, card }: ToolPlanCardProps) {
  const updateToolPlanCard = useAppStore((s) => s.updateToolPlanCard)
  const expandToolPlan = useAppStore((s) => s.expandToolPlan)
  const removeToolPlanCard = useAppStore((s) => s.removeToolPlanCard)
  const {
    runToolBuild,
    handleToolRevision,
    handleToolRejection,
  } = useToolBuildStream()

  const isCollapsed = card.mode === 'collapsed'
  const isBuilding = card.mode === 'building' || card.mode === 'success'
  const isDraft = card.mode === 'draft'
  const isPending = card.mode === 'pending'

  const classNames = [
    'tool-plan-card',
    isDraft ? 'tool-plan-draft' : '',
    isBuilding ? 'tool-creation-viewer' : '',
    card.mode === 'success' ? 'tool-creation-viewer-success' : '',
    card.pipInstall ? 'tool-card-pip-active' : '',
    isCollapsed ? 'tool-card-collapsed' : 'tool-card-active',
  ]
    .filter(Boolean)
    .join(' ')

  if (isCollapsed) {
    return (
      <article
        className={classNames}
        data-plan-id={card.planId}
        data-run-id={card.runId}
        data-tool-name={card.toolName}
      >
        <div className="tool-card-summary">
          <span className="tool-card-summary-name">{card.toolName}</span>
          <span className={`tool-card-summary-badge status-${card.collapsedStatusClass || 'success'}`}>
            {card.collapsedStatus || 'Done'}
          </span>
          {card.collapsedSummary && (
            <span className="tool-card-summary-detail">{card.collapsedSummary}</span>
          )}
          <div className="tool-card-summary-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={() => expandToolPlan(feedId)}>
              Expand
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => removeToolPlanCard(feedId)}>
              Dismiss
            </button>
          </div>
        </div>
      </article>
    )
  }

  const planContent = isDraft
    ? card.draftPlanText
    : card.planMarkdown

  return (
    <article
      className={classNames}
      data-plan-id={card.planId}
      data-run-id={card.runId}
      data-tool-name={card.toolName}
      data-plan-kind={card.kind}
    >
      <div className="tool-card-chrome">
        <div className="tool-plan-header">
          <span
            className={`tool-plan-badge${card.kind === 'edit' ? ' tool-plan-badge-edit' : ''}`}
          >
            {getBadgeText(card)}
          </span>
          <h3 className="tool-plan-title">{card.toolName}</h3>
        </div>
        {isBuilding && (
          <div className="tool-viewer-phases">
            {VIEWER_PHASES.map((phase) => (
              <span
                key={phase.id}
                className={`tool-viewer-phase step-${card.viewerPhases[phase.id] || 'pending'}`}
                data-phase-id={phase.id}
              >
                {phase.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {card.pipInstall && (
        <div className="tool-card-attention">
          <PipApprovalCard feedId={feedId} card={card} pip={card.pipInstall} />
        </div>
      )}

      <div className="tool-card-scroll scroll-area">
        {isDraft && (card.draftThinking || isDraft) && (
          <ReasoningBlock
            text={card.draftThinking}
            streaming={isDraft && !card.draftPlanText}
            open={!card.draftPlanText}
            className="thinking-block tool-plan-draft-thinking"
          />
        )}

        {!isBuilding && (
          <div className="tool-plan-body-wrap">
            <div className="tool-plan-body">
              {isDraft ? (
                planContent
              ) : (
                <Markdown content={planContent} />
              )}
            </div>
          </div>
        )}

        {isBuilding && <ToolBuildViewer feedId={feedId} card={card} />}
      </div>

      <div className="tool-card-actions">
        {isPending && (
          <>
            <div className="tool-plan-feedback">
              <label htmlFor={`plan-feedback-${card.planId}`}>Request changes</label>
              <textarea
                id={`plan-feedback-${card.planId}`}
                rows={3}
                placeholder="Describe what to change in this plan — the model will revise it using your feedback."
                value={card.feedback}
                disabled={card.busy}
                onChange={(e) => updateToolPlanCard(feedId, { feedback: e.target.value })}
              />
            </div>
            <div className="tool-plan-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={card.busy}
                onClick={() =>
                  void runToolBuild(feedId, card.planId!, card.runId)
                }
              >
                Approve & Build Tool
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={card.busy}
                onClick={() =>
                  void handleToolRevision(feedId, card.planId!, card.runId, card.feedback)
                }
              >
                {card.busy ? 'Revising plan...' : 'Request changes'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={card.busy}
                onClick={() =>
                  void handleToolRejection(feedId, card.planId!, card.runId)
                }
              >
                Discard
              </button>
            </div>
          </>
        )}

        {isBuilding && (
          <div className={`tool-viewer-footer${card.showRetry || card.mode === 'building' ? '' : ' hidden'}`}>
            {card.showRetry && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={card.busy}
                onClick={() => void runToolBuild(feedId, card.planId!, card.runId)}
              >
                Retry Build
              </button>
            )}
          </div>
        )}

        {card.resultError && (
          <div className="tool-plan-result error">{card.resultError}</div>
        )}
      </div>
    </article>
  )
}
