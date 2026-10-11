# Template annotations: the readout's looks and behaviours in a text template

Status: first pass, for the human to review in the editor. Readouts are not migrated.

## The design

Two additions to the template grammar (`packages/layout-schema/src/template.ts`), both inside the
braces it already reserves, so no character gains a meaning it did not have and no layout changes:

- **Three sensor filters**, after `|` like `fixed:N`, for what only the placeholder can know:
  - `fit` paints the reading as a readout's number row: the value sized to the text box, between
    `--perch-value-size-min` and `--perch-value-size-max`, with its unit small and dim after it, and
    the value coloured by its state as a readout colours it (`| value` drops the unit).
  - `hold` keeps the last value while the reading is stale, in `--perch-stale`. The fallback then
    shows only before the first value.
  - `note` shows the readout's note row: `waiting`, `no reading` or `stale 8s` in the readout's note
    type, coloured `--perch-faint`, `--perch-warn` or `--perch-alert`, and nothing while live; its line
    keeps its height, so a panel does not twitch when a reading ages out.
- **Style spans**, `{#name}...{/name}`, for how a run looks. Four names, one per readout row, each
  reading that row's theme tokens: `label`, `unit`, `value`, `note`. Spans nest, must close in order,
  and wrap any mix of text and placeholders.

A full readout, as a template (one line per row):

```text
{#label}{sensors/cpu/0/temperature/0 | label}{/label}
{sensors/cpu/0/temperature/0 | fit | hold}
{sensors/cpu/0/temperature/0 | note}
```

| Readout behaviour | In a template |
| --- | --- |
| auto-fit value size | `\| fit` |
| smaller, dimmed unit | inside `\| fit`; or `{#unit}...{/unit}` around any run |
| a label row | a line of `{#label}...{/label}`, above or below |
| stale/waiting note in warn or alert | `\| note` |
| last value held while stale | `\| hold` |

Everything is opt-in: a template with none of these paints exactly as before.

## Why this, and not tags

See the survey below. In short: perch's grammar is already Liquid/Handlebars-shaped, `{#` and `{/`
are refused by the version 5 grammar so no valid caption contains them, and MessageFormat 2 settled
on the same `{#b}...{/b}` spelling for markup inside braces. HTML or BBCode tags would make `<` or
`[` special in captions that already use them, which means a second escape rule and a migration.
Styles are names, not CSS values, so a theme still restyles every run.

## Strictness

As before, a template is either valid or refused with a character offset: an unknown style, an
unclosed span, a close that does not match the open one, a close with nothing open, `fit` or `hold`
on `unit`, `label` or `note`, a repeated filter, and `||` on a `note` (which always says something).

## The survey

The question: how should a perch text template say "this run is the readout's big number, this one its
small dim unit, this one its label, this one its stale note", without breaking the grammar that already
exists (`{sensors/... | filter || fallback}`, `{time}`, `{{` and `}}` as braces)?

Each system is judged on four things, inside perch's text field:

- **Reads**: what a readout would look like written in it, and whether a non-programmer can read it.
- **Round-trips**: whether it survives a plain text field (perch's is a textarea, usually one line per
  row) with no hidden structure, and whether existing captions keep their meaning.
- **Validates**: whether a strict parser can refuse a typo with a character offset, as perch does now.
- **Localizes**: whether the annotation leaves the words translatable and the formatting to `Intl`.

### HTML/XML inline elements and attributes

