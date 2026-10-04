import type { TuiPrompt } from '../definition.ts'
import { rankSearchResults } from '../input/fuzzy-search.ts'

type Option = NonNullable<TuiPrompt['options']>[number]
export interface PromptTreeRow { option: Option; prefix: string; expandable: boolean; matched: boolean }
const rowCache = new WeakMap<TuiPrompt, { collapsed: ReadonlySet<string> | undefined; query: string; rows: PromptTreeRow[] }>()

/** Preserve hierarchy during filtering; linear chains do not consume indentation. */
export function promptTreeRows(request: TuiPrompt, collapsed?: ReadonlySet<string>, query = ''): PromptTreeRow[] {
  const cached = rowCache.get(request)
  if (cached !== undefined && cached.collapsed === collapsed && cached.query === query) return cached.rows
  const options = request.options ?? []
  const byValue = new Map(options.map(option => [option.value ?? option.label, option]))
  const parents = new Map<string, string | undefined>()
  for (const option of options) {
    const value = option.value ?? option.label
    const parent = option.parentValue
    parents.set(value, parent !== undefined && byValue.has(parent) ? parent : undefined)
  }
  const checked = new Set<string>()
  for (const value of parents.keys()) {
    const path = new Set<string>()
    let cursor: string | undefined = value
    while (cursor !== undefined && !checked.has(cursor)) {
      if (path.has(cursor)) { parents.set(cursor, undefined); break }
      path.add(cursor)
      cursor = parents.get(cursor)
    }
    for (const entry of path) checked.add(entry)
  }
  const keep = new Set<string>()
  const matched = new Set<string>()
  if (query !== '') {
    const hits = rankSearchResults(options, query, option => [option.label, option.preview, option.description].filter((part): part is string => part !== undefined))
    for (const hit of hits) {
      matched.add(hit.value ?? hit.label)
      let value: string | undefined = hit.value ?? hit.label
      while (value !== undefined && !keep.has(value)) { keep.add(value); value = parents.get(value) }
    }
  }
  const children = new Map<string | undefined, Option[]>()
  for (const option of options) {
    const value = option.value ?? option.label
    if (query !== '' && !keep.has(value)) continue
    const parent = parents.get(value)
    const siblings = children.get(parent) ?? []
    siblings.push(option)
    children.set(parent, siblings)
  }
  const rows: PromptTreeRow[] = []
  // Explicit stack keeps long linear conversations independent of call-stack depth.
  const pending = (children.get(undefined) ?? []).map(option => ({ option, stem: '', connector: '' })).reverse()
  while (pending.length > 0) {
    const { option, stem, connector } = pending.pop()!
    const value = option.value ?? option.label
    const descendants = children.get(value) ?? []
    rows.push({ option, prefix: stem + connector, expandable: descendants.length > 0, matched: query === '' || matched.has(value) })
    if (query === '' && collapsed?.has(value)) continue
    for (let index = descendants.length - 1; index >= 0; index--) {
      const branching = descendants.length > 1
      const last = index === descendants.length - 1
      pending.push({ option: descendants[index]!, stem: stem + (connector === '├─ ' ? '│  ' : connector === '└─ ' ? '   ' : ''),
        connector: branching ? last ? '└─ ' : '├─ ' : '' })
    }
  }
  rowCache.set(request, { collapsed, query, rows })
  return rows
}
