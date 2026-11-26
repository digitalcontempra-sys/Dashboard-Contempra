/** True when `el` is the last open dialog on the page: only that one answers Escape when dialogs stack. */
export function isTopDialog(el: Element | null): boolean {
  const all = document.querySelectorAll('[role="dialog"]');
  return el !== null && all[all.length - 1] === el;
}
