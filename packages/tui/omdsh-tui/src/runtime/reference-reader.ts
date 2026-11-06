/** Searchable Markdown reference pages built from the shared prompt surfaces. */
import type { TuiDocumentPosition, TuiService } from '../definition.ts'
import { choosePrompt } from '../prompt-intents.ts'

interface ReferenceSection { title: string; text: string }

/** Headings inside fenced examples are content, not navigation. */
export function referenceSections(text: string): ReferenceSection[] {
  const lines = text.split('\n')
  const headings: { title: string; level: number; row: number }[] = []
  let fence: string | undefined
  for (const [row, line] of lines.entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (delimiter !== undefined) {
      if (fence === undefined) fence = delimiter
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined
      continue
    }
    if (fence !== undefined) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (match !== null) headings.push({ title: match[2]!, level: match[1]!.length, row })
  }
  return headings.map((heading, index) => ({
    title: heading.title,
    text: lines.slice(heading.row, headings.slice(index + 1).find(next => next.level <= heading.level)?.row).join('\n').trim(),
  })).filter(section => section.text !== text.trim())
}

/** Copyable field values in the two-column diagnostic tables. */
export function referenceFields(text: string): { label: string; value: string }[] {
  return text.split('\n').flatMap(line => {
    const match = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*$/u.exec(line)
    return match === null ? [] : [{ label: match[1]!, value: match[2]! }]
  })
}

export async function readReference(tui: Pick<TuiService, 'prompt' | 'copyText'>, title: string, text: string, signal?: AbortSignal): Promise<void> {
  const abort = new AbortController()
  const active = signal === undefined ? abort.signal : AbortSignal.any([signal, abort.signal])
  const sections = [{ title: 'All sections', text }, ...referenceSections(text)]
  const positions = new Map<number, TuiDocumentPosition>()
  let selected = 0
  const prompt = (request: Parameters<TuiService['prompt']>[0]) => tui.prompt({ ...request, signal: active, onSuperseded: () => { abort.abort() } })
  while (!active.aborted) {
    const section = sections[selected]!
    const action = await prompt({
      localize: ['options', 'actions'], title, question: selected === 0 ? '' : section.title, detail: section.text,
      presentation: 'document', allowCustom: false, notify: false,
      options: [{ label: 'Back', value: 'close' }],
      actions: [
        ...(sections.length > 1 ? [{ key: 's', label: 'sections', valuePrefix: 'sections', scope: 'list' as const }] : []),
        ...(tui.copyText === undefined ? [] : [{ key: 'y', label: 'copy', valuePrefix: 'copy', scope: 'list' as const }]),
      ],
      ...(positions.has(selected) ? { documentPosition: positions.get(selected)! } : {}),
      onDocumentPosition: position => { positions.set(selected, position) },
    })
    if (active.aborted || action === null || action === 'close') return
    if (action === 'sections') {
      const answer = await prompt(choosePrompt({ localize: ['question', 'options'], title, question: 'Choose a section', filterable: true,
        initialValue: String(selected), options: sections.map((item, index) => ({
          label: item.title, value: String(index),
          ...(sections.filter(other => other.title === item.title).length > 1 ? {
            description: item.text.split('\n').find(line => line.trim() !== '' && !line.startsWith('#'))?.replace(/^[-*] /u, '') ?? '',
          } : {}),
        })) }))
      if (answer !== null && sections[Number(answer)] !== undefined) selected = Number(answer)
    } else if (action === 'copy') {
      const fields = referenceFields(section.text)
      const choices = [{ label: 'This page', value: section.text }, ...fields]
      const answer = fields.length === 0 ? '0' : await prompt(choosePrompt({ localize: ['title', 'question', 'options'], title: 'Copy', question: 'Choose content', filterable: true,
        options: choices.map((item, index) => ({ label: item.label, value: String(index), ...(index === 0 ? {} : { description: item.value }) })) }))
      const choice = answer === null ? undefined : choices[Number(answer)]
      if (!active.aborted && choice !== undefined) await tui.copyText?.(choice.value, choice.label)
    }
  }
}
