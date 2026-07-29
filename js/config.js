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
// Denne sendes med som --plan i kommandoen, så det er bare her den står.
export const PLANNER_PLAN_ID = "";

// Mappa der markering_planner.py ligger på Emils maskin. Brukes bare til å bygge
// den ferdige copy-paste-kommandoen.
export const PLANNER_DIR =
  "";
