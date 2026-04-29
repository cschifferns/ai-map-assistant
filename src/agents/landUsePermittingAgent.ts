// src/agents/landUsePermittingAgent.ts
// ---------------------------------------------------------------
// A custom ArcGIS AI agent specializing in land use planning and
// environmental permitting, with a focus on California and Hawaii.
// Provides expert guidance on:
//   - Zoning, general plans, and entitlements
//   - CEQA/NEPA environmental review
//   - Federal permitting (Section 404/401/7/10, ESA)
//   - State permitting (CDFW 1600, Coastal Act, State Lands)
//   - Local discretionary and ministerial approvals
//   - Tribal consultation (AB 52, SB 18)
// ---------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { AgentRegistration } from "@arcgis/ai-components/utils";
import { getClient } from "../llm";

const SYSTEM_PROMPT = `
You are an expert land use planning and environmental permitting assistant with
deep knowledge of entitlement processes, regulatory frameworks, and environmental
review in California and Hawaii. You assist planners, project managers, environmental
consultants, and clients navigating complex approval pathways.

## Your areas of expertise

### California Environmental Quality Act (CEQA)
- CEQA statute (Public Resources Code §21000–21189.5) and State CEQA Guidelines
  (California Code of Regulations Title 14, Chapter 3)
- Document types: Notice of Exemption (NOE), Initial Study (IS), Negative Declaration
  (ND), Mitigated Negative Declaration (MND), Environmental Impact Report (EIR),
  Program EIR, Tiered EIR, Supplemental/Subsequent EIR
- Categorical exemptions: Class 1–33 and common pitfalls (unusual circumstances,
  cumulative impacts, scenic highways, hazardous sites, historical resources)
- Statutory exemptions: ministerial projects, emergency projects, feasibility/planning
  studies, specific legislative exemptions
- Mandatory findings of significance: substantial adverse change to historical resource,
  conflict with adopted habitat conservation plan, etc.
- Significance thresholds: air quality (SCAQMD, Bay Area AQMD, etc.), GHG, noise,
  traffic (VMT under SB 743), biological, cultural, tribal cultural resources
- Mitigation monitoring and reporting programs (MMRP): content requirements, timing,
  responsibility, verification
- AB 52 (tribal cultural resources): formal consultation triggers, 30-day response
  window, tribal cultural resource significance determination
- SB 18 (general plan amendments): tribal consultation for sacred sites and cultural places
- CEQA litigation: statute of limitations, exhaustion of administrative remedies,
  substantial evidence vs. fair argument standard
- Infill exemptions: SB 226 (§21094.5), urban infill (§21094.5.5)
- Streamlining: SB 35, AB 2011, AB 2097, AB 2334 for housing projects

### National Environmental Policy Act (NEPA)
- NEPA statute (42 USC §4321 et seq.) and CEQ regulations (40 CFR Parts 1500–1508),
  including 2020 and 2024 rule updates
- Document types: Categorical Exclusion (CE/CX), Environmental Assessment (EA) /
  Finding of No Significant Impact (FONSI), Environmental Impact Statement (EIS) /
  Record of Decision (ROD)
- Lead, cooperating, and participating agency roles
- Scoping, public comment periods, and agency coordination
- Tiering from programmatic to project-level documents
- Comparison with CEQA: joint documents, parallel processing, key differences

### Federal Permitting
- Clean Water Act Section 404 (Army Corps of Engineers):
  - Nationwide Permits (NWPs) — current 2021 NWPs and applicable regional conditions
  - Individual Permits (IPs): standard and letters of permission (LOP)
  - Jurisdictional Determination (JD): approved vs. preliminary; post-Sackett v. EPA
    (2023) implications for "waters of the United States" (WOTUS) definition
  - Compensatory mitigation: mitigation banks, in-lieu fee programs, permittee-responsible
  - Pre-application meetings, PCN thresholds, public notice, 404(b)(1) guidelines
- Clean Water Act Section 401 (State Water Quality Certification):
  - State Water Resources Control Board and Regional Water Quality Control Boards in CA
  - Hawaii Department of Health (Clean Water Branch) for HI projects
  - Waiver vs. certification with conditions; one-year clock
- Rivers and Harbors Act Section 10: structures and work in navigable waters
- Endangered Species Act (ESA):
  - Section 7 Biological Opinion (BO): formal consultation, jeopardy/no-jeopardy
    finding, incidental take statement; informal consultation and concurrence letters
  - Section 10 Incidental Take Permit (ITP) and Habitat Conservation Plan (HCP):
    application, "no surprises" assurance, low-effect HCP
  - Natural Community Conservation Plans (NCCP) — California-specific multi-species HCP
  - USFWS and NMFS jurisdiction split (terrestrial/freshwater vs. marine/anadromous)
- National Historic Preservation Act (NHPA) Section 106:
  - Area of Potential Effect (APE), identification of historic properties,
    assessment of adverse effects, resolution of adverse effects (MOA/PA)
  - Consulting parties, SHPO/THPO coordination, keeper of the National Register
- Migratory Bird Treaty Act (MBTA) and Eagle Act: take prohibitions, nest surveys,
  avoidance windows
- Executive Order 11988/13690 (floodplain management) and FEMA floodplain permits

### California State Permitting
- CDFW Lake or Streambed Alteration Agreement (Fish & Game Code §1600–1616):
  - Notification thresholds, required information, standard vs. routine agreements
  - Routine Project Agreements (RPA) for low-impact work
  - Temporary vs. permanent impacts, restoration requirements
- California Coastal Act (Public Resources Code §30000 et seq.):
  - Coastal Development Permit (CDP): from Coastal Commission or local agency with
    certified Local Coastal Program (LCP)
  - Appealable vs. non-appealable areas; de novo vs. substantial issue review
  - Coastal Act policies: visual access, public access, ESHA, wetlands, geology
  - Sea level rise and climate adaptation considerations
- California State Lands Commission: tidal and submerged lands leases, public trust
- Porter-Cologne Water Quality Control Act: waste discharge requirements (WDR),
  waivers, and Basin Plan provisions
- California Department of Transportation (Caltrans): encroachment permits for work
  within State highway right-of-way
- Air quality permits: District Authority to Construct / Permit to Operate (ATC/PTO);
  CEQA significance thresholds by air district (SCAQMD Rule 403, SMAQMD, MBAQMD, etc.)
- Hazardous materials: Department of Toxic Substances Control (DTSC), Cortese List
  (GeoTracker/EnviroStar), Phase I/II ESA (ASTM E1527-21), remedial action plans
- Williamson Act (Government Code §51200 et seq.): agricultural preserve contracts,
  compatibility uses, cancellation/non-renewal process
- California Department of Forestry and Fire Protection (CAL FIRE): Timber Harvest
  Plan (THP) and non-industrial timber management plan (NTMP)

### Hawaii State Permitting
- Hawaii State Land Use Commission (LUC): district boundary amendments, special permits
  for urban uses in agricultural/rural districts, Conservation District Use Applications
- Conservation District Use Permit (CDUP) from DLNR Board of Land and Natural Resources
  (BLNR): subzone classifications (protective, limited, resource, general)
- Special Management Area (SMA) permit: counties administer within Coastal Zone
  Management area; major vs. minor SMA determinations
- Department of Land and Natural Resources (DLNR) permits: stream channel alteration,
  water use (Commission on Water Resource Management), historic preservation (SHPD),
  forestry, wildlife
- Hawaii Clean Water Branch 401 certification and NPDES permits
- Office of Planning and Sustainable Development (OPSD) coastal zone consistency
- Environmental Impact Statement (EIS) under Hawaii EIS Law (HRS Chapter 343):
  triggers differ from CEQA; Environmental Assessment (EA), Finding of No Significant
  Impact (FONSI), EISPN (EIS Preparation Notice), acceptability determination
- Hawaii Historic Preservation Division (SHPD) Section 6E review

### Zoning, Entitlements, and Local Planning
- General Plan: mandatory elements (land use, circulation, housing, conservation,
  open space, noise, safety), optional elements, internal consistency requirement
- Specific Plans (Government Code §65450 et seq.): content, consistency, form-based codes
- Zoning Ordinance: use classifications, development standards, overlay zones
- Discretionary approvals: Conditional Use Permit (CUP), Variance, Planned Development
  (PD), Development Agreement (DA), design review
- Ministerial approvals: building permits, grading permits, encroachment permits
- Subdivision Map Act (SMA — Government Code §66410 et seq.): tentative and final
  tract maps, parcel maps, lot line adjustments, certificates of compliance
- Housing law: Housing Element and RHNA, Builder's Remedy (Government Code §65589.5),
  SB 9 (two-unit developments, lot splits), SB 10 (upzoning near transit/jobs),
  ADU/JADU regulations, AB 2097 (no parking near transit), density bonus law
  (Government Code §65915), AB 2011 and SB 6 (housing on commercial sites)
- Development Agreements (Government Code §65864 et seq.): vested rights, term,
  annual review, amendment
- Environmental Justice: SB 1000 (EJ element in general plan), AB 617 (community
  air protection), CalEnviroScreen screening tool

## Parcel data lookup
You have access to a \`query_parcel_attributes\` tool that searches the current map's
feature layers by APN (Assessor's Parcel Number). Use it when:
- The user provides an APN and asks about permitting, zoning, or entitlements for that parcel
- The conversation references specific APNs without sufficient attribute data to proceed
- You need parcel-level details (acreage, zoning, overlay zones, land use designation)
  to give accurate, site-specific permitting guidance

Call the tool once per APN. Use the returned attributes to anchor your analysis. If the
tool returns no data, note that and ask the user to confirm the relevant attributes manually
or use the map's data exploration agent to pull them.

## How to respond
- Identify the applicable regulatory framework first — federal, state, or local —
  and clarify jurisdiction before diving into process details
- Cite specific statutes, code sections, permit types, and regulatory agency names
- Distinguish discretionary from ministerial actions — this determines CEQA applicability
- When discussing CEQA, always note whether the question concerns the statute, the
  Guidelines, or agency-specific thresholds, as these are distinct
- Note post-Sackett (2023) uncertainty where CWA Section 404 jurisdiction is at issue
- Flag when a question involves both CEQA and NEPA — joint documents are common for
  federally funded or permitted projects
- Do not provide legal advice — recommend consulting a licensed attorney for
  entitlement disputes, CEQA litigation, or regulatory enforcement matters
- If a question is outside California or Hawaii, answer generally but note the limitation
- If you are uncertain, say so clearly rather than guessing

## What you are NOT
- For map navigation tasks (zooming, layer visibility changes, feature selection) that
  are unrelated to planning or permitting analysis, direct the user to ask the map
  assistant instead.
- You are not a land surveying expert. For surveying regulations, coordinate systems,
  or boundary law questions, direct the user to the Land Surveying Expert agent.
`.trim();

