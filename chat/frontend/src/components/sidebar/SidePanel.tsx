import { useEffect } from 'react'
import { useToolBuildStream } from '../../hooks/useToolBuildStream'
import { useAppStore } from '../../state/store'
import { PackagesTab } from './PackagesTab'
import { ToolsTab } from './ToolsTab'

export function SidePanel() {
  const activeTab = useAppStore((s) => s.activeSidePanelTab)
  const setActiveTab = useAppStore((s) => s.setActiveSidePanelTab)
  const tools = useAppStore((s) => s.tools)
  const packages = useAppStore((s) => s.packages)
  const appConfig = useAppStore((s) => s.appConfig)
  const { refreshTools, refreshPackages } = useToolBuildStream()

  useEffect(() => {
    void refreshTools()
    if (appConfig.tools?.length) {
      useAppStore.getState().setTools(appConfig.tools)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'packages') {
      void refreshPackages()
    }
  }, [activeTab])

  return (
    <aside className="side-panel tools-panel holo-panel">
      <div className="panel-header">
        <div className="panel-tabs" role="tablist" aria-label="Skills sidebar">
          <button
            type="button"
            className={`panel-tab${activeTab === 'tools' ? ' active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'tools'}
            onClick={() => setActiveTab('tools')}
          >
            Skills
          </button>
          <button
            type="button"
            className={`panel-tab${activeTab === 'packages' ? ' active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'packages'}
            onClick={() => setActiveTab('packages')}
          >
            Modules
          </button>
        </div>
        <div className="panel-title-row">
          <h2>{activeTab === 'packages' ? 'Modules' : 'Skills'}</h2>
          {activeTab === 'tools' ? (
            <span className="panel-badge">{tools.length}</span>
          ) : (
            <span className="panel-badge">{packages.length}</span>
          )}
        </div>
      </div>
      <div className={`tools-list scroll-area${activeTab !== 'tools' ? ' hidden' : ''}`}>
        <ToolsTab tools={tools} />
      </div>
      <div className={`tools-list scroll-area${activeTab !== 'packages' ? ' hidden' : ''}`}>
        <PackagesTab packages={packages} />
      </div>
    </aside>
  )
}
