import { createLandSurveyAgent } from "./agents/landSurveyAgent";
import { createLandUsePermittingAgent } from "./agents/landUsePermittingAgent";

const mapEl            = document.getElementById("main-map") as HTMLElement & { view: any };
const aiEl             = document.getElementById("assistant") as HTMLElement & {
  clearChatHistory(): void;
  suggestedPrompts: string[];
};
const resetMapBtn      = document.getElementById("reset-map-btn")!;
const clearChatBtn     = document.getElementById("clear-chat-btn")!;
const featureTableEl   = document.getElementById("feature-table") as HTMLElement & { layer: any };
const featureTablePanel = document.getElementById("feature-table-panel") as HTMLElement & { collapsed: boolean };
const featureTableHeader = document.getElementById("feature-table-header") as HTMLElement & { heading: string };
const collapseTableBtn = document.getElementById("collapse-table-btn") as HTMLElement & { icon: string; text: string };

// ── Auth ──────────────────────────────────────────────────────────────────────
// Register OAuth before setting item-id so IdentityManager routes through
// SSO instead of showing a username/password dialog.
const [OAuthInfo, esriId] = await $arcgis.import([
  "@arcgis/core/identity/OAuthInfo.js",
  "@arcgis/core/identity/IdentityManager.js",
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
  { factory: createLandSurveyAgent,         label: "Land survey" },
  { factory: createLandUsePermittingAgent,  label: "Land use & permitting" },
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

    // Connect the feature table to the first feature layer in the map.
    const firstFeatureLayer = view.map.allLayers.find((l: any) => l.type === "feature");
    if (firstFeatureLayer) {
      featureTableEl.layer = firstFeatureLayer;
      featureTableHeader.heading = `Feature Table — ${firstFeatureLayer.title}`;
      featureTablePanel.collapsed = false;
    }
  },
  { once: true },
);

// ── Feature table collapse toggle ─────────────────────────────────────────────
collapseTableBtn.addEventListener("click", () => {
  const isCollapsed = featureTablePanel.collapsed;
  featureTablePanel.collapsed = !isCollapsed;
  collapseTableBtn.icon = isCollapsed ? "chevron-down" : "chevron-up";
  collapseTableBtn.text = isCollapsed ? "Collapse" : "Expand";
});

// ── Reset map button ──────────────────────────────────────────────────────────
resetMapBtn.addEventListener("click", async () => {
  const view = mapEl.view;
  if (!view) return;

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
