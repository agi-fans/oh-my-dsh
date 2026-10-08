/** Bounded terminal math layouts. Unsupported syntax rejects the whole expression. */
import { visibleWidth } from './width.ts'

export const MATH_MODES = ['auto', 'source'] as const
export type MathMode = typeof MATH_MODES[number]

interface Layout { rows: string[]; width: number; baseline: number; limits?: boolean }
interface Budget { left: number; depth: number }
const MAX_WIDTH = 256
const MAX_HEIGHT = 24
const SYMBOLS: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', partial: '∂', nabla: '∇',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftrightarrow: '⇔', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', emptyset: '∅',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…',
  sin: 'sin', cos: 'cos', tan: 'tan', log: 'log', ln: 'ln', exp: 'exp', lim: 'lim', min: 'min', max: 'max',
}
const SUPER: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', i: 'ⁱ', n: 'ⁿ', k: 'ᵏ', x: 'ˣ',
}
const SUB: Readonly<Record<string, string>> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ',
  m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
}

function box(rows: string[], baseline = 0): Layout {
  const width = Math.max(0, ...rows.map(visibleWidth))
  if (width > MAX_WIDTH || rows.length > MAX_HEIGHT) throw new Error('Math layout limit')
  return { rows, width, baseline }
}
function text(value: string): Layout { return box([value]) }
function pad(value: string, width: number, center = false): string {
  const gap = Math.max(0, width - visibleWidth(value))
  return ' '.repeat(center ? Math.floor(gap / 2) : 0) + value + ' '.repeat(center ? Math.ceil(gap / 2) : gap)
}
function join(left: Layout, right: Layout): Layout {
  const baseline = Math.max(left.baseline, right.baseline)
  const height = Math.max(baseline - left.baseline + left.rows.length, baseline - right.baseline + right.rows.length)
  const gap = left.rows.length > 1 && right.rows.length > 1 ? ' ' : ''
  return box(Array.from({ length: height }, (_, at) =>
    pad(left.rows[at - baseline + left.baseline] ?? '', left.width) + gap + (right.rows[at - baseline + right.baseline] ?? '')), baseline)
}
function flat(value: Layout): string {
  if (value.rows.length !== 1) throw new Error('Multiline inline operand')
  return value.rows[0]?.trim() ?? ''
}
function grouped(value: Layout): string {
  const body = flat(value)
  return /^(?:[\p{L}\p{N}]|\d+)$/u.test(body) ? body : `(${body})`
}
function delimit(value: Layout, left: string, right: string): Layout {
  if (value.rows.length === 1) return text(left + flat(value) + right)
  const brackets: Readonly<Record<string, string[]>> = {
    '(': ['⎛', '⎜', '⎝'], ')': ['⎞', '⎟', '⎠'], '[': ['⎡', '⎢', '⎣'], ']': ['⎤', '⎥', '⎦'],
    '{': ['⎧', '⎨', '⎩'], '}': ['⎫', '⎬', '⎭'],
  }
  const glyph = (side: string, at: number): string => brackets[side]?.[at === 0 ? 0 : at === value.rows.length - 1 ? 2 : 1] ?? side
  return box(value.rows.map((row, at) => glyph(left, at) + ' ' + pad(row, value.width) + (right === '' ? '' : ' ' + glyph(right, at))), value.baseline)
}

class Parser {
  #at = 0
  constructor(readonly source: string, readonly display: boolean, readonly budget: Budget) {}

