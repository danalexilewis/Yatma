import { useEffect } from "react";

import { installHoverTooltips } from "./installHoverTooltips";

/** Covers browser controls across routes and modal portals without extra wrappers. */
export function HoverTooltips() {
  useEffect(() => installHoverTooltips(document), []);
  return null;
}
