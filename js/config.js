// Storm-oppsett som må fylles inn én gang. Alt annet i viewer'en henter herfra,
// så det er bare denne fila som må endres når folk kommer og går.

// ---------- Ansatte som kan settes som ansvarlig på en markering ----------
// id = brukerens Entra-ID (objekt-ID i Microsoft 365), den samme som brukes i
// Planner-tildelinger. Uten id lages oppgaven uten tildeling.
// Første person i lista er standardvalg.
export const ANSATTE = [
  // ← flere legges inn her: { navn: "Fornavn Etternavn", id: "<entra-objekt-id>", mail: "…" }
];

// ---------- Planner ----------
// Planen markeringsoppgaver skal havne i. Hentet fra adressen til planen:
// planner.cloud.microsoft/webui/plan/<PLAN_ID>/view/board
export const PLANNER_PLAN_ID = "";

// Kolonnen (bucket) på Planner-tavla. Opprettes automatisk hvis den mangler.
export const PLANNER_BUCKET = "IFC-markeringer";

// NB: alle som skal kunne få en oppgave må være medlem av gruppen som eier
// planen – Planner nekter å tilordne oppgaver til folk utenfor gruppen.
