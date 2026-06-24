import { useAppStore } from '../../state/store'
import { useAgentBootstrap } from '../../hooks/useAgentBootstrap'
import { getModelLabel, groupModels, isGeminiModel } from '../../utils/models'
import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from '../../utils/reasoningEffort'

export function AgentsSettings() {
  const models = useAppStore((s) => s.models)
  const chatModel = useAppStore((s) => s.chatModel)
  const toolCreatorModel = useAppStore((s) => s.toolCreatorModel)
  const thinkingEffort = useAppStore((s) => s.thinkingEffort)
  const geminiGoogleSearch = useAppStore((s) => s.geminiGoogleSearch)
  const setChatModel = useAppStore((s) => s.setChatModel)
  const setToolCreatorModel = useAppStore((s) => s.setToolCreatorModel)
  const setThinkingEffort = useAppStore((s) => s.setThinkingEffort)
  const setGeminiGoogleSearch = useAppStore((s) => s.setGeminiGoogleSearch)
  const { loadAgents } = useAgentBootstrap()

  const grouped = groupModels(models)
  const sortedProviders = [...grouped.keys()].sort((a, b) => a.localeCompare(b))
  const scoutIsGemini = isGeminiModel(chatModel)
  const searchAvailable = scoutIsGemini || isGeminiModel(toolCreatorModel)

  const renderModelSelect = (
    id: string,
    label: string,
    hint: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <p className="forger-guidance-hint">{hint}</p>
      <select id={id} value={value} disabled={models.length === 0} onChange={(e) => onChange(e.target.value)}>
        {models.length === 0 ? (
          <option value="">No models found</option>
        ) : (
          sortedProviders.map((provider) => (
            <optgroup key={provider} label={provider}>
              {(grouped.get(provider) || [])
                .sort((a, b) => a.localeCompare(b))
                .map((model) => (
                  <option key={model} value={model}>
                    {getModelLabel(model)}
                  </option>
                ))}
            </optgroup>
          ))
        )}
      </select>
    </div>
  )

  return (
    <div className="agents-settings">
      <div className="settings-section-header">
        <div>
          <h3>Agents &amp; analysis depth</h3>
          <p className="settings-section-desc">
            Choose which models power chat orchestration and skill forging, and how much reasoning
            depth they use.
          </p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => void loadAgents()}>
          Reload available models
        </button>
      </div>

      <div className="settings-fields">
        {renderModelSelect(
          'settings-chat-model',
          'Scout agent',
          'Handles chat, routing, and deciding when to forge or call skills.',
          chatModel,
          setChatModel,
        )}
        {renderModelSelect(
          'settings-tool-model',
          'Forge master',
          'Plans, generates, and repairs Python skills during the build pipeline.',
          toolCreatorModel,
          setToolCreatorModel,
        )}
        <div className="settings-field">
          <label htmlFor="settings-thinking-effort">Analysis depth</label>
          <p className="forger-guidance-hint">
            Reasoning depth for both Scout agent and Forge master on supported models.
          </p>
          <select
            id="settings-thinking-effort"
            value={thinkingEffort}
            onChange={(e) => setThinkingEffort(e.target.value as ReasoningEffort)}
          >
            {REASONING_EFFORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label className="settings-checkbox-label" htmlFor="settings-gemini-google-search">
            <input
              id="settings-gemini-google-search"
              type="checkbox"
              checked={geminiGoogleSearch}
              disabled={!searchAvailable}
              onChange={(e) => setGeminiGoogleSearch(e.target.checked)}
            />
            Google Search grounding (Gemini)
          </label>
          <p className="forger-guidance-hint">
            {searchAvailable
              ? 'When enabled, Gemini models use built-in Google Search — Scout when Scout is Gemini, Forge when Forge master is Gemini.'
              : 'Available when Scout or Forge master uses a Gemini model.'}
          </p>
        </div>
      </div>
    </div>
  )
}
