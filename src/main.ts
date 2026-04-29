import { createLandSurveyAgent } from "./agents/landSurveyAgent";
import { createLandUsePermittingAgent } from "./agents/landUsePermittingAgent";

const mapEl            = document.getElementById("main-map") as HTMLElement & { view: any };
const aiEl             = document.getElementById("assistant") as HTMLElement & {
  clearChatHistory(): void;
  suggestedPrompts: string[];
};
const resetMapBtn      = document.getElementById("reset-map-btn")!;
const clearChatBtn     = document.getElementById("clear-chat-btn")!;
const featureTableEl    = document.getElementById("feature-table") as HTMLElement & { layer: any };
const featureTablePanel = document.getElementById("feature-table-panel") as HTMLElement;
const layerPickerEl     = document.getElementById("layer-picker") as HTMLElement & { value: string };
const collapseTableBtn  = document.getElementById("collapse-table-btn") as HTMLElement & { icon: string; text: string };
const selectRectBtn    = document.getElementById("select-rect-btn")!;
const clearSelBtn      = document.getElementById("clear-sel-btn")!;
let tableExpanded = false;
let clearSelection: () => void = () => {};

// ── Auth ──────────────────────────────────────────────────────────────────────
// Register OAuth before setting item-id so IdentityManager routes through
// SSO instead of showing a username/password dialog.
const [OAuthInfo, esriId, SketchViewModel, GraphicsLayer] = await $arcgis.import([
  "@arcgis/core/identity/OAuthInfo.js",
  "@arcgis/core/identity/IdentityManager.js",
  "@arcgis/core/widgets/Sketch/SketchViewModel.js",
  "@arcgis/core/layers/GraphicsLayer.js",
]);

esriId.registerOAuthInfos([
  new OAuthInfo({
    appId: "e9nz1rqxUWu4cytG",
    portalUrl: "https://dudek.maps.arcgis.com",
    popup: false,
  }),
]);

mapEl.setAttribute("item-id", "05e9895fc2b1441f992c28af7547d150");

// ── Custom agent registration ─────────────────────────────────────────────────
// Wrapped in try-catch so a LangGraph/polyfill failure in the production build
// doesn't prevent the map and built-in agents from loading.
const customAgents: { factory: () => any; label: string }[] = [
  { factory: createLandSurveyAgent,                          label: "Land survey" },
  { factory: () => createLandUsePermittingAgent(mapEl),      label: "Land use & permitting" },
];

for (const { factory, label } of customAgents) {
  try {
    const agentEl = document.createElement("arcgis-assistant-agent") as HTMLElement & { agent: any };
    agentEl.agent = factory();
    aiEl.appendChild(agentEl);
  } catch (e) {
    console.error(`[main] ${label} agent failed to register:`, e);

    const notice = document.createElement("calcite-notice") as HTMLElement;
    notice.setAttribute("kind", "warning");
    notice.setAttribute("open", "");
    notice.setAttribute("scale", "s");
    (notice as HTMLElement & { style: CSSStyleDeclaration }).style.margin = "8px";
    const msgEl = document.createElement("div");
    msgEl.setAttribute("slot", "message");
    msgEl.textContent = `${label} agent failed to load — built-in map agents are still available.`;
    notice.appendChild(msgEl);
    aiEl.insertAdjacentElement("beforebegin", notice);
  }
}

// ── Layer snapshot ────────────────────────────────────────────────────────────
const layerSnapshots = new Map<string, { definitionExpression: string; visible: boolean }>();

