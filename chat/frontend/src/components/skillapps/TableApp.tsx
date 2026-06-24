import { useMemo, useState } from 'react'
import { useSkillActions } from '../../hooks/useSkillActions'
import type { SkillUiConfig } from '../../types/events'

type TableAppProps = {
  skillName: string
  ui: SkillUiConfig
}

export function TableApp({ skillName, ui }: TableAppProps) {
  const fields = useMemo(
    () => ui.fields?.length ? ui.fields : [{ key: 'title', label: 'Title', type: 'string' as const }],
    [ui.fields],
  )
  const { data, loading, error, create, remove } = useSkillActions(skillName, ui)
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  )

  const handleAdd = async () => {
    const hasValue = fields.some((f) => draft[f.key]?.trim())
    if (!hasValue) return
    const params: Record<string, unknown> = {}
    for (const field of fields) {
      const raw = draft[field.key]?.trim() ?? ''
      if (!raw) continue
      if (field.type === 'number') params[field.key] = Number(raw)
      else if (field.type === 'boolean') params[field.key] = raw === 'true'
      else params[field.key] = raw
    }
    await create(params)
    setDraft(Object.fromEntries(fields.map((f) => [f.key, ''])))
  }

  const handleDelete = async (id: string) => {
    await remove({ id })
  }

  if (loading && data.records.length === 0) {
    return <p className="skill-app-status">Loading table…</p>
  }

  return (
    <div className="skill-app-table">
      {error && <p className="skill-app-error">{error}</p>}

      <form
        className="skill-app-form skill-app-form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void handleAdd()
        }}
      >
        {fields.map((field) => (
          <label key={field.key} className="skill-app-field">
            <span>{field.label}</span>
            <input
              type={
                field.type === 'number'
                  ? 'number'
                  : field.type === 'date'
                    ? 'datetime-local'
                    : 'text'
              }
              value={draft[field.key] ?? ''}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
            />
          </label>
        ))}
        <button type="submit" className="btn-primary btn-sm">
          Add row
        </button>
      </form>

      <div className="skill-app-table-wrap">
        <table>
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.records.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 1} className="skill-app-empty">
                  No records yet.
                </td>
              </tr>
            ) : (
              data.records.map((record) => {
                const id = String(record.id ?? '')
                return (
                  <tr key={id || JSON.stringify(record)}>
                    {fields.map((f) => (
                      <td key={f.key}>{String(record[f.key] ?? '')}</td>
                    ))}
                    <td>
                      {id && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => void handleDelete(id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
