/** Search policies for short commands, paths, and human-choice lists. */

/** Lower is better; gaps cost more than matching at a word boundary. */
export function subsequencePenalty(query: string, target: string): number | undefined {
  const needle = Array.from(query.toLowerCase())
  if (needle.length === 0) return 0
  let at = 0
  let previous = -1
  let penalty = 0
  const chars = Array.from(target.toLowerCase())
  for (let index = 0; index < chars.length && at < needle.length; index += 1) {
    if (chars[index] !== needle[at]) continue
    if (previous >= 0) penalty += Math.max(0, index - previous - 1) * 3
    else penalty += index
    if (index === 0 || /[\s\-_.\/:]/u.test(chars[index - 1] ?? '')) penalty -= 2
    previous = index
    at += 1
  }
  return at === needle.length ? Math.max(0, penalty) : undefined
}

interface SearchField {
  literal: string
  words: string[]
}

interface CandidateIndex {
  fields: readonly string[]
  index: SearchField[]
}

// A selector holds its candidates across keystrokes; closing it releases the
// prepared text too. No global corpus of session previews is retained.
const indices = new WeakMap<object, CandidateIndex>()

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

function words(text: string): string[] {
  return normalize(text.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2'))
    .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
}

function candidateIndex(item: object, fields: readonly string[]): SearchField[] {
  const cached = indices.get(item)
  if (cached !== undefined && cached.fields.length === fields.length
    && cached.fields.every((value, index) => value === fields[index])) return cached.index
  const index = fields.map(text => ({ literal: normalize(text), words: words(text) }))
  indices.set(item, { fields: [...fields], index })
  return index
}

/** A token must match inside one word, rather than across unrelated prose. */
function wordScore(token: string, field: SearchField): number | undefined {
  let best: number | undefined
  for (const word of field.words) {
    let score: number | undefined
    if (word === token) score = 100
    else if (word.startsWith(token)) score = 80
    else if (word.includes(token)) score = 60
    else if (token.length >= 2) {
      const penalty = subsequencePenalty(token, word)
      // At most two omitted characters for short abbreviations; long words
      // may omit more, but cannot collect a query from scattered letters.
      if (penalty !== undefined && penalty <= Math.max(6, token.length * 2)) score = 40 - penalty
    }
    if (score !== undefined) best = Math.max(best ?? 0, score)
  }
  return best
}

/**
 * Rank selector choices by exact label, prefix, phrase, then word-local fuzzy
 * matching. Every whitespace-separated token must match; ties and empty
 * queries preserve the caller's order. Punctuation-only queries stay literal.
 */
export function rankSearchResults<T extends object>(
  items: readonly T[],
  query: string,
  getFields: (item: T) => readonly string[],
): readonly T[] {
  const needle = normalize(query.trim())
  if (needle === '') return items
  const tokens = needle.split(/\s+/u)
  const ranked: { item: T; score: number }[] = []
  for (const item of items) {
    const fields = candidateIndex(item, getFields(item))
    let score = 0
    let matched = true
    for (const token of tokens) {
      let best: number | undefined
      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
        const field = fields[fieldIndex]!
        const literal = field.literal.includes(token) ? 120 : undefined
        const fuzzy = /^[\p{L}\p{M}\p{N}]+$/u.test(token) ? wordScore(token, field) : undefined
        const value = Math.max(literal ?? 0, fuzzy ?? 0)
        if (value > 0) best = Math.max(best ?? 0, value + (fieldIndex === 0 ? 40 : 0))
      }
      if (best === undefined) { matched = false; break }
      score += best
    }
    if (!matched) continue
    const primary = fields[0]?.literal ?? ''
    if (primary === needle) score += 1_000
    else if (primary.startsWith(needle)) score += 800
    else if (primary.includes(needle)) score += 600
    else if (fields.some(field => field.literal.includes(needle))) score += 400
    ranked.push({ item, score })
  }
  return ranked.sort((a, b) => b.score - a.score).map(result => result.item)
}
