import { describe, expect, it } from 'vitest'
import { mathLayout } from './math.ts'
import { oracleWidth } from './width.oracle.ts'

describe('terminal math', () => {
  it('keeps script scopes and translates complete operands only', () => {
    expect(mathLayout(String.raw`\alpha_i+x^{2k}+y^{ab}`)).toEqual(['αᵢ+x²ᵏ+y^(ab)'])
    expect(mathLayout(String.raw`x_{pq}`)).toEqual(['x_(pq)'])
    expect(mathLayout(String.raw`\frac{a+b}{c}+\sqrt{x}`)).toEqual(['(a+b)/c+√(x)'])
    expect(mathLayout(String.raw`\mathbb{R}\to\mathbb{C}`)).toEqual(['ℝ→ℂ'])
    expect(mathLayout('\\text{line\n break}')).toEqual(['line break'])
    expect(mathLayout(String.raw`\epsilon\varepsilon\phi\varphi`)).toEqual(['ϵεϕφ'])
  })

  it('aligns operators to fraction baselines, retaining nested fractions', () => {
    expect(mathLayout(String.raw`x=\frac{a+b}{c}`, true)).toEqual(['  a+b', 'x=───', '   c'])
    expect(mathLayout(String.raw`\frac{1}{\frac{a}{b}}`, true)).toEqual([' 1', '───', ' a', ' ─', ' b'])
    expect(mathLayout(String.raw`\frac{a}{b}\frac{c}{d}`, true)).toEqual(['a c', '─ ─', 'b d'])
    expect(mathLayout(String.raw`\sqrt{x+1}`, true)).toEqual([' ────', '√x+1'])
    expect(mathLayout(String.raw`\sum_{i=0}^{n}x_i`, true)).toEqual([' n', ' ∑ xᵢ', 'i=0'])
  })

  it('renders matrices, cases and aligned rows without losing cells', () => {
    expect(mathLayout(String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`, true)).toEqual(['⎡ a  b ⎤', '⎣ c  d ⎦'])
    expect(mathLayout(String.raw`\begin{cases}x&x>0\\0&\text{otherwise}\end{cases}`, true)).toEqual(['⎧ x  x>0', '⎩ 0  otherwise'])
    expect(mathLayout(String.raw`\begin{aligned}x&=1\\y&=2\end{aligned}`, true)).toEqual(['x  =1', 'y  =2'])
    expect(mathLayout(String.raw`\begin{matrix}a&b\\c&d\end{matrix}`)).toBeUndefined()
  })

  it.each([String.raw`\alpha+\unknown{x}`, String.raw`\frac{x}`, String.raw`x^{ab`, String.raw`x^{}`, String.raw`x^2^3`,
    String.raw`\begin{bmatrix}1&2`, String.raw`\begin{array}{cc}1&2\end{array}`, String.raw`\alpha+\text{\unknown}`,
    String.raw`\frac{}{x}`, String.raw`\sqrt[ab]{x}`, 'x\x1b[31m'])('rejects the entire unsupported or incomplete expression: %s', source => {
    expect(mathLayout(source, true)).toBeUndefined()
  })

  it('bounds layout work and rejects layouts that cannot fit intact', () => {
    expect(mathLayout('{'.repeat(30) + 'x' + '}'.repeat(30), true)).toBeUndefined()
    expect(mathLayout('x'.repeat(5000), true)).toBeUndefined()
    expect(mathLayout(String.raw`\frac{a+b}{c}`, true, 2)).toBeUndefined()
    expect(mathLayout(String.raw`\begin{matrix}` + 'x\\\\'.repeat(9) + String.raw`\end{matrix}`, true)).toBeUndefined()
    const rows = mathLayout(String.raw`\frac{\text{中文🐳}}{x}`, true, 6)!
    expect(rows).toBeDefined()
    expect(rows.every(row => oracleWidth(row) <= 6)).toBe(true)
  })
})
