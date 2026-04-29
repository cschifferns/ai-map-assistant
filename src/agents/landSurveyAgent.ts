// src/agents/landSurveyAgent.ts
// ---------------------------------------------------------------
// A custom ArcGIS AI agent specializing in land surveying for
// California and Hawaii. Provides expert guidance on:
//   - State-specific surveying statutes and regulations
//   - Licensing and professional standards (PLS)
//   - Coordinate systems, datums, and projections used in each state
//   - Boundary law, monuments, and record of survey requirements
//   - Public Land Survey System (PLSS) and metes & bounds
//   - Tidal and coastal boundary considerations (especially HI)
// ---------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { AgentRegistration } from "@arcgis/ai-components/utils";
import { getClient } from "../llm";

// ---------------------------------------------------------------
// System prompt — this is where the domain expertise lives.
// Edit this to reflect your organization's specific focus areas,
// project types, or any additional context you want the agent
// to carry into every conversation.
// ---------------------------------------------------------------
const SYSTEM_PROMPT = `
You are an expert land surveying assistant with deep knowledge of surveying
practice, law, and standards in California and Hawaii. You assist licensed
surveyors, GIS professionals, and project teams with technical questions.

## Your areas of expertise

### California
- Business and Professions Code §8700–8805 (Land Surveyor's Act)
- Professional Land Surveyor (PLS) licensing requirements (BPELSG)
- Record of Survey requirements: when required, filing with county surveyor
- Corner records and corner perpetuation (PRC §8772)
- California Coordinate System (CCS83) — zones: Zone 1 (Humboldt) through Zone 6 (Los Angeles)
- NAD83 (2011) epoch 2010.0 as the current horizontal datum
- NAVD88 vertical datum; awareness of ongoing transition to NAPGD2025/GEOID models
- PLSS in California: township/range/section, BLM cadastral surveys
- Metes and bounds descriptions in older Spanish/Mexican land grants (Ranchos)
- Williamson Act, Subdivision Map Act implications for surveys
- Lot line adjustments vs. parcel maps vs. tract maps
- Tidal boundaries: mean high water (MHW), ordinary high water mark (OHWM)

### Hawaii
- Hawaii Revised Statutes Chapter 464 (land surveyors)
- Hawaii Board of Professional Engineers, Architects, Surveyors, and Landscape
  Architects (PEALS) licensing
- Hawaii State Plane Coordinate System (HSPCS) — five zones (HI-1 through HI-5),
  one per main island: Hawaii, Maui, Oahu, Kauai, Niihau
- NAD83 (PA11) — Hawaii uses the Pacific plate realization, not the continental US
  NAD83(2011). This is a critical distinction.
- NAVD88 is NOT used in Hawaii — GUVD04 (Guam) is similarly separate;
  Hawaii uses local tidal datums and NAVD88 is being replaced by NAPGD2025
- Land Court system (Torrens title) vs. Regular System — Hawaii has both;
  Land Court surveys require strict adherence to Land Court rules
- Ahupuaa, konohiki rights, and traditional Hawaiian land division concepts
- Kuleana land issues and small parcel surveys
- Shoreline certification process (DLNR/OP): certified shoreline vs. official shoreline
  — this is Hawaii-specific and heavily regulated
- Volcanic land additions: lava extension surveys, State land ownership of new land
- PLSS does not apply in Hawaii — all surveys are metes and bounds

### General surveying knowledge
- ALTA/NSPS Land Title Surveys (2021 standards)
- Boundary retracement principles: original monuments control over calls
- GPS/GNSS survey methods: static, RTK, network RTK (e.g. CRTN in CA)
- LiDAR, photogrammetry, and UAS-derived data in surveying context
- Easements: appurtenant vs. in gross, prescriptive, implied
- Riparian and littoral boundaries
- Adverse possession and acquiescence
- Surveying equipment: total station, GNSS receivers, levels
- Error propagation, closure, and least squares adjustment

## How to respond
- Be precise and cite specific statutes, code sections, or standards when relevant
- If a question is state-specific, clarify which state's rules apply
- If asked about a topic outside CA or HI, answer generally but note the limitation
- Do not provide legal advice — recommend consulting a licensed attorney for
  legal boundary disputes or title issues
- When discussing coordinate systems or datums, be explicit about which
  realization and epoch is being referenced — this matters in practice
- If you are uncertain, say so clearly rather than guessing

## What you are NOT
- You are not a general-purpose map assistant. For questions about map layers,
  feature data, or GIS analysis unrelated to surveying, direct the user to ask
  the map assistant instead.
`.trim();

// ---------------------------------------------------------------
// Agent Workspace
// outputMessage is the channel the arcgis-assistant reads to render
// the agent's reply. messages carries the full conversation history.
// ---------------------------------------------------------------
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

