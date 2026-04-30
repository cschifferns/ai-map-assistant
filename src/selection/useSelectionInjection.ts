// src/selection/useSelectionInjection.ts
// ---------------------------------------------------------------
// Wires browser-side selection events to the SelectionManager and
// keeps the status banner in sync. Vanilla TS — no framework.
//
// Selection context is NOT injected here at the DOM level; it is
// prepended to API messages inside each agent's graph node, which
// has direct access to the serialized conversation window.
// ---------------------------------------------------------------

import { selectionManager, type EsriGraphic } from "./SelectionManager";

export interface SelectionInjectionParams {
  view: any;
  featureTableEl: HTMLElement;
  bannerEl: HTMLElement;
  bannerTextEl: HTMLElement;
  clearBannerBtn: HTMLElement;
  /** Returns true while the sketch/rectangle-draw tool is active. */
  isSketchActive: () => boolean;
}

export function initSelectionInjection({
  view,
  featureTableEl,
  bannerEl,
  bannerTextEl,
  clearBannerBtn,
  isSketchActive,
}: SelectionInjectionParams): void {
  // ── Map click → hit-test → select ──────────────────────────────
  // Single-click on any visible feature layer selects those graphics
  // and makes them available as agent context.
  // Skipped while the rectangle-draw tool is active so sketch clicks
  // don't accidentally overwrite the selection mid-draw.
  view.on("click", async (event: any) => {
    if (isSketchActive()) return;

    const featureLayers: any[] = view.map.allLayers
      .filter((l: any) => l.type === "feature" && l.visible)
      .toArray();
    if (featureLayers.length === 0) return;

    const hitResult = await view.hitTest(event, { include: featureLayers });
    const graphics: EsriGraphic[] = hitResult.results
      .filter((r: any) => r.graphic?.layer?.type === "feature")
      .map((r: any) => r.graphic as EsriGraphic);

    if (graphics.length > 0) {
      selectionManager.setSelection(graphics);
    }
  });

  // ── Feature table selection change → select ─────────────────────
  // The arcgis-feature-table web component fires this event when the
  // user checks rows. The detail shape may vary by SDK version;
  // we defensively handle both Graphic[] and ObjectID-set forms.
  featureTableEl.addEventListener(
    "arcgisFeatureTableSelectionChange",
    (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { features?: EsriGraphic[]; items?: EsriGraphic[] }
        | undefined;

      const graphics: EsriGraphic[] =
        detail?.features ?? detail?.items ?? [];

      if (graphics.length > 0) {
        selectionManager.setSelection(graphics);
      } else {
        selectionManager.clearSelection();
      }
    },
  );

  // ── Banner updates ──────────────────────────────────────────────
  function updateBanner(): void {
    if (selectionManager.hasSelection()) {
      bannerTextEl.textContent =
        selectionManager.layerSummary() + " · Using as context";
      bannerEl.style.display = "flex";
    } else {
      bannerEl.style.display = "none";
    }
  }

  selectionManager.onChange(updateBanner);
  clearBannerBtn.addEventListener("click", () => selectionManager.clearSelection());
  updateBanner(); // Sync initial state
}
