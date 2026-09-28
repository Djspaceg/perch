# Editor keybindings

Normative. Code lives in `src/keybindings/`; a change to a rule here is a change to that code and
its tests, in the same commit. "MUST" and "MUST NOT" mean what they say.

## 1. Shortcuts and local keys

A **shortcut** runs an editor command wherever its scope is active: new, open, save, save as, undo,
redo, delete the selection, deselect. Every shortcut MUST be a command in the registry (`commands.ts`) and MUST reach
its handler through the one dispatcher (section 5). No component adds its own `keydown` listener
for a shortcut.

A **local key** is part of how one control works and means nothing outside it: arrows, Home/End and
PageUp/PageDown in a number field, tab strip, segmented control or placement grid; Enter to commit
a field or connect; Escape to clear a search box, close a popover or back out of a delete confirm.
Local keys stay in the control's own `onKeyDown` (or, for a popover, its own listener), are not in
the registry and are not rebindable. A control that uses a key MUST `preventDefault` it, which is
what tells the dispatcher the key is spent.

## 2. Binding strings

```text
binding  = *(modifier "+") key
modifier = "Mod" | "Ctrl" | "Alt" | "Shift" | "Meta"
key      = one printable character | named key
named    = Escape Enter Tab Space Backspace Delete Insert Home End PageUp PageDown
           ArrowUp ArrowDown ArrowLeft ArrowRight F1 ... F12
```

- Names are case-insensitive on input and canonical on output: `mod+shift+z` is `Mod+Shift+Z`.
  Modifiers are written in the order `Mod Ctrl Alt Shift Meta`. The `+` key itself is `Mod++`.
- Each modifier appears at most once. `Mod` MUST NOT be combined with `Ctrl` or `Meta`, since on
  one platform or the other it would be that key twice.
- **`Mod`** is Meta (Command) on macOS, iPhone and iPad, and Control everywhere else. It is the
  default for a primary shortcut. `Ctrl` and `Meta` are literal on every platform: `Ctrl+Y` is
  Control-Y on a Mac too.
- A string that does not parse is an error in a default (a test fails) and a dropped binding in an
  override (reported, section 7).

## 3. Matching

- The held modifiers MUST equal the binding's exactly. An extra modifier never matches, so
  Ctrl-Z on a Mac and Meta-Z elsewhere reach the browser.
- The key is matched on `KeyboardEvent.key`, letters in either case. A layout's own
  punctuation is therefore matched by the character it types.
- `KeyboardEvent.code` is a fallback for letters and digits only, and only when `key` did not type
  an ASCII character (`Dead`, `Unidentified`, or a non-ASCII character: a Cyrillic layout, a Mac's
  Option layer). Then `KeyZ` counts as `Z`. On a Latin layout `key` always wins, so AZERTY's Ctrl-W
  is never read as Ctrl-Z.
- An event already `defaultPrevented`, or typed during IME composition, is never a shortcut.

## 4. Scopes and precedence

A command's scope is `global`, `canvas`, `sidebar`, or a set of them. A region declares its
scope with `keyScope('canvas')` (the attribute `data-perch-keyscope`). The active scopes of a key
are the scope regions around its target, innermost first, then `global`.

The dispatcher tries each active scope in that order and, within one scope, the commands in
registry order. The first command that matches, is not held back by section 5 and has an enabled
handler runs; nothing else does. So a scoped command beats a global one inside its region, and a
command with no handler mounted lets the next one have the key.

## 5. Fields, popovers and confirms get the key first

A key is **owned** by its target when:

- the target is a text entry (a text-like `<input>`, a `<textarea>`, or contenteditable), for
  every key; or
- the key is Escape and the target is in any `<input>`, `<select>`, `<textarea>`, contenteditable,
  `[role="dialog"]` (a popover) or the inline delete confirm.

A command does not run on an owned key unless it sets `inFields: true`. The four `document.*`
commands do, since Mod+S in a field means save and never types an S. Undo does not: undo in a field
is the browser's undo of the typing.

## 5a. A host's menu

A host with a menu bar (the desktop app, `src/editor-host.ts`) shows the document and history
commands in it, with the accelerator of each command's first binding in effect, overrides included:
the editor sends the host its keymap whenever it changes. A menu item runs its command through the
same registry as the key (`useCommandRunner`), with one exception: the menu's Undo and Redo while a
text entry has focus are the platform's text undo and redo, as the keys are there. New, Open and
Save As have a handler only where a host is; in a browser their keys are left to the browser.

## 6. Display

- `formatBinding`: macOS writes glyphs in its menus' order, `⌃⌥⇧⌘`, then the key (`⌫ ⌦ ⎋ ↩ ⇥ ↑ ↓
  ← →` for named keys); elsewhere words joined by `+`: `Ctrl+Shift+Z`.
- `aria-keyshortcuts` names keys, not symbols, the same on every platform: `Control`, `Meta`,
  `Alt`, `Shift`, then the key, and one space between alternatives.
- A tooltip is the label and its first binding, with any others as alternatives:
  `Redo (Ctrl+Shift+Z or Ctrl+Y)`. Only the current platform's bindings are shown.
- UI that shows a shortcut MUST read it from `useKeybinding(id)`, never spell it by hand, so what
  is shown is what is accepted.

## 7. Overrides

`settings.keybindings` in the editor store (persisted) maps a command id to a binding list that
replaces that command's defaults on every platform. `[]` unbinds it; absence means the defaults.
`resolveKeymap(defaults, overrides, platform)` layers them and reports, as data:

- `invalid`: a string that does not parse; dropped.
- `reserved`: an arrow, Home, End, PageUp, PageDown, Enter, Space or Tab with no modifier but
  Shift, which controls use as local keys; dropped.
- `unknown`: an id no command has (a stale or newer setting); ignored, and kept in storage.
- `conflict`: two commands with one key in a shared scope (`global` shares every scope), with the
  `winner` section 4 picks.

## 8. Adding a command

1. Add an entry to `COMMANDS`: an `id` as `area.verb`, a `label`, a `scope` and `keys` (one list, or
   `{ mac, other }` when the platforms differ). The id type follows, so a typo is a compile error.
2. Call `useCommand(id, handler, { enabled })` in the component that owns the action.
3. Show the key with `useKeybinding(id)` wherever the action has a button.
4. Add the command's row below.

## 9. Commands

| id                 | label                   | scope           | macOS         | Windows, Linux          |
| ------------------ | ----------------------- | --------------- | ------------- | ----------------------- |
| `document.new`     | New                     | global          | ⌘N            | Ctrl+N                  |
| `document.open`    | Open                    | global          | ⌘O            | Ctrl+O                  |
| `document.save`    | Save                    | global          | ⌘S            | Ctrl+S                  |
| `document.saveAs`  | Save As                 | global          | ⇧⌘S           | Ctrl+Shift+S            |
| `history.undo`     | Undo                    | global          | ⌘Z            | Ctrl+Z                  |
| `history.redo`     | Redo                    | global          | ⇧⌘Z           | Ctrl+Shift+Z, Ctrl+Y    |
| `selection.delete` | Delete selected element | canvas          | ⌦, ⌫          | Delete, Backspace       |
| `selection.clear`  | Deselect                | canvas, sidebar | ⎋             | Escape                  |

`selection.delete` asks first, through the selection header's confirm. `selection.clear` acts only
while something is selected. `document.new`, `document.open` and `document.saveAs` act only with a
host (section 5a); `document.save` acts everywhere, and for New's untitled document is a Save As.
