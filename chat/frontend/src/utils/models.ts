export function isWildcardModel(id: string): boolean {
  return id.endsWith('/*') || id === '*'
}

export function getProvider(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash === -1 ? 'other' : modelId.slice(0, slash)
}

export function getModelLabel(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash === -1 ? modelId : modelId.slice(slash + 1)
}

export function isGeminiModel(modelId: string): boolean {
  return getProvider(modelId) === 'gemini'
}

export function groupModels(models: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const model of models) {
    const provider = getProvider(model)
    if (!grouped.has(provider)) grouped.set(provider, [])
    grouped.get(provider)!.push(model)
  }
  return grouped
}
