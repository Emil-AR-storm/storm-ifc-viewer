// 📋 Teams Planner rett fra nettleseren.
//
// Oppgaven opprettes med Microsoft Graph og brukerens egen innlogging – ingen
// PowerShell, ingen hemmeligheter i koden. Planner er varslingsmotoren; vi bare
// oppretter oppgaven, så mottakeren får den i Planner og «Mine oppgaver» i Teams.
//
// Krever at app-registreringen har den delegerte tillatelsen Tasks.ReadWrite.
// Se OPPLASTING.md for oppsettet.
import { PLANNER_BUCKET, PLANNER_PLAN_ID } from "./config.js";
import { t } from "./i18n.js";
import { GRAPH, authHeaders, graphToken } from "./sharepoint.js";

export const PLANNER_SCOPES = ["Tasks.ReadWrite"];

// funksjon, ikke konstant: teksten skal følge språket som er valgt NÅ.
// Vises BARE når vi må omdirigere (telefon, eller blokkert popup). På PC går
// samtykket i et lite vindu som lukker seg selv, og da er det ingenting å
// advare om – derfor ligger spørsmålet i sharepoint.js, ikke her.
const SAMTYKKE = () =>
  t("For å lage Planner-oppgaver må du gi Storm IFC-Viewer tilgang til oppgavene dine – det skjer én gang. Siden lastes på nytt, så modellen må åpnes igjen etterpå («Fortsett med …» på startskjermen).\n\nFortsette?");

export async function plannerToken(silent) {
  return graphToken(PLANNER_SCOPES, {
    silent: !!silent,
    after: "markeringer",
    confirmFirst: SAMTYKKE
  });
}

// Graph struper Planner-endepunktene ganske hardt. Uten dette får brukeren
// tilfeldige feilmeldinger som ser ut som noe annet.
async function gFetch(token, path, opts) {
  const o = opts || {};
  const headers = authHeaders(token, o.headers, "Planner");
  if (o.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  for (let forsok = 0; ; forsok++) {
    const r = await fetch(GRAPH + path, Object.assign({}, o, { headers }));
    if (r.ok) return r;
    if ((r.status === 429 || r.status === 503) && forsok < 3) {
      const ra = parseFloat(r.headers.get("Retry-After"));
      const vent = Math.min(Math.max(isFinite(ra) ? ra * 1000 : Math.pow(2, forsok) * 1000, 250), 60000);
      try { await r.text(); } catch(_) {}
      await new Promise(res => setTimeout(res, vent));
      continue;
    }
    throw new Error("Graph " + r.status + ": " + (await r.text()).slice(0, 300));
  }
}

const gGet = async (token, path) => (await gFetch(token, path)).json();
const gPost = async (token, path, body) =>
  (await gFetch(token, path, { method: "POST", body: JSON.stringify(body) })).json();

// Bøtta slås opp på navn og opprettes hvis den mangler
let bucketId = null;
async function finnEllerOpprettBucket(token) {
  if (bucketId) return bucketId;
  const data = await gGet(token, "/planner/plans/" + PLANNER_PLAN_ID + "/buckets");
  const funnet = (data.value || []).find(b => b.name === PLANNER_BUCKET);
  if (funnet) return (bucketId = funnet.id);
  const ny = await gPost(token, "/planner/buckets",
    { name: PLANNER_BUCKET, planId: PLANNER_PLAN_ID, orderHint: " !" });
  return (bucketId = ny.id);
}

// "2026-08-05" → "2026-08-05T12:00:00Z". Kl. 12 UTC, ikke midnatt, ellers
// hopper datoen en dag i norsk tidssone.
export function fristTilISO(dato) {
  return dato ? dato + "T12:00:00Z" : null;
}

export const planUrl = () =>
  "https://planner.cloud.microsoft/webui/plan/" + PLANNER_PLAN_ID + "/view/board";

// Oppretter oppgaven. assignees = liste med Entra objekt-ID-er (GUID), ikke e-post.
export async function opprettOppgave(token, { title, dueISO, description, assignees }) {
  const body = {
    planId: PLANNER_PLAN_ID,
    bucketId: await finnEllerOpprettBucket(token),
    title: String(title || "").slice(0, 255)
  };
  if (dueISO) body.dueDateTime = dueISO;
  if (assignees && assignees.length) {
    body.assignments = {};
    assignees.forEach(id => {
      if (id) body.assignments[id] =
        { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" };
    });
  }
  const task = await gPost(token, "/planner/tasks", body);

  // Beskrivelsen ligger ikke på oppgaven, men på et eget details-objekt som må
  // PATCHes med If-Match. Feiler dette, står oppgaven likevel – ikke velt alt.
  if (description && task && task.id) {
    try {
      const det = await gGet(token, "/planner/tasks/" + task.id + "/details");
      if (det["@odata.etag"]) {
        await gFetch(token, "/planner/tasks/" + task.id + "/details", {
          method: "PATCH",
          headers: { "If-Match": det["@odata.etag"] },
          body: JSON.stringify({ description: String(description) })
        });
      }
    } catch (err) { console.warn("Kunne ikke sette notat på oppgaven:", err.message); }
  }
  return { id: task && task.id, url: planUrl() };
}

// Merker en oppgave som ferdig i Planner (brukes når markeringen settes til Løst)
export async function fullforOppgave(token, taskId) {
  const t = await gGet(token, "/planner/tasks/" + taskId);
  await gFetch(token, "/planner/tasks/" + taskId, {
    method: "PATCH",
    headers: { "If-Match": t["@odata.etag"] },
    body: JSON.stringify({ percentComplete: 100 })
  });
}
