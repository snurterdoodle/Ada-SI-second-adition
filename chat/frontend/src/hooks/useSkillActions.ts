import { useCallback, useEffect, useState } from 'react'
import { callSkillAction, fetchSkillData, resolveUiAction } from '../api/skillSdk'
import { useAppStore } from '../state/store'
import type { SkillDataDocument, SkillUiConfig } from '../types/events'

export function useSkillActions(skillName: string | null, ui?: SkillUiConfig) {
  const skillDataRevision = useAppStore((s) => s.skillDataRevision)
  const [data, setData] = useState<SkillDataDocument>({ records: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!skillName) return
    setLoading(true)
    try {
      const fetchAction = resolveUiAction(ui, 'fetch')
      if (fetchAction) {
        const response = await callSkillAction(skillName, fetchAction)
        setData(response.data)
      } else {
        const doc = await fetchSkillData(skillName)
        setData(doc)
      }
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [skillName, ui])

  useEffect(() => {
    void reload()
  }, [reload, skillDataRevision])

  const runAction = useCallback(
    async (key: keyof NonNullable<SkillUiConfig['actions']>, params: Record<string, unknown>) => {
      if (!skillName) return
      const action = resolveUiAction(ui, key)
      if (!action) {
        throw new Error(`No UI action mapped for ${key}`)
      }
      const response = await callSkillAction(skillName, action, params)
      setData(response.data)
      setError(null)
      return response
    },
    [skillName, ui],
  )

  const create = useCallback(
    (params: Record<string, unknown>) => runAction('create', params),
    [runAction],
  )

  const remove = useCallback(
    (params: Record<string, unknown>) => runAction('delete', params),
    [runAction],
  )

  const toggle = useCallback(
    (params: Record<string, unknown>) => runAction('toggle', params),
    [runAction],
  )

  return { data, loading, error, reload, create, remove, toggle }
}

export function newRecordId(): string {
  return crypto.randomUUID()
}
