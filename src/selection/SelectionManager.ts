// src/selection/SelectionManager.ts
// ---------------------------------------------------------------
// Layer-agnostic singleton that tracks the user's current map
// selection and serializes it as a context block for agent prompts.
// ---------------------------------------------------------------

// Minimal interface for ArcGIS Graphic (runtime objects come from the
// CDN, not from npm — full __esri types are not available at build time).
export interface EsriGraphic {
  attributes: Record<string, unknown>;
  geometry?: { type: string };
  layer?: { title?: string };
  sourceLayer?: { title?: string };
}

// Fields that carry no domain value — strip them from serialized output.
const NOISE_FIELD_RE =
  /^(objectid|globalid|shape__|creationdate|creator|editdate|editor)/i;

interface LayerGroup {
  layerTitle: string;
  geometryType: string;
  features: Record<string, unknown>[];
}

export class SelectionManager {
  private static _instance: SelectionManager;
  private _graphics: EsriGraphic[] = [];
  private _callbacks: Array<() => void> = [];

  private constructor() {}

  static getInstance(): SelectionManager {
    if (!SelectionManager._instance) {
      SelectionManager._instance = new SelectionManager();
    }
    return SelectionManager._instance;
  }

  setSelection(graphics: EsriGraphic[]): void {
    this._graphics = graphics;
    this._notifyChange();
  }

  clearSelection(): void {
    this._graphics = [];
    this._notifyChange();
  }

  hasSelection(): boolean {
    return this._graphics.length > 0;
  }

  getCount(): number {
    return this._graphics.length;
  }

  // Register a callback that fires whenever the selection changes.
  onChange(cb: () => void): void {
    this._callbacks.push(cb);
  }

  // One-line human-readable summary, used by the UI status banner.
  layerSummary(): string {
    if (this._graphics.length === 0) return "";

    const counts = new Map<string, number>();
    for (const g of this._graphics) {
      const title = g.layer?.title ?? g.sourceLayer?.title ?? "Unknown Layer";
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }

    const n = this._graphics.length;
    const plural = n !== 1 ? "s" : "";

    if (counts.size === 1) {
      const [title] = counts.keys();
      return `${n} feature${plural} selected from "${title}"`;
    }
    return `${n} feature${plural} selected from ${counts.size} layers`;
  }

  // Serialized context block prepended to agent messages when a
  // selection exists. Groups features by layer; filters noise fields.
  getContext(): string {
    if (this._graphics.length === 0) return "";

    const groups = new Map<string, LayerGroup>();

    for (const g of this._graphics) {
      const layerTitle =
        g.layer?.title ?? g.sourceLayer?.title ?? "Unknown Layer";
      const geometryType = g.geometry?.type ?? "unknown";

      if (!groups.has(layerTitle)) {
        groups.set(layerTitle, { layerTitle, geometryType, features: [] });
      }

      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(g.attributes ?? {})) {
        if (!NOISE_FIELD_RE.test(k) && v !== null && v !== undefined && v !== "") {
          clean[k] = v;
        }
      }
      groups.get(layerTitle)!.features.push(clean);
    }

    const sections = [...groups.values()].map(
      ({ layerTitle, geometryType, features }) => {
        const rows = features
          .map((attrs) =>
            Object.entries(attrs)
              .map(([k, v]) => `  ${k}: ${v}`)
              .join("\n"),
          )
          .join("\n---\n");
        return `Layer: ${layerTitle} (${geometryType})\n${rows}`;
      },
    );

    return [
      "[The user has selected the following features on the map. Use these as context for your answer if relevant:]",
      sections.join("\n\n"),
      "[End of selected features]",
    ].join("\n");
  }

  private _notifyChange(): void {
    this._callbacks.forEach((cb) => cb());
  }
}

// Module-level singleton — import this directly wherever needed.
export const selectionManager = SelectionManager.getInstance();
