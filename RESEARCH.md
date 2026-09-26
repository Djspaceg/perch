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

## What perch built

**Superseded by the human's choice:** Webflow's box-model diagram, with the padding ring only and
no margin ring. Four trapezoid sides sit around a centre, and each side shows its value on that
side. It improves on Webflow with links:

- Top always holds a number.
- Right, bottom and left each show a chain link (linked) or their own number plus a broken link
  (set). They link as CSS shorthand pairs them: bottom follows top, and right and left follow top
  until either is set, then follow each other.
- Clicking a link unlinks the side at the value it was inheriting. Clicking the broken link
  clears the side and relinks it.
- Dragging a side scrubs it, and each number is a normal field with arrows and Shift for x10.
- The centre shows only the unit, `px`. Top also accepts a pasted shorthand.

Corner radius uses the matching border-radius rule in a four-corner diagram: bottom-right follows
top-left, and top-right and bottom-left are the pair. That part is the brief's default, not the human's
explicit design.

The first recommendation, one shorthand field with a toggle to four fields, is not built.
