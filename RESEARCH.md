# Per-side padding and per-corner radius: how other tools do it

Read: Figma help (auto layout, padding, corner radius), Webflow spacing help, Penpot help and
source, Chrome DevTools CSS reference, Firefox box-model docs, Plasmic source (`SpacingControl.tsx`),
Onlook source (`padding.tsx`). Framer had no article: its row is from memory.

| Tool | Collapsed | Expand | Typed shorthand | Label scrub | Mixed shown as | Keys |
|---|---|---|---|---|---|---|
| Figma | pad: V + H; radius: 1 field | icon button, 4 fields | yes (Cmd-click, `1,2,3,4`) | yes | "Mixed" (memory) | arrows, Shift x10 |
| Webflow | box diagram, always 4 | click a side, popover | no | drag, Alt/Shift pairs | n/a | Enter |
| Framer (memory) | 1 field | icon toggle, 4 fields | ? | yes | "Mixed" | arrows, Shift x10 |
| Penpot | pad: V + H; radius: 1 | icon toggle, 4 | no (math expressions) | canvas drag | "Mixed" placeholder | arrows, Shift x10, Esc |
| Chrome DevTools | box diagram | double-click a side | 1 value | no | n/a | arrows, Shift, Esc |
| Firefox DevTools | box diagram | click a value | 1 value | no | n/a | arrows, Shift, Tab |
| Plasmic | 1 field showing CSS shorthand | box popover picks sides | yes, CSS parse | handles | blank | spinner |
| Onlook | button + value | All / Individual tabs; opens Individual if mixed | no | slider | "Mixed" | arrows, Shift x10 |

Patterns: a single field in the common case, with an icon toggle to four (Figma, Framer, Penpot);
open on four when the values already differ (Penpot, Onlook); typed CSS order in one field
(Plasmic, and Figma behind Cmd-click); arrows +/-1 and Shift +/-10 everywhere; Enter commits, Esc
reverts.

## Recommendation for perch

One field per property that always shows the **shortest CSS shorthand** of the stored values
(`8`, `8 16`, `8 16 4`, `8 16 4 2`). You can type or paste any shorthand into it, with `px`
allowed. An icon toggle beside it opens four number fields in **CSS order**: T R B L for padding,
TL TR BR BL for corners. The toggle starts open when the values differ, and it remembers your
choice for the session.

- **Shorthand instead of "Mixed".** Every tool that shows "Mixed" hides the values. The shorthand
  shows them exactly, and it doubles as the way to paste them in. The brief also asks for it.
- **CSS order in the four fields**, not a 2x2 grid or a box diagram, so each field sits where its
  number sits in the shorthand above it. Seeing the two side by side teaches the shorthand. It also
  fits the 420 px sidebar's one-line row.
- **The primitives perch already has**: a `NumberField` for each side, with scrub on its label,
  arrows, and Shift for x10. The row label scrubs all four sides together. Arrows in the shorthand
  field nudge every side. Enter commits and Esc reverts. Invalid input stays in the field with a
  message and is never written.
- **No canvas handles** in this slice. They would be a second input path to keep in step with the
  fields.
