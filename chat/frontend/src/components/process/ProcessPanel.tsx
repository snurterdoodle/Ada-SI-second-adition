import { cancelRun } from '../../api/client'
import { runHasActiveStep, useAppStore } from '../../state/store'
import { truncateText } from '../../utils/text'
import { ProcessStep } from './ProcessStep'

function ProcessEmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      </div>
      <p className="empty-state-title">No active quests</p>
      <p className="empty-state-text">Your quest timeline appears here as ADA works.</p>
    </div>
  )
}

export function ProcessPanel() {
  const processRuns = useAppStore((s) => s.processRuns)
  const runAbortControllers = useAppStore((s) => s.runAbortControllers)
  const stopActiveProcessStep = useAppStore((s) => s.stopActiveProcessStep)
  const setIsSending = useAppStore((s) => s.setIsSending)
  const setAbortController = useAppStore((s) => s.setAbortController)
  const setStatus = useAppStore((s) => s.setStatus)
  const isSending = useAppStore((s) => s.isSending)
  const activeRunId = useAppStore((s) => s.activeRunId)

  const stopProcessRun = (runId: string) => {
    runAbortControllers.get(runId)?.abort()
    useAppStore.getState().clearRunAbortController(runId)
    void cancelRun(runId)
    stopActiveProcessStep(runId)
    if (runId === activeRunId && isSending) {
      setAbortController(null)
      setIsSending(false)
    }
    setStatus('Quest stopped.')
  }

  return (
    <aside className="side-panel process-panel holo-panel">
      <div className="panel-header">
        <div className="panel-title-row">
          <h2>Quest Log</h2>
          {processRuns.length > 0 && (
            <span className="panel-badge">{processRuns.length}</span>
          )}
        </div>
      </div>
      <div className="process-runs scroll-area">
        {processRuns.length === 0 && <ProcessEmptyState />}
        {processRuns.map((run) => (
          <div key={run.runId} className="process-run" data-run-id={run.runId}>
            <div className="process-run-header">
              <p className="process-run-prompt" title={run.prompt}>
                {truncateText(run.prompt)}
              </p>
              {runHasActiveStep(run.runId) && (
                <button
                  type="button"
                  className="process-run-stop"
                  title="Stop this process"
                  aria-label="Stop process"
                  onClick={() => stopProcessRun(run.runId)}
                >
                  Stop
                </button>
              )}
            </div>
            <ul className="process-steps">
              {run.steps.map((step) => (
                <ProcessStep
                  key={step.stepId}
                  stepId={step.stepId}
                  label={step.label}
                  status={step.status}
                  model={step.model}
                  detail={step.detail}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}
