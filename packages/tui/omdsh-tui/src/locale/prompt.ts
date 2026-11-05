/** Explicitly owned prompt chrome; answers, previews and documents stay literal. */
import type { TuiPrompt } from '../definition.ts'
import { uiText, type UiLanguage } from './index.ts'

export function localizePrompt(request: TuiPrompt, language: UiLanguage): TuiPrompt {
  if (!request.localize) return request
  const owns = (field: 'title' | 'question' | 'options' | 'actions' | 'detail'): boolean => request.localize === true ? field !== 'detail' : Array.isArray(request.localize) && request.localize.includes(field)
  const text = (value: string): string => uiText(language, value)
  return {
    ...request,
    title: owns('title') ? text(request.title) : request.title,
    question: owns('question') ? text(request.question) : request.question,
    ...(request.detail === undefined || !owns('detail') ? {} : { detail: text(request.detail) }),
    ...(request.emptyText === undefined ? {} : { emptyText: text(request.emptyText) }),
    ...(request.submitLabel === undefined ? {} : { submitLabel: text(request.submitLabel) }),
    ...(request.dismissLabel === undefined ? {} : { dismissLabel: text(request.dismissLabel) }),
    ...(request.options === undefined ? {} : { options: request.options.map(option => ({
      ...option, value: option.value ?? option.label, label: owns('options') ? text(option.label) : option.label,
      ...(option.description === undefined || !owns('options') ? {} : { description: text(option.description) }),
      ...(option.badge === undefined ? {} : { badge: { ...option.badge, label: text(option.badge.label) } }),
      ...(option.submitLabel === undefined ? {} : { submitLabel: text(option.submitLabel) }),
    })) }),
    ...(request.actions === undefined || !owns('actions') ? {} : { actions: request.actions.map(action => ({ ...action, label: text(action.label) })) }),
  }
}
