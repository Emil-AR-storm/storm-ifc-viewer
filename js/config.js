// Storm-oppsett som må fylles inn én gang. Alt annet i viewer'en henter herfra,
// så det er bare denne fila som må endres når folk kommer og går.

// ---------- Ansatte som kan settes som ansvarlig på en markering ----------
// id = brukerens Entra-ID (objekt-ID i Microsoft 365), den samme som brukes i
// Planner-tildelinger. Uten id lages oppgaven uten tildeling.
// Første person i lista er standardvalg.
export const ANSATTE = [
  { navn: "Emil Andersen Rippel", id: "733d62f6-c6e8-4201-bef8-01d5c942661a", mail: "Emil@stormentreprenor.no" },
  { navn: "Simen Rindebakken",    id: "50f0cbf9-9753-4a6b-aef7-3120cf4733f7", mail: "Simen@stormentreprenor.no" },
  { navn: "Steffen Sulesund",     id: "e1540304-d388-4d94-aac5-740453aa2bda", mail: "Steffen@stormentreprenor.no" },
  { navn: "Jarl Andersen Rippel", id: "31ce7b49-73b9-40c7-86ac-10a67db36931", mail: "Jarl@stormentreprenor.no" },
  { navn: "Aurimas",              id: "55dee656-c630-4ba8-853e-6801016486b6", mail: "Aurimas@stormentreprenor.no" }
  // ← flere legges inn her: { navn: "Fornavn Etternavn", id: "<entra-objekt-id>", mail: "…" }
];

// ---------- Planner ----------
// Planen markeringsoppgaver skal havne i. Hentet fra adressen til planen:
// planner.cloud.microsoft/webui/plan/<PLAN_ID>/view/board
export const PLANNER_PLAN_ID = "cy4sxJMQE0m6sgNvqhoLbpgAEPML";

// Kolonnen (bucket) på Planner-tavla. Opprettes automatisk hvis den mangler.
export const PLANNER_BUCKET = "IFC-markeringer";

// NB: alle som skal kunne få en oppgave må være medlem av gruppen som eier
// planen – Planner nekter å tilordne oppgaver til folk utenfor gruppen.
