// Global $arcgis provided by the ArcGIS Maps SDK CDN script.
declare const $arcgis: {
  import(modules: string[]): Promise<any[]>;
  import(module: string): Promise<any>;
};

// Type stubs for ArcGIS packages referenced via "import type".
// These are erased at build time — only TypeScript needs them.
// The actual runtime objects come from the CDN.

declare module "@arcgis/core/views/MapView" {
  class MapView {
    map: {
      allLayers: { forEach(cb: (layer: any) => void): void };
    };
    whenLayerView(layer: any): Promise<any>;
    [key: string]: any;
  }
  export default MapView;
}

declare module "@arcgis/ai-components/utils" {
  export interface AgentRegistration {
    id: string;
    name: string;
    description: string;
    workspace: any;
    createGraph: (workspace: any) => any;
    initialState?: Record<string, any>;
  }
}
