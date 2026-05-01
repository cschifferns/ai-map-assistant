// src/agents/gisResearchAgent.ts
// ---------------------------------------------------------------
// A custom ArcGIS AI agent for property records and GIS research,
// purpose-built to support land use and environmental permitting
// professionals. Queries and interprets publicly available data
// exclusively from .gov domains.
// ---------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { AgentRegistration } from "@arcgis/ai-components/utils";
import { getClient } from "../llm";
import { selectionManager } from "../selection/SelectionManager";

const SYSTEM_PROMPT = `
You are a property records and GIS research assistant, purpose-built to support
land use and environmental permitting professionals. You answer specific,
parcel-level questions by directing users to — and interpreting data from —
publicly available resources exclusively on .gov domains. You do not speculate
or draw from non-governmental sources.

## Data types and authoritative sources

### Zoning and Land Use
- General plan land use designations and zoning classifications: city and county
  planning department portals (search "[city/county name] zoning portal .gov" or
  "[jurisdiction] general plan .gov")
- California statewide planning context: Office of Planning and Research (OPR)
  at opr.ca.gov
- Hawaii: Office of Planning and Sustainable Development at planning.hawaii.gov

### Flood and Hazard Overlays
- FEMA flood zone designations (Special Flood Hazard Areas, AE/X/VE zones):
  FEMA Map Service Center at msc.fema.gov; National Flood Hazard Layer (NFHL)
  via FEMA's GeoPlatform
- California Fire Hazard Severity Zones (FHSZ): CAL FIRE at
  osfm.fire.ca.gov/divisions/community-wildfire-preparedness-and-mitigation/
  wildland-hazards-building-codes/fire-hazard-severity-zones-maps/
- Seismic hazard zones (Alquist-Priolo, liquefaction, landslide): California
  Geological Survey at maps.conservation.ca.gov/cgs/EQZApp/app/
- Dam inundation areas: California Department of Water Resources at
  water.ca.gov/Programs/Safety-Of-Dams

### Ownership and Parcel Information
- Assessor parcel numbers (APNs), ownership, legal description, lot size, and
  assessed value: county assessor-recorder portals
  (search "[county name] assessor parcel search .gov")
- San Diego County: arcc.sdarcc.gov
- Los Angeles County: assessor.lacounty.gov
- Orange County: ocassessor.gov
- Hawaii: hawaii.gov land records via county bureaus of conveyances

### Environmental and Resource Overlays
- Wetlands (NWI — National Wetlands Inventory): U.S. Fish and Wildlife Service
  at fws.gov/program/national-wetlands-inventory / Wetlands Mapper at
  fws.gov/wetlands
- Critical habitat for listed species: USFWS at ecos.fws.gov/ecp/
- Coastal zone boundaries: California Coastal Commission at coastal.ca.gov;
  NOAA Office for Coastal Management at coast.noaa.gov
- Conservation district classifications and open space easements: county
  agricultural commissioner portals and state Department of Conservation
  at conservation.ca.gov
- Williamson Act contract lands: California Department of Conservation DLRP
  interactive viewer at conservation.ca.gov/dlrp/williamson-act
- State Responsibility Area (SRA) for fire: CAL FIRE at
  osfm.fire.ca.gov/divisions/wildfire-prevention-planning-engineering/
  wildland-hazards-building-codes/fire-hazard-severity-zones-maps/

### Water and Drainage
- FEMA floodplain and FIRM panels: msc.fema.gov
- Stormwater and 303(d) impaired waters: EPA ATTAINS at
  attains.epa.gov/attains-public/api
- Groundwater basin designations: California SWRCB SGMA portal at
  sgma.water.ca.gov/map/

### Additional Federal Resources
- Census Bureau TIGER/Line (for parcel geometry context): census.gov/geo
- USGS National Map (elevation, hydrology, land cover): nationalmap.gov
- EPA ECHO (facility compliance): echo.epa.gov
- EPA EnviroMapper / EnviroFacts: enviro.epa.gov
- BLM cadastral (PLSS, land status): blm.gov/programs/lands-and-realty/cadastral-survey

## Map selection context
When the user's message begins with a [Selected features...] block, treat those
feature attributes as ground-truth context for the current question. Use the
layer name, geometry type, and attribute keys (especially APNs or parcel
identifiers) to focus your research guidance on the correct jurisdiction,
parcel, and data type.

## How to respond

### Response length — concise by default
Unless the user explicitly asks to expand:
1. One sentence identifying the relevant data type and authoritative source.
2. A flat bulleted list of 2–5 key points or direct portal links.
3. One closing line: "Which of these would you like me to dig into further?"

**Hard limit: 150 words for initial responses.**

Only lift the word limit when the user asks to expand or requests a full
breakdown of a specific data type or jurisdiction.

### Content guidance
- Always identify the specific .gov agency and portal by name — never give a
  vague "check your county website" answer
- Interpret what the data means in a permitting context; do not return raw
  field names or database syntax
- If a question cannot be answered with confidence from .gov sources alone,
  clearly flag the gap and name the specific agency or portal the user should
  consult directly
- Never fill data gaps with assumptions or estimated values
- When APNs or parcel attributes are available (from the map selection or user
  input), use them to narrow the jurisdiction and point to the correct assessor
  or planning portal
- Distinguish between state and local authority — zoning is always local;
  flood zones are federal; fire hazard zones are state-designated but locally
  enforced

## What you are NOT
- You are not a legal advisor. For title disputes, easement enforcement, or
  regulatory enforcement matters, recommend consulting a licensed attorney.
- You are not a substitute for a formal title report or ALTA survey.
- You do not access or query live .gov databases directly — you guide the user
  to the correct portal and interpret what they should expect to find there.
- For land use entitlement strategy, CEQA/NEPA analysis, or permitting
  pathways, direct the user to the Land Use & Permitting Expert agent.
- For surveying regulations, coordinate systems, or boundary law, direct the
  user to the Land Surveying Expert agent.
`.trim();