mapEl.addEventListener(
  "arcgisViewReadyChange",
  () => {
    const view = mapEl.view;

    // Snapshot original layer state for the reset button.
    view.map.allLayers.forEach((layer: any) => {
      layerSnapshots.set(layer.id, {
        definitionExpression: layer.definitionExpression ?? "",
        visible: layer.visible,
      });
    });

    aiEl.suggestedPrompts = [
      "What layers are in this map?",
      "Zoom to the largest feature.",
      "Summarize the data visible in the current extent.",
    ];

    // Populate the layer picker with all feature layers and connect the table.
    const featureLayers: any[] = view.map.allLayers.filter((l: any) => l.type === "feature").toArray();
    featureLayers.forEach((layer) => {
      const option = document.createElement("calcite-option") as HTMLElement & { value: string };
      option.value = layer.id;
      option.textContent = layer.title;
      layerPickerEl.appendChild(option);
    });

    if (featureLayers.length > 0) {
      featureTableEl.layer = featureLayers[0];
      featureTablePanel.style.display = "flex";
      tableExpanded = true;
    }

    layerPickerEl.addEventListener("calciteSelectChange", () => {
      const selected = featureLayers.find((l) => l.id === layerPickerEl.value);
      if (selected) featureTableEl.layer = selected;
    });

    // ── Rectangle selection ───────────────────────────────────────────────
    const sketchLayer = new GraphicsLayer({ listMode: "hide" });
    view.map.add(sketchLayer);
    const sketchVM = new SketchViewModel({ layer: sketchLayer, view });

    const highlights: any[] = [];

    clearSelection = () => {
      if (sketchVM.state === "active") sketchVM.cancel();
      highlights.forEach((h: any) => h.remove());
      highlights.length = 0;
      sketchLayer.removeAll();
      clearSelBtn.setAttribute("disabled", "");
    };

    sketchVM.on("create", async (event: any) => {
      if (event.state !== "complete") return;
      const geometry = event.graphic.geometry;
      sketchLayer.removeAll();
      highlights.forEach((h: any) => h.remove());
      highlights.length = 0;
      clearSelBtn.setAttribute("disabled", "");

      let didSelect = false;
      const layers: any[] = view.map.allLayers
        .filter((l: any) => l.type === "feature" && l.visible)
        .toArray();

      for (const layer of layers) {
        try {
          const q = layer.createQuery();
          q.geometry = geometry;
          q.spatialRelationship = "intersects";
          const oids = await layer.queryObjectIds(q);
          if (oids.length === 0) continue;
          const lv = await view.whenLayerView(layer);
          highlights.push(lv.highlight(oids));
          didSelect = true;
        } catch { /* layer doesn't support spatial queries */ }
      }

      if (didSelect) clearSelBtn.removeAttribute("disabled");
    });

    selectRectBtn.addEventListener("click", () => {
      if (sketchVM.state === "active") sketchVM.cancel();
      sketchVM.create("rectangle");
    });

    clearSelBtn.addEventListener("click", () => clearSelection());
  },
  { once: true },
);

// ── Feature table collapse toggle ─────────────────────────────────────────────
collapseTableBtn.addEventListener("click", () => {
  tableExpanded = !tableExpanded;
  featureTablePanel.style.height = tableExpanded ? "260px" : "42px";
  collapseTableBtn.icon = tableExpanded ? "chevron-down" : "chevron-up";
  collapseTableBtn.text = tableExpanded ? "Collapse" : "Expand";
});

// ── Reset map button ──────────────────────────────────────────────────────────
resetMapBtn.addEventListener("click", async () => {
  const view = mapEl.view;
  if (!view) return;
  clearSelection();

  const lvPromises: Promise<void>[] = [];

  view.map.allLayers.forEach((layer: any) => {
    const snap = layerSnapshots.get(layer.id);
    if (snap) {
      layer.visible = snap.visible;
      if ("definitionExpression" in layer) layer.definitionExpression = snap.definitionExpression;
    }

    if (layer.type === "feature") {
      lvPromises.push(
        view
          .whenLayerView(layer)
          .then((lv: any) => {
            if ("filter" in lv) lv.filter = null;
            if ("featureEffect" in lv) lv.featureEffect = null;
          })
          .catch(() => {}),
      );
    }
  });

  await Promise.all(lvPromises);
  aiEl.clearChatHistory();
});

// ── Clear chat button ─────────────────────────────────────────────────────────
clearChatBtn.addEventListener("click", () => aiEl.clearChatHistory());
