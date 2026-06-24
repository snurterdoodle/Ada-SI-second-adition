import { useMemo, useState } from 'react'
import { useSkillActions } from '../../hooks/useSkillActions'
import type { SkillUiConfig } from '../../types/events'

type CalendarAppProps = {
  skillName: string
  ui: SkillUiConfig
}

function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function CalendarApp({ skillName, ui }: CalendarAppProps) {
  const titleField = ui.title_field || 'title'
  const dateField = ui.date_field || 'start'
  const endField = ui.end_date_field || 'end'
  const { data, loading, error, create, remove } = useSkillActions(skillName, ui)
  const [cursor, setCursor] = useState(() => new Date())
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const monthStart = useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    [cursor],
  )
  const monthLabel = monthStart.toLocaleString(undefined, { month: 'long', year: 'numeric' })

  const gridDays = useMemo(() => {
    const firstDow = monthStart.getDay()
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const cells: Array<Date | null> = []
    for (let i = 0; i < firstDow; i += 1) cells.push(null)
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day))
    }
    return cells
  }, [cursor, monthStart])

  const eventsForDay = (day: Date) =>
    data.records.filter((record) => {
      const startDate = parseDate(record[dateField])
      return startDate ? sameDay(startDate, day) : false
    })

  const visibleEvents = selectedDay
    ? eventsForDay(selectedDay)
    : data.records.slice().sort((a, b) => {
        const ad = parseDate(a[dateField])?.getTime() ?? 0
        const bd = parseDate(b[dateField])?.getTime() ?? 0
        return ad - bd
      })

  const handleCreate = async () => {
    if (!title.trim() || !start) return
    const params: Record<string, unknown> = {
      [titleField]: title.trim(),
      [dateField]: new Date(start).toISOString(),
    }
    if (end) params[endField] = new Date(end).toISOString()
    await create(params)
    setTitle('')
    setStart('')
    setEnd('')
  }

  const handleDelete = async (id: string) => {
    await remove({ event_id: id })
  }

  if (loading && data.records.length === 0) {
    return <p className="skill-app-status">Loading calendar…</p>
  }

  return (
    <div className="skill-app-calendar">
      {error && <p className="skill-app-error">{error}</p>}

      <div className="skill-app-calendar-header">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
          }
        >
          ‹
        </button>
        <h4>{monthLabel}</h4>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
          }
        >
          ›
        </button>
      </div>

      <div className="skill-app-calendar-grid" aria-label="Month view">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
          <span key={label} className="skill-app-calendar-dow">
            {label}
          </span>
        ))}
        {gridDays.map((day, index) => {
          if (!day) return <span key={`empty-${index}`} className="skill-app-calendar-cell empty" />
          const count = eventsForDay(day).length
          const isSelected = selectedDay ? sameDay(day, selectedDay) : false
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={`skill-app-calendar-cell${isSelected ? ' selected' : ''}`}
              onClick={() => setSelectedDay(day)}
            >
              <span>{day.getDate()}</span>
              {count > 0 && <em className="skill-app-calendar-dot">{count}</em>}
            </button>
          )
        })}
      </div>

      <form
        className="skill-app-form"
        onSubmit={(e) => {
          e.preventDefault()
          void handleCreate()
        }}
      >
        <input
          type="text"
          placeholder="Event title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        <button type="submit" className="btn-primary btn-sm">
          Add event
        </button>
      </form>

      <div className="skill-app-list">
        <h5>{selectedDay ? 'Events on selected day' : 'All events'}</h5>
        {visibleEvents.length === 0 ? (
          <p className="skill-app-empty">No events yet.</p>
        ) : (
          visibleEvents.map((record) => {
            const id = String(record.id ?? '')
            const startDate = parseDate(record[dateField])
            return (
              <div key={id || JSON.stringify(record)} className="skill-app-list-row">
                <div>
                  <strong>{String(record[titleField] ?? 'Untitled')}</strong>
                  {startDate && (
                    <p className="skill-app-meta">{startDate.toLocaleString()}</p>
                  )}
                </div>
                {id && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void handleDelete(id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