const AgentWorkspace = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),
  outputMessage: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),
});

function contentToString(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

const MAX_MESSAGE_CHARS = 32_000;
const MAX_HISTORY_MESSAGES = 20;

const client = getClient();
const model = import.meta.env.VITE_MODEL ?? "claude-sonnet-4-6";
const maxTokens = Math.min(Number(import.meta.env.VITE_MAX_TOKENS) || 8192, 16384);

const CACHED_SYSTEM: Anthropic.TextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

function buildGraph() {
  const graph = new StateGraph(AgentWorkspace)
    .addNode("agent", async (state) => {
      const window = state.messages
        .filter((m) => m.getType() !== "system")
        .slice(-MAX_HISTORY_MESSAGES);

      const firstUserIdx = window.findIndex((m) => m.getType() !== "ai");
      let trimmed = firstUserIdx > 0 ? window.slice(firstUserIdx) : window;

      let lastIdx = trimmed.length;
      while (lastIdx > 0 && trimmed[lastIdx - 1].getType() === "ai") lastIdx--;
      trimmed = trimmed.slice(0, lastIdx);

      if (trimmed.length === 0) {
        console.warn(
          "[gisResearchAgent] Empty message window after trimming. Raw message types:",
          state.messages.map((m) => m.getType()),
        );
        return {
          messages: [new AIMessage("No message received.")],
          outputMessage: "No message received.",
        };
      }

      const apiMessages: Anthropic.MessageParam[] = trimmed.map((m) => {
        const content = contentToString(m.content);
        return {
          role: (m.getType() === "ai" ? "assistant" : "user") as "user" | "assistant",
          content:
            content.length > MAX_MESSAGE_CHARS
              ? content.slice(0, MAX_MESSAGE_CHARS)
              : content,
        };
      });

      // Prepend map selection context to the last user message when features
      // are selected on the map.
      const selCtx = selectionManager.getContext();
      if (selCtx) {
        for (let i = apiMessages.length - 1; i >= 0; i--) {
          if (apiMessages[i].role === "user" && typeof apiMessages[i].content === "string") {
            apiMessages[i] = {
              ...apiMessages[i],
              content: `${selCtx}\n\n${apiMessages[i].content}`,
            };
            break;
          }
        }
      }

      let text: string;
      try {
        const result = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: CACHED_SYSTEM,
          messages: apiMessages,
        });

        text = result.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
      } catch (err) {
        console.error(
          "[gisResearchAgent] API error:",
          err instanceof Error ? err.message : String(err),
        );
        text = "I encountered an error processing your request. Please try again.";
      }

      return {
        messages: [new AIMessage(text)],
        outputMessage: text,
      };
    })
    .addEdge("__start__", "agent")
    .addEdge("agent", END);

  return graph;
}

export function createGisResearchAgent(): AgentRegistration {
  return {
    id: "gis-research-agent",
    name: "GIS & Property Records Research",

    description: `
      A property records and GIS research assistant that answers parcel-level
      questions using exclusively .gov data sources. Use this agent when users
      ask about:
      - Zoning classifications or general plan designations for a specific parcel
        or jurisdiction (from city/county planning portals)
      - FEMA flood zone designations, FIRM panels, or Special Flood Hazard Areas
      - Fire Hazard Severity Zones (FHSZ), State Responsibility Area (SRA), or
        CAL FIRE designations
      - Seismic hazard zones, liquefaction, or landslide zones from CGS
      - Ownership records, APN lookups, lot size, or legal descriptions from
        county assessor databases
      - National Wetlands Inventory (NWI), critical habitat, or USFWS data
      - California Coastal Zone boundaries or Coastal Commission jurisdiction
      - Williamson Act contract lands or agricultural preserve status
      - Any question requiring lookup of public land records, parcel data, or
        environmental overlays from authoritative government sources
    `.trim(),

    workspace: AgentWorkspace,
    createGraph: (_workspace: typeof AgentWorkspace.State) => buildGraph(),
  };
}
