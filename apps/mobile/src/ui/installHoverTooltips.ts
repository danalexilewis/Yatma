const controlSelector =
  'button, a[href], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="slider"], [tabindex="0"]';

/** Short hover copy is independent of the full accessible name used by screen readers. */
function tooltipLabel(control: Element, document: Document): string {
  const labelledBy = control
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  const label = (
    control.getAttribute("data-tooltip") ||
    control.getAttribute("title") ||
    control.getAttribute("aria-label") ||
    labelledBy ||
    control.textContent ||
    ""
  )
    .replace(/\p{Co}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return label
    .replace(/^(Start|Pause|Finish|Play) .+$/, "$1")
    .replace(/^(Focus on) .+$/, "Focus")
    .replace(/^(Open task|Open details|Complete|Reopen|Reorder|Manage due date):? .+$/, "$1");
}

/** Short-delay tooltips describe icon-only controls across routes and modal portals. */
export function installHoverTooltips(document: Document): () => void {
  let active: Element | null = null;
  let originalTitle: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tooltip: HTMLDivElement | null = null;
  function hide() {
    clearTimeout(timer);
    tooltip?.remove();
    tooltip = null;
    if (active && originalTitle !== null) active.setAttribute("title", originalTitle);
    active = null;
    originalTitle = null;
  }
  function show(event: Event) {
    if (event instanceof PointerEvent && event.pointerType === "touch") return;
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest(controlSelector);
    if (control === active) return;
    hide();
    if (!control || control.matches('input, textarea, select, [contenteditable="true"]')) return;
    // Icon fonts use private-use glyphs; standalone symbols also carry no visible action label.
    const visibleText = (control.textContent ?? "").replace(/[\p{Co}\p{S}]/gu, "").trim();
    if (visibleText) {
      control.removeAttribute("title");
      return;
    }
    const label = tooltipLabel(control, document);
    if (!label) return;
    active = control;
    originalTitle = control.getAttribute("title");
    control.removeAttribute("title");
    timer = setTimeout(() => {
      if (!control.isConnected) return hide();
      tooltip = document.createElement("div");
      tooltip.setAttribute("role", "tooltip");
      tooltip.textContent = label;
      Object.assign(tooltip.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        background: "#14221E",
        color: "#FFFFFF",
        border: "1px solid #5C6B66",
        borderRadius: "6px",
        padding: "6px 9px",
        font: "12px/18px system-ui, sans-serif",
        maxWidth: "260px",
        boxShadow: "0 3px 12px #0003",
      });
      document.body.append(tooltip);
      const rect = control.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      const width = document.defaultView?.innerWidth ?? 1024;
      const height = document.defaultView?.innerHeight ?? 768;
      tooltip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - bounds.width) / 2, width - bounds.width - 8))}px`;
      tooltip.style.top = `${rect.bottom + bounds.height + 8 < height ? rect.bottom + 6 : Math.max(8, rect.top - bounds.height - 6)}px`;
    }, 150);
  }
  function leave(event: Event) {
    if (
      event instanceof MouseEvent &&
      event.relatedTarget instanceof Node &&
      active?.contains(event.relatedTarget)
    )
      return;
    hide();
  }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape") hide();
  }
  document.addEventListener("pointerover", show, true);
  document.addEventListener("pointerout", leave, true);
  document.addEventListener("focusin", show, true);
  document.addEventListener("focusout", leave, true);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", key, true);
  return () => {
    hide();
    document.removeEventListener("pointerover", show, true);
    document.removeEventListener("pointerout", leave, true);
    document.removeEventListener("focusin", show, true);
    document.removeEventListener("focusout", leave, true);
    document.removeEventListener("pointerdown", hide, true);
    document.removeEventListener("scroll", hide, true);
    document.removeEventListener("keydown", key, true);
  };
}
