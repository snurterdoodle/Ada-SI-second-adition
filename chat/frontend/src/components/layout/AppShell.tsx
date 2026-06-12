import { useAppStore } from '../../state/store'
import { ProcessPanel } from '../process/ProcessPanel'
import { SidePanel } from '../sidebar/SidePanel'
import { ModelToolbar } from '../toolbar/ModelToolbar'
import { Messages } from '../chat/Messages'
import { Composer } from '../composer/Composer'
import { CoreStage } from '../core/CoreStage'
import { EffectsLayer } from '../effects/EffectsLayer'

export function AppShell() {
  const feed = useAppStore((s) => s.feed)
  const showScrollBottom = useAppStore((s) => s.showScrollBottom)
  const setShowScrollBottom = useAppStore((s) => s.setShowScrollBottom)

  return (
    <div className="app-shell">
      <EffectsLayer />
      <ProcessPanel />
      <div className="main-column">
        <ModelToolbar />
        <CoreStage expanded={feed.length === 0} />
        <div className="chat-surface holo-panel">
          <div className="messages-wrap">
            <Messages feed={feed} />
            <button
              type="button"
              className={`scroll-bottom${showScrollBottom ? '' : ' hidden'}`}
              title="Scroll to bottom"
              onClick={() => setShowScrollBottom(false)}
            >
              ↓ New messages
            </button>
          </div>
          <Composer />
        </div>
      </div>
      <SidePanel />
    </div>
  )
}
