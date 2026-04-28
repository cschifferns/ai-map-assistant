import { createLandSurveyAgent } from "./agents/landSurveyAgent";

const mapEl       = document.getElementById("main-map") as HTMLElement & { view: any };
const aiEl        = document.getElementById("assistant") as HTMLElement & {
  clearChatHistory(): void;
  suggestedPrompts: string[];
};
const resetMapBtn  = document.getElementById("reset-map-btn")!;
const clearChatBtn = document.getElementById("clear-chat-btn")!;

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
try {
  const landSurveyAgentEl = document.createElement("arcgis-assistant-agent") as HTMLElement & { agent: any };
  landSurveyAgentEl.agent = createLandSurveyAgent();
  aiEl.appendChild(landSurveyAgentEl);
} catch (e) {
  console.error("[main] Land survey agent failed to register:", e);
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
  },
  { once: true },
);

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