// Resolve message content to a plain string regardless of whether
// it is a simple string or a complex content block array.
function contentToString(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

// Maximum number of characters allowed in a single user message.
// Prevents accidental (or deliberate) giant inputs from running up API costs.
const MAX_MESSAGE_CHARS = 8_000;

// Keep only the most recent N messages to prevent the request body from
// growing unboundedly across a long conversation. Pairs are preserved by
// using an even number so the history doesn't end on an assistant turn.
const MAX_HISTORY_MESSAGES = 20;

// Module-level singletons — safe to reuse across calls since the Anthropic
// client holds no session or conversation state.
const client = getClient();
const model = import.meta.env.VITE_MODEL ?? "claude-sonnet-4-6";
// Cap at 8192 to bound costs even if VITE_MAX_TOKENS is misconfigured.
const maxTokens = Math.min(Number(import.meta.env.VITE_MAX_TOKENS) || 4096, 8192);

// Wrap the system prompt as a cacheable content block so Anthropic can skip
// re-processing its ~1,800 tokens on every turn after the first.
// Cache TTL is 5 minutes (ephemeral). Stateless: the full prompt is still
// sent with every request — Anthropic just skips re-processing the cached part.
const CACHED_SYSTEM: Anthropic.TextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

// ---------------------------------------------------------------
// Build graph — returns a minimal StateGraph-compatible object
// that bypasses LangGraph's browser incompatibilities while
// satisfying the interface arcgis-assistant expects.
// ---------------------------------------------------------------
function buildGraph() {
  const graph = new StateGraph(AgentWorkspace)
    .addNode("agent", async (state) => {
      const window = state.messages
        .filter((m) => m.getType() !== "system")
        .slice(-MAX_HISTORY_MESSAGES);

      // The Anthropic API requires the first message to be from the user.
      // If the slice boundary lands on an AI turn, advance to the next user message.
      const firstUserIdx = window.findIndex((m) => m.getType() !== "ai");
      const trimmed = firstUserIdx > 0 ? window.slice(firstUserIdx) : window;

      if (trimmed.length === 0) {
        return { messages: [new AIMessage("No message received.")], outputMessage: "No message received." };
      }

      const apiMessages = trimmed.map((m) => {
          const content = contentToString(m.content);
          return {
            role: (m.getType() === "ai" ? "assistant" : "user") as "user" | "assistant",
            // Truncate oversized messages rather than forwarding them as-is.
            content: content.length > MAX_MESSAGE_CHARS
              ? content.slice(0, MAX_MESSAGE_CHARS) + "\n\n[message truncated]"
              : content,
          };
        });

      let text: string;
      try {
        const result = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: CACHED_SYSTEM,
          messages: apiMessages,
        });

        text = result.content
          .filter((b) => b.type === "text")
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
      } catch (err) {
        // Log a summary only — never log the full error object in case it
        // contains API response bodies with key/quota details.
        console.error("[landSurveyAgent] API error:", err instanceof Error ? err.message : String(err));
        text = "I encountered an error processing your request. Please try again.";
      }

      return {
        messages: [new AIMessage(text)],
        outputMessage: text,   // arcgis-assistant reads this to render the reply
      };
    })
    .addEdge("__start__", "agent")
    .addEdge("agent", END);

  return graph; // arcgis-assistant calls .compile() itself
}

// ---------------------------------------------------------------
// Export the AgentRegistration object
// ---------------------------------------------------------------
export function createLandSurveyAgent(): AgentRegistration {
  return {
    id: "land-survey-agent",
    name: "Land Surveying Expert",

    // This description is used by the arcgis-assistant orchestrator
    // to decide which agent should handle a given user message.
    // Be specific — list the kinds of questions that should trigger
    // this agent so the orchestrator routes correctly.
    description: `
      A land surveying expert for California and Hawaii. Use this agent when
      users ask about:
      - Surveying regulations, statutes, or licensing in California or Hawaii
      - Record of Survey requirements, corner records, or monument perpetuation
      - California Coordinate System (CCS83) zones or Hawaii State Plane zones
      - NAD83 datums — especially the distinction between NAD83(2011) in CA
        and NAD83(PA11) in Hawaii
      - PLSS, township/range/section, or metes and bounds descriptions
      - ALTA/NSPS survey standards or requirements
      - Hawaii Land Court surveys, shoreline certification, or kuleana lands
      - Boundary law, easements, riparian boundaries, or adverse possession
      - GPS/GNSS survey methods, network RTK, or CRTN in California
      - UAS/drone surveys in a land surveying context
      - Any technical surveying question related to California or Hawaii practice
    `.trim(),

    workspace: AgentWorkspace,
    createGraph: (_workspace: typeof AgentWorkspace.State) => buildGraph(),
  };
}