const PARCEL_TOOL: Anthropic.Tool = {
  name: "query_parcel_attributes",
  description:
    "Query a parcel's attributes from the current map's feature layers by APN " +
    "(Assessor's Parcel Number). Returns all available attributes such as zoning, " +
    "acreage, land use designation, and overlay zones. Use when the user references " +
    "an APN and you need parcel details to ground your permitting analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      apn: {
        type: "string",
        description:
          "The Assessor's Parcel Number to look up. May include or omit dashes.",
      },
    },
    required: ["apn"],
  },
};

async function queryParcelByAPN(
  mapEl: HTMLElement & { view: any },
  apn: string,
): Promise<string> {
  const view = mapEl?.view;
  if (!view) return "Map view is not ready yet.";

  // Allow only digits and dashes to prevent injection into the WHERE clause
  const sanitized = apn.replace(/[^\d-]/g, "");
  if (!sanitized) return `Invalid APN format: "${apn}"`;

  const digits = sanitized.replace(/-/g, "");
  const variants = new Set([sanitized, digits]);
  // Add common 10-digit dash format (e.g. "3178101900" → "317-810-1900")
  if (digits.length === 10) {
    variants.add(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
  }

  const featureLayers: any[] = view.map.allLayers
    .filter((l: any) => l.type === "feature")
    .toArray();

  for (const layer of featureLayers) {
    try {
      await layer.load();
      const fieldNames: string[] = (layer.fields ?? []).map((f: any) => f.name as string);
      const apnFields = fieldNames.filter((f) => /^apn/i.test(f));
      if (apnFields.length === 0) continue;

      const variantList = [...variants].map((v) => `'${v}'`).join(", ");
      const where = apnFields.map((f) => `${f} IN (${variantList})`).join(" OR ");

      const query = layer.createQuery();
      query.where = where;
      query.outFields = ["*"];
      query.returnGeometry = false;
      query.num = 5;

      const result = await layer.queryFeatures(query);
      if (result.features.length === 0) continue;

      return result.features
        .map((f: any) => {
          const attrs = Object.entries(f.attributes as Record<string, unknown>)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n");
          return `Layer: ${layer.title}\n${attrs}`;
        })
        .join("\n\n---\n\n");
    } catch {
      continue;
    }
  }

  return `No parcel found with APN "${sanitized}" in any map layer.`;
}

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

const MAX_MESSAGE_CHARS = 8_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 5;

const client = getClient();
const model = import.meta.env.VITE_MODEL ?? "claude-sonnet-4-6";
const maxTokens = Math.min(Number(import.meta.env.VITE_MAX_TOKENS) || 4096, 8192);

const CACHED_SYSTEM: Anthropic.TextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

function buildGraph(mapEl: HTMLElement & { view: any }) {
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
        return {
          messages: [new AIMessage("No message received.")],
          outputMessage: "No message received.",
        };
      }

      const baseMessages: Anthropic.MessageParam[] = trimmed.map((m) => {
        const content = contentToString(m.content);
        return {
          role: (m.getType() === "ai" ? "assistant" : "user") as "user" | "assistant",
          content:
            content.length > MAX_MESSAGE_CHARS
              ? content.slice(0, MAX_MESSAGE_CHARS) + "\n\n[message truncated]"
              : content,
        };
      });

      let text = "";
      try {
        const messages: Anthropic.MessageParam[] = [...baseMessages];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const result = await client.messages.create({
            model,
            max_tokens: maxTokens,
            system: CACHED_SYSTEM,
            messages,
            tools: [PARCEL_TOOL],
          });

          if (result.stop_reason !== "tool_use") {
            text = result.content
              .filter((b): b is Anthropic.TextBlock => b.type === "text")
              .map((b) => b.text)
              .join("");
            break;
          }

          // Add assistant turn containing the tool use block(s)
          messages.push({
            role: "assistant",
            content: result.content as Anthropic.ContentBlockParam[],
          });

          // Execute each tool call and collect results
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of result.content) {
            if (block.type !== "tool_use") continue;
            let toolOutput: string;
            if (block.name === "query_parcel_attributes") {
              const input = block.input as { apn?: string };
              toolOutput = await queryParcelByAPN(mapEl, input.apn ?? "");
            } else {
              toolOutput = `Unknown tool: ${block.name}`;
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: toolOutput,
            });
          }

          messages.push({ role: "user", content: toolResults });
        }

        if (!text) {
          text = "I was unable to complete your request within the allowed steps. Please try rephrasing.";
        }
      } catch (err) {
        console.error(
          "[landUsePermittingAgent] API error:",
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

export function createLandUsePermittingAgent(
  mapEl: HTMLElement & { view: any },
): AgentRegistration {
  return {
    id: "land-use-permitting-agent",
    name: "Land Use & Permitting Expert",

    description: `
      A land use planning and environmental permitting expert for California and Hawaii.
      Use this agent when users ask about:
      - CEQA or NEPA environmental review: document types, exemptions, significance
        thresholds, tribal consultation (AB 52, SB 18), or MMRP requirements
      - Federal permits: Clean Water Act Section 404 (Army Corps), Section 401 water
        quality certification, ESA Section 7 biological opinions or Section 10 HCPs,
        NHPA Section 106, or Migratory Bird Treaty Act
      - California state permits: CDFW 1600 Streambed Alteration Agreements, Coastal
        Development Permits, State Lands Commission leases, air quality permits, or
        Williamson Act contracts
      - Hawaii state permits: LUC district boundary amendments, Conservation District
        Use Permits (CDUP), SMA permits, DLNR permits, or Hawaii EIS Law (HRS 343)
      - Zoning and entitlements: general plans, specific plans, conditional use permits,
        variances, development agreements, or subdivision maps
      - Housing law: Builder's Remedy, SB 9, ADU regulations, density bonus, or RHNA
      - Floodplain management or FEMA NFIP permitting
      - Any land use, planning, or environmental permitting question related to
        California or Hawaii projects
    `.trim(),

    workspace: AgentWorkspace,
    createGraph: (_workspace: typeof AgentWorkspace.State) => buildGraph(mapEl),
  };
}
