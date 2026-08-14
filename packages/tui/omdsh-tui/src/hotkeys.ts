/**
 * Keyboard-shortcut help painted by `/hotkeys` (OMP `/hotkeys` surface,
 * limited to bindings this TUI actually implements).
 * @module @omdsh/tui
 */

/** Body shown as a notice when `/hotkeys` runs. */
export function formatHotkeysText(): string {
  return [
    'Keyboard shortcuts',
    '',
    'Editor',
    '  Enter                 submit',
    '  Shift/Alt/Ctrl+Enter  newline',
    '  Ctrl+A / Home         line start',
    '  Ctrl+E / End          line end',
    '  Alt+B / Alt+Left      word left',
    '  Alt+F / Alt+Right     word right',
    '  Ctrl+] then char      jump forward to character',
    '  Ctrl+Alt+] then char  jump backward to character',
    '  Ctrl+W / Alt+Backspace  delete word backward',
    '  Alt+D                 delete word forward',
    '  Ctrl+U                delete to line start',
    '  Ctrl+K                delete to line end',
    '  Ctrl+Y                yank',
    '  Alt+Y                 yank pop',
    '  Ctrl+-                undo',
    '  Ctrl+D                delete forward / quit if empty',
    '  Ctrl+C                clear/interrupt; press twice to exit',
    '  Ctrl+Z                suspend',
    '  Alt+L                 reset display',
    '  Ctrl+X                edit prompt in $VISUAL/$EDITOR',
    '  Ctrl+V                paste clipboard verbatim',
    '  Alt+C                 copy current prompt',
    '  Ctrl+Alt+C            copy current line',
    '',
    'Transcript',
    '  PgUp / PgDn           scroll',
    '  Shift+↑ / Shift+↓     fast scroll',
    '  mouse wheel           scroll',
    '  Ctrl+O                expand tool output',
    '',
    'Session',
    '  Ctrl+R                search history',
    '  Alt+R                 retry last human prompt',
    '  /                     slash commands',
    '  @ ./ ~/               file paths',
    '  Tab                   complete / file path',
    '  /copy                 copy picker',
    '  /hotkeys              this list',
  ].join('\n')
}
