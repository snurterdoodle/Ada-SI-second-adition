import { deletePipPackage } from '../../api/client'
import { useToolBuildStream } from '../../hooks/useToolBuildStream'
import { useAppStore } from '../../state/store'

function PackagesEmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
        </svg>
      </div>
      <p className="empty-state-title">No modules yet</p>
      <p className="empty-state-text">
        Modules appear here after you approve pip installs during skill forging.
      </p>
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

import type { PipPackage } from '../../types/events'

type PackagesTabProps = {
  packages: PipPackage[]
}

export function PackagesTab({ packages }: PackagesTabProps) {
  const setStatus = useAppStore((s) => s.setStatus)
  const { refreshPackages } = useToolBuildStream()

  const handleDelete = async (packageName: string) => {
    if (!confirm(`Uninstall package "${packageName}"?`)) return
    try {
      await deletePipPackage(packageName)
      await refreshPackages()
      setStatus(`Package "${packageName}" removed.`)
    } catch (error) {
      setStatus(`Delete failed: ${(error as Error).message}`, true)
    }
  }

  if (packages.length === 0) {
    return <PackagesEmptyState />
  }

  return (
    <>
      {packages.map((pkg) => (
        <div key={pkg.name} className="tool-card package-card">
          <button
            type="button"
            className="tool-delete-btn"
            title="Uninstall package"
            onClick={() => void handleDelete(pkg.name)}
          >
            {iconTrash()}
          </button>
          <div className="tool-card-header">
            <span className="tool-card-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </span>
            <h3 className="tool-card-name">{pkg.name}</h3>
          </div>
          {pkg.version && <p className="tool-card-desc">Version: {pkg.version}</p>}
          {pkg.used_by && pkg.used_by.length > 0 && (
            <p className="tool-card-desc">Used by: {pkg.used_by.join(', ')}</p>
          )}
        </div>
      ))}
    </>
  )
}