  parse(stop?: string): Layout {
    if (++this.budget.depth > 20) throw new Error('Math nesting limit')
    try {
      let result = text('')
      while (this.#at < this.source.length && this.source[this.#at] !== stop) {
        if (--this.budget.left < 0) throw new Error('Math work limit')
        if (/\s/u.test(this.source[this.#at]!)) {
          this.#space()
          result = join(result, text(' '))
          continue
        }
        let atom = this.#atom()
        let sup: Layout | undefined, sub: Layout | undefined
        // TeX permits spaces between an atom and its scripts.
        const beforeSpace = this.#at
        this.#space()
        if (!['_', '^'].includes(this.source[this.#at] ?? '')) this.#at = beforeSpace
        while (this.source[this.#at] === '^' || this.source[this.#at] === '_') {
          const kind = this.source[this.#at++]!
          const operand = this.#argument()
          if (kind === '^') { if (sup !== undefined) throw new Error('Duplicate superscript'); sup = operand }
          else { if (sub !== undefined) throw new Error('Duplicate subscript'); sub = operand }
        }
        if (this.display && atom.limits === true && (sup !== undefined || sub !== undefined)) {
          const width = Math.max(atom.width, sup?.width ?? 0, sub?.width ?? 0)
          const above = sup?.rows ?? []
          atom = box([...above, ...atom.rows, ...(sub?.rows ?? [])].map(row => pad(row, width, true)), above.length + atom.baseline)
        } else if (sup !== undefined || sub !== undefined) {
          if (atom.rows.length > 1) atom = delimit(atom, '(', ')')
          if (sub !== undefined) atom = join(atom, this.#script(sub, false))
          if (sup !== undefined) atom = join(atom, this.#script(sup, true))
        }
        result = join(result, atom)
      }
      if (stop !== undefined) {
        if (this.source[this.#at] !== stop) throw new Error('Unclosed math group')
        this.#at++
      }
      return result
    } finally { this.budget.depth-- }
  }

  #space(): void { while (/\s/u.test(this.source[this.#at] ?? '') && this.#at < this.source.length) this.#at++ }
  #argument(): Layout {
    this.#space()
    if (this.source[this.#at] === '{') {
      this.#at++
      const result = this.parse('}')
      if (result.rows.every(row => row.trim() === '')) throw new Error('Empty math argument')
      return result
    }
    return this.#atom()
  }
  #rawGroup(): string {
    this.#space()
    if (this.source[this.#at++] !== '{') throw new Error('Expected group')
    const begin = this.#at
    let depth = 1
    while (this.#at < this.source.length && depth > 0) {
      const char = this.source[this.#at++]!
      if (char === '\\') { this.#at++; continue }
      if (char === '{') depth++
      if (char === '}') depth--
    }
    if (depth !== 0) throw new Error('Unclosed group')
    return this.source.slice(begin, this.#at - 1)
  }
  #script(value: Layout, sup: boolean): Layout {
    const raw = flat(value)
    if (raw === '') throw new Error('Empty script')
    const alphabet = sup ? SUPER : SUB
    const mapped = [...raw].map(char => alphabet[char])
    return text(mapped.length > 0 && mapped.every(char => char !== undefined)
      ? mapped.join('') : `${sup ? '^' : '_'}(${raw})`)
  }

  #atom(): Layout {
    const char = this.source[this.#at++]
    if (char === undefined || /[}_^&$]/u.test(char)) throw new Error('Unexpected math token')
    if (char === '{') return delimit(this.parse('}'), '(', ')')
    if (char !== '\\') return text(char)
    const command = /^[A-Za-z]+/u.exec(this.source.slice(this.#at))?.[0]
    if (command === undefined) {
      const escaped = this.source[this.#at++]
      if (escaped === undefined || !'{},;:!%#_| '.includes(escaped)) throw new Error('Unknown math escape')
      return text(',;:! '.includes(escaped) ? escaped === '!' ? '' : ' ' : escaped)
    }
    this.#at += command.length
    if (Object.hasOwn(SYMBOLS, command)) {
      const result = text(SYMBOLS[command]!)
      result.limits = ['sum', 'prod', 'lim', 'min', 'max'].includes(command)
      return result
    }
    if (['frac', 'dfrac', 'tfrac'].includes(command)) {
      const numerator = this.#argument(), denominator = this.#argument()
      if (!this.display || command === 'tfrac') return text(`${grouped(numerator)}/${grouped(denominator)}`)
      const width = Math.max(1, numerator.width, denominator.width) + (numerator.rows.length > 1 || denominator.rows.length > 1 ? 2 : 0)
      return box([...numerator.rows.map(row => pad(row, width, true)), '─'.repeat(width),
        ...denominator.rows.map(row => pad(row, width, true))], numerator.rows.length)
    }
    if (command === 'sqrt') {
      this.#space()
      let root = ''
      if (this.source[this.#at] === '[') { this.#at++; root = flat(this.parse(']')) }
      const operand = this.#argument()
      if ([...root].some(char => SUPER[char] === undefined)) throw new Error('Unsupported root index')
      const prefix = [...root].map(char => SUPER[char]).join('')
      if (!this.display) return text(prefix + '√(' + flat(operand) + ')')
      return box([' '.repeat(visibleWidth(prefix) + 1) + '─'.repeat(operand.width + 1),
        ...operand.rows.map((row, at) => (at === operand.baseline ? prefix + '√' : ' '.repeat(visibleWidth(prefix)) + '│') + pad(row, operand.width))], operand.baseline + 1)
    }
    if (['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname', 'mathbb', 'mathcal', 'boldsymbol'].includes(command)) {
      if (command === 'text') {
        const raw = this.#rawGroup()
        if (/\\(?![{}%#_])/u.test(raw)) throw new Error('Unsupported text escape')
        return text(raw.replace(/\\([{}%#_])/gu, '$1').replace(/\s+/gu, ' '))
      }
      const operand = this.#argument()
      if (command === 'mathbb') return text(({ R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' } as Record<string, string>)[flat(operand)] ?? flat(operand))
      return operand
    }
    if (command === 'left' || command === 'right') {
      this.#space()
      const next = this.source[this.#at++]
      if (next === '.') return text('')
      if (next === undefined || !'()[]|'.includes(next)) throw new Error('Unsupported delimiter')
      return text(next)
    }
    if (command === 'begin') return this.#environment(this.#rawGroup())
    throw new Error('Unsupported math command')
  }

  #environment(name: string): Layout {
    const supported = ['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'aligned', 'align', 'align*', 'gathered', 'equation', 'equation*']
    if (!supported.includes(name)) throw new Error('Unsupported math environment')
    const end = `\\end{${name}}`
    const start = this.#at
    let nested = 0, finish = -1
    for (let at = start; at < this.source.length; at++) {
      if (this.source.startsWith(`\\begin{${name}}`, at)) nested++
      if (this.source.startsWith(end, at)) { if (nested-- === 0) { finish = at; break } }
    }
    if (finish < 0) throw new Error('Unclosed environment')
    this.#at = finish + end.length
    const body = this.source.slice(start, finish)
    if (name.startsWith('equation')) return new Parser(body, this.display, this.budget).parse()
    const cells: string[][] = [[]]
    let chunk = '', braces = 0, environments = 0
    for (let at = 0; at < body.length; at++) {
      if (body.startsWith('\\begin{', at)) environments++
      if (body.startsWith('\\end{', at)) environments--
      const char = body[at]!
      if (char === '\\' && body[at + 1] !== '\\') { chunk += char + (body[++at] ?? ''); continue }
      if (char === '{') braces++
      if (char === '}') braces--
      if (braces === 0 && environments === 0 && (char === '&' || body.startsWith('\\\\', at))) {
        cells.at(-1)!.push(chunk); chunk = ''
        if (char !== '&') { cells.push([]); at++ }
      } else chunk += char
    }
    cells.at(-1)!.push(chunk)
    if (cells.at(-1)?.every(cell => cell.trim() === '')) cells.pop()
    if (cells.length === 0 || cells.length > 8 || cells.some(row => row.length > 8)) throw new Error('Matrix size limit')
    const grid = cells.map(row => row.map(cell => new Parser(cell.trim(), this.display, this.budget).parse()))
    const count = Math.max(...grid.map(row => row.length))
    const widths = Array.from({ length: count }, (_, col) => Math.max(...grid.map(row => row[col]?.width ?? 0)))
    const rows: string[] = []
    for (const row of grid) {
      const baseline = Math.max(...row.map(cell => cell.baseline))
      const height = Math.max(...row.map(cell => baseline - cell.baseline + cell.rows.length))
      for (let at = 0; at < height; at++) rows.push(widths.map((width, col) => {
        const cell = row[col]
        return pad(cell?.rows[at - baseline + (cell?.baseline ?? 0)] ?? '', width)
      }).join('  '))
    }
    const result = box(rows, Math.floor((rows.length - 1) / 2))
    if (!this.display && rows.length > 1) throw new Error('Multiline inline matrix')
    const delimiters: Readonly<Record<string, [string, string]>> = {
      pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['│', '│'], Vmatrix: ['║', '║'], cases: ['{', ''],
    }
    return delimiters[name] === undefined ? result : delimit(result, ...delimiters[name]!)
  }
}

/** Never return a partially converted formula or wrap a two-dimensional layout. */
export function mathLayout(source: string, display = false, width = MAX_WIDTH): string[] | undefined {
  if (source.length === 0 || source.length > 4096 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(source)) return undefined
  try {
    const result = new Parser(source.trim(), display, { left: 2048, depth: 0 }).parse()
    const rows = result.rows.map(row => row.trimEnd())
    return result.width <= width ? rows : undefined
  } catch { return undefined }
}
