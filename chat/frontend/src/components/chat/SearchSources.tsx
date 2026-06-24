import type { SearchSource } from '../../types/events'

type SearchSourcesProps = {
  sources: SearchSource[]
}

export function SearchSources({ sources }: SearchSourcesProps) {
  if (sources.length === 0) return null

  return (
    <div className="message-sources">
      <p className="message-sources-label">Sources</p>
      <ol className="message-sources-list">
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}