`<span class="unit">°C</span>`, `<b>`, `<small>`. Pango markup (GTK, conky's Lua bars, waybar) is the
same shape with presentational attributes: `<span size="small" alpha="50%" foreground="#f00">`.

- Reads: `<small dim>°C</small>` is the most familiar annotation there is. A readout would be
  `<label>{x | label}</label>` then `<big>{x | fit}</big>`.
- Round-trips: badly. `<` and `>` are ordinary characters in captions today (`load > 80%`, `<- in`),
  so tags need an escape the grammar does not have, a migration that rewrites every existing `<`, and
  so a schema bump. Two escape rules (`{{` for braces, something else for angles) in one field.
- Validates: well, if the tag set is closed. Pango's attribute values are open (`size`, colours, alpha),
  which is the opposite of themeable: a raw `#f00` in a layout survives every theme change.
- Localizes: fine; tags wrap words, which stay translatable.

### Markdown, and SwiftUI's `AttributedString(markdown:)`

`**bold**`, `*em*`, `` `code` ``; SwiftUI adds `^[text](inflect: true)` and custom attributes as
`^[text](role: unit)`.

- Reads: `**61.5**` reads well, but Markdown only has emphasis levels, not roles: nothing means "dim",
  "unit" or "note". SwiftUI's `^[...](key: value)` escape hatch is exactly an attribute syntax, and
  reads as punctuation soup to a non-programmer.
- Round-trips: `*` and `_` appear in captions (`CPU_0`, `x*2`) and would change meaning.
- Validates: Markdown never refuses anything; a stray `*` is just a `*`. That is the opposite of
  perch's rule that a typo is shown to the author, not painted.
- Localizes: good (that was SwiftUI's reason for it).

### BBCode

`[b]...[/b]`, `[size=2]`, `[color=red]`.

- Reads: friendly and explicit open/close. A readout would be `[label]{x | label}[/label]`.
- Round-trips: `[` appears in captions (`[ok]`, `fan[0]`), so it needs escaping and a migration too.
- Validates: closed tag sets validate well; values (`[color=...]`) are open and raw.
- Localizes: fine.

### Mustache, Handlebars, Liquid, Jinja

Placeholders `{{x}}`, filters `{{ x | round: 1 }}` (Liquid, Jinja), and block helpers
`{{#if x}}...{{/if}}` (Handlebars), `{% if %}...{% endif %}` (Liquid, Jinja).

- Reads: perch already *is* this family: its `{x | fixed:1 || --}` is a Liquid filter chain with a
  default. Block helpers wrap runs: `{{#unit}}°C{{/unit}}`.
- Round-trips: inside the braces perch already reserves, a block form costs no new escape: `{#` and
  `{/` are refused by today's grammar, so no valid v5 caption contains one.
- Validates: Handlebars refuses an unclosed or mismatched block with its position; perch can do the same.
- Localizes: fine; blocks wrap words. Mustache sections (`{{#items}}`) also *loop*, which perch must
  not do: a closed set of names keeps the block form to styling.

### ICU MessageFormat

`{count, plural, one {# fan} other {# fans}}`, `{n, number, ::precision-integer}`, and in ICU 4/MF2
markup `{#b}bold{/b}`.

- Reads: the plural and select forms are the clearest prior art for *localized* text, and MF2 settled
  on `{#name}...{/name}` for markup inside a message, in braces, because braces were already reserved.
- Round-trips: same as Handlebars blocks; MF2's markup is the same spelling this survey arrives at.
- Validates: strict, with positions.
- Localizes: its whole point. Plurals are out of scope here, but the spelling leaves room for them.

### System-monitor and status-bar formats

- **conky**: `${color grey}CPU:$color ${cpu}% ${font Mono:size=20}${cpu}${font}`. Inline state-changing
  commands, not spans: a style is on until the next command resets it, so a dropped reset restyles the
  rest of the line. Open values (colour names, font strings).
- **Rainmeter**: styles are named in the skin (`[StyleValue]` sections) and each meter says
  `MeterStyle=StyleValue`; inline `InlineSetting=Color | 255,0,0` ranges by pattern. The lesson worth
  taking: named styles defined by the theme, referenced by name from the content.
- **polybar / lemonbar**: `%{F#f00}hot%{F-}`, `%{T2}` font index. Open values and set/reset pairs.
- **tmux**: `#[fg=red,bold]hot#[default]`. Same set/reset shape.
- **i3blocks / waybar**: Pango markup (above).

All five read as line noise to a non-programmer, and set/reset with no closing pair cannot be
validated as balanced. They do show that a status format puts *conditional* colour in the data
(i3blocks' `color` per update), not in the string.

### Grafana stat panel, Home Assistant

- **Grafana**: the value's colour comes from *thresholds* on the panel (`green < 70 <= orange < 90 <= red`),
  and "auto" font size fits the value to the panel. Neither is in a string; both are panel options.
- **Home Assistant**: Jinja templates (`{{ states('sensor.cpu') | round(1) }}`) with a default
  (`| default('--')`), and `availability` decides "unavailable"; styling lives in the card, not the
  template. Its `| round(1)` and `| default` are perch's `fixed:1` and `||`.

### What follows for perch

1. Perch is already a Liquid/Handlebars-shaped grammar, so the least surprising extension stays inside
   the braces: more `|` filters for what a *sensor* does, and a Handlebars/MF2 block
   `{#name}...{/name}` for how a *run* looks. Neither adds a character to escape, so no caption changes
   meaning and no migration is needed.
2. Styles are names, not values (Rainmeter's lesson, and the theme rule): each name is one of the
   readout's rows and reads that row's theme tokens, so a layout stays themeable and a template row
   looks exactly like the readout row it replaces.
3. Behaviour that depends on the reading (fit the number to the box, hold it while stale, say how
   stale) belongs to the placeholder, like Grafana's auto size and Home Assistant's availability:
   filters, because only the placeholder knows the reading.
4. Rejected: HTML/BBCode tags (a second escape and a migration), Markdown (no roles, never refuses),
   set/reset commands (cannot be balanced), open attribute values (not themeable).
