/** Focus the sibling at `index` of a roving-tabindex control's element. */
export function focusSibling(from: HTMLElement, index: number): void {
  const target = from.parentElement?.children[index];
  if (target instanceof HTMLElement) target.focus();
}
