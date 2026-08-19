// ⚙ Innstillingsmeny og hurtigtaster.
import { $, DEFAULT_APPEAR, DEFAULT_KEYS, DEFAULT_SETTINGS, på, S, esc, gjettEnhetSkala, ikon, lukkPaneler, velgEnhetSkala, writePrefs } from "./state.js";
import { SPRAK, setLang, t } from "./i18n.js";
import { LETT } from "./lett.js";
import { OPPSETT_FELT, OPPSETT_FIL, OPPSETT_STATUS } from "./oppsett.js";
import { angre, gjenopprett } from "./angre.js";
import { FRISTER } from "./config.js";
import { vaskGrenser } from "./frist.js";
import { renderCommentList, tegnAlleMarkeringerPaNytt } from "./markers.js";
import { applyAxisFont } from "./axes.js";
import { showClipBar, stopFacePick } from "./clip.js";
import { DEFAULT_BG, renderColorPanel, resetColors } from "./display.js";
import { refreshNumbers } from "./elements.js";
import { oppdaterLengdeEtiketter } from "./measure.js";
import { erApen as hjelpApen, lukkHjelp } from "./hjelp.js";
import { applyMiniSize, setMini } from "./minimap.js";
import { TYKK_MAKS, TYKK_MIN, oppdaterOutline, settTykkelse, vaskTykkelse } from "./outline.js";
import { applyCubePos, setCube, setCubePos } from "./viewcube.js";
import { setMode } from "./modes.js";
import { saveAppear, saveBg, saveSettings } from "./prefs.js";
import { scene } from "./scene.js";

// ---------- ⚙ Innstillingsmeny + hurtigtaster ----------
// Åpnes med høyreklikk i modellen eller ⚙-knappen i verktøylinja.
const ACTIONS = {
  marker:   { label: "Markering",  run: () => $("btnMarker").click() },
  measure:  { label: "Mål",        run: () => $("btnMeasure").click() },
  kote:     { label: "Kote",       run: () => $("btnKote").click() },
  axes:     { label: "Akser",      run: () => $("btnAxes").click() },
  clip:     { label: "Snitt",      run: () => $("btnClip").click() },
  storey:   { label: "Etasjer",    run: () => $("btnStorey").click() },
  search:   { label: "Søk",        run: () => $("btnSearch").click() },
  ghost:    { label: "Gjennomsiktig",run: () => $("btnGhost").click() },
  qty:      { label: "Mengder",    run: () => $("btnQty").click() },
  fit:      { label: "Vis alt",    run: () => $("btnFit").click() },
  settings: { label: "Innstillinger", run: () => openSettings() }
};

function openSettings(x, y) {
  const menu = $("setMenu");
  renderSettings();
  menu.classList.add("open");
  const w = menu.offsetWidth || 320, h = menu.offsetHeight || 420;
  const left = (x == null) ? Math.max(8, innerWidth - w - 14) : Math.min(Math.max(8, x), innerWidth - w - 8);
  const top  = (y == null) ? 100 : Math.min(Math.max(56, y), Math.max(56, innerHeight - h - 8));
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeSettings() {
  $("setMenu").classList.remove("open");
  S.keyWaitFor = null;
}

// ▣ Klarte ikke kantlinjene å laste motoren sin, skal det stå i menyen – ikke
// bare i konsollen. Kroken settes her fordi outline.js ikke kjenner menyen.
S.onOutlineFeil = () => { if ($("setMenu").classList.contains("open")) renderSettings(); };

på("btnSettings", "click", () => {
  const menu = $("setMenu");
  if (menu.classList.contains("open")) closeSettings(); else openSettings();
});

// klikk utenfor lukker menyen
document.addEventListener("pointerdown", (e) => {
  const menu = $("setMenu");
  if (!menu.classList.contains("open")) return;
  if (menu.contains(e.target) || e.target.id === "btnSettings") return;
  if (e.button === 2) return; // høyreklikk flytter menyen i stedet (contextmenu-håndtereren)
  closeSettings();
}, true);

function keyLabel(k) {
  if (!k) return "–";
  if (k === " ") return t("Mellomrom");
  if (k === "Escape") return "Esc";
  return k.length === 1 ? k.toUpperCase() : k;
}

// Forteller om oppsettet følger brukeren (SharePoint) eller bare denne nettleseren
function syncStatusText() {
  const acc = S.msalApp && S.msalApp.getActiveAccount();
  if (!acc) return '<span style="color:var(--muted)">' + t("Lagres bare i denne nettleseren. Logg inn via Biblioteket for at oppsettet skal følge deg på alle maskiner.") + '</span>';
  if (S.prefsCloudOK) return '<span style="color:var(--ok)">' + ikon("hake") + ' ' + t("Følger kontoen din ({0})", esc(acc.username || "")) + '</span>';
  return '<span style="color:var(--accent2)">' + t("Prøver å lagre til SharePoint …") + '</span>';
}

// ---------- Firmaoppsett: hva fant vi i oppsett.json? ----------
//
// HVORFOR DENNE SEKSJONEN FINNES. Fila leses med «if (o.felt)» — mangler et
// felt, brukes standardverdien og alt ser normalt ut. Det er riktig oppførsel,
// men det gjorde at «frister» manglet i SharePoint i tre uker uten at noen
// merket det: standardverdiene var tilfeldigvis de samme, så fargene stemte.
// Hadde noen endret grensa i fila, ville ingenting skjedd — helt stille.
//
// Her står det svart på hvitt hva fila faktisk inneholdt. Ikke som en feil,
// men som en liste: dette leser jeg, dette fant jeg, dette bruker jeg
// standardverdien for.
//
// BARE I DET INTERNE VERKTØYET. Byggeplassen har ingen SharePoint og henter
// aldri fila — der ville seksjonen bare vært et spørsmål uten svar.
function firmaoppsettHtml() {
  if (LETT) return "";

  const st = OPPSETT_STATUS;
  const rad = (tegn, farge, tekst, forklaring) =>
    '<div class="set-row"><span class="n" style="color:' + farge + '">' + tegn + ' ' + esc(tekst) +
    '</span><span style="color:var(--muted); font-size:11px">' + esc(forklaring) + '</span></div>';

  let inni = "";
  if (!st.lest) {
    inni = '<p style="color:var(--warn); font-size:12px; margin:0 0 8px">' +
      esc(t("{0} er ikke lest ennå. Logg inn i Biblioteket – da hentes den.", OPPSETT_FIL)) + '</p>';
  } else {
    if (st.feil) {
      inni += '<p style="color:var(--danger); font-size:12px; margin:0 0 8px">' +
        esc(t("Siste henting feilet: {0}", st.feil)) + '</p>';
    }
    if (st.fraBuffer) {
      inni += '<p style="color:var(--muted); font-size:11px; margin:0 0 8px">' +
        esc(t("Vist fra lagret kopi på denne maskinen – ikke hentet fra SharePoint i denne økten.")) + '</p>';
    }
    inni += OPPSETT_FELT.map(f => st.funnet.indexOf(f.navn) !== -1
      ? rad("✓", "var(--ok)", f.navn, t(f.hva))
      : rad("–", f.viktig ? "var(--danger)" : "var(--warn)", f.navn,
          (f.viktig ? t("MANGLER") + " · " : t("standardverdi") + " · ") + t(f.hva))
    ).join("");
  }

  // Overskriften bærer tallet, så du ser at noe mangler uten å åpne seksjonen.
  const antMangler = st.lest ? st.mangler.length : 0;
  const merke = !st.lest ? " ⚠"
    : antMangler ? ' <span style="color:var(--warn)">(' + antMangler + ')</span>' : "";

  return '<details><summary><h4 style="display:inline">' + t("Firmaoppsett") + merke + '</h4></summary>' +
    inni +
    '<p style="color:var(--muted); font-size:11px; margin-top:8px">' +
    t("Feltene over leses fra oppsett.json i SharePoint-mappa med modellene. Et felt som mangler er ikke en feil – da brukes standardverdien i koden – men da har du heller ikke kontroll på tallet fra fila. Merk at kopien i prosjektmappa ikke er den verktøyet leser.") +
    '</p></details>';
}

function renderSettings() {
  const bgVal = "#" + scene.background.getHexString();
  let html = "";
  html += '<h4>' + t("Kamera") + '</h4>' +
    '<div class="set-row"><span class="n">' + t("Rotasjonshastighet") + '</span>' +
    '<input type="range" id="stRot" min="0.3" max="3" step="0.1" value="' + S.settings.rotSpeed + '"></div>' +
    '<div class="set-row"><span class="n">' + t("Zoomhastighet") + '</span>' +
    '<input type="range" id="stZoom" min="0.3" max="3" step="0.1" value="' + S.settings.zoomSpeed + '"></div>' +
    '<div class="set-row"><span class="n">' + t("Invertér zoom") + '</span>' +
    '<input type="checkbox" id="stInv"' + (S.settings.invertZoom ? " checked" : "") + '></div>' +
    '<div class="set-row"><span class="n">' + t("Evig zoom") + '</span>' +
    '<input type="checkbox" id="stEvig"' + (S.settings.evigZoom ? " checked" : "") + '></div>' +
    '<p class="set-hjelp">' + t("Zoomen stopper normalt 20 cm fra punktet du ser på. Med evig zoom fortsetter du framover i stedet — helt inn i og gjennom modellen.") + '</p>';

  html += '<h4>' + t("Visning") + '</h4>' +
    '<div class="set-row"><span class="n">' + t("Språk") + '</span>' +
    '<select id="stLang">' + SPRAK.map(([k, navn]) =>
      '<option value="' + k + '"' + (S.lang === k ? " selected" : "") + '>' + navn + '</option>').join("") + '</select></div>' +
    '<div class="set-row"><span class="n">' + t("Måleenhet") + '</span>' +
    '<select id="stUnit"><option value="m"' + (S.settings.unit === "m" ? " selected" : "") + '>' + t("Meter (m)") + '</option>' +
    '<option value="mm"' + (S.settings.unit === "mm" ? " selected" : "") + '>' + t("Millimeter (mm)") + '</option></select></div>' +
    '<div class="set-row"><span class="n">' + t("Desimaler i mål og mengder") + '</span>' +
    '<select id="stDec">' + [0, 1, 2, 3, 4].map(d =>
      '<option value="' + d + '"' + (S.settings.decimals === d ? " selected" : "") + '>' + d +
      (d === 0 ? t(" (hele meter)") : d === 3 ? t(" (mm)") : "") + '</option>').join("") + '</select></div>' +
    '<div class="set-row"><span class="n">' + t("Elementer i lista") + '</span>' +
    '<select id="stListLimit">' + [50, 100, 250, 500, 1000, 2500, 5000, 0].map(n =>
      '<option value="' + n + '"' + (S.settings.listLimit === n ? " selected" : "") + '>' +
      (n === 0 ? t("Alle") : n) + '</option>').join("") + '</select></div>' +
    '<div class="set-row"><span class="n">' + t("Bakgrunnsfarge") + '</span>' +
    '<input type="color" id="stBg" value="' + bgVal + '"></div>' +
    '<div class="set-row"><span class="n">' + t("Kantlinjer") + '</span>' +
    '<input type="checkbox" id="stOutline"' + (S.settings.outline ? " checked" : "") + '></div>' +
    '<div class="set-row"><span class="n">' + t("Linjetykkelse") + ' <span id="stOutlineV" style="color:var(--muted)">' +
    vaskTykkelse(S.settings.outlineTykkelse) + ' px</span></span>' +
    '<input type="range" id="stOutlineTykk" min="' + TYKK_MIN + '" max="' + TYKK_MAKS + '" step="1" value="' +
    vaskTykkelse(S.settings.outlineTykkelse) + '"></div>' +
    '<p class="set-hjelp">' + t("Kantlinjer trekker en strek langs kantene på geometrien, så to objekt som ligger inntil hverandre lar seg skille fra hverandre. Avkryssingen gjelder hele modellen — vil du ha det på bare én elementtype, står knappen i Utseende.") + '</p>' +
    (S.outlineFeil ? '<p class="set-hjelp" style="color:var(--danger)">' +
      t("Kantlinjene lot seg ikke tegne — linjemotoren kunne ikke lastes. Er du uten dekning, prøv igjen når du har nett.") + '</p>' : '') +
    '<div class="set-row"><span class="n">' + t("Lav kvalitet") + '</span>' +
    '<input type="checkbox" id="stLight"' + (S.lightMode ? " checked" : "") + '></div>' +
    '<div class="set-row"><span class="n">' + t("Skriftstørrelse akser") + '</span>' +
    '<input type="range" id="stAxFont" min="40" max="250" step="10" value="' + Math.round(S.axisFontF * 100) + '"></div>';

  html += '<h4>' + t("Minikart") + '</h4>' +
    '<div class="set-row"><span class="n">' + t("Vis minikart") + '</span>' +
    '<input type="checkbox" id="stMini"' + (S.miniOn ? " checked" : "") + '></div>' +
    '<div class="set-row"><span class="n">' + t("Størrelse") + ' <span id="stMiniV" style="color:var(--muted)">' +
    Math.round(S.settings.miniSize) + ' px</span></span>' +
    '<input type="range" id="stMiniSz" min="100" max="400" step="10" value="' + S.settings.miniSize + '"></div>';

  // ---------- Fristgrenser ----------
  // Merket «gjelder hele Storm» med vilje: verdiene ligger i oppsett.json, ikke
  // i det personlige oppsettet. Hadde hver enkelt hatt sine egne grenser, ville
  // to personer sett på samme modell og vært uenige om hva som brenner.
  //
  // Endringen her er derfor MIDLERTIDIG for denne økta — den varer til
  // oppsett.json hentes på nytt. Det står i hjelpeteksten, så ingen tror de har
  // lagret noe de ikke har lagret.
  html += '<h4>' + t("Frister") + '</h4>' +
    '<div class="set-row"><span class="n">' + t("Gul ring fra (dager igjen)") + '</span>' +
    '<input type="number" id="stFristGul" min="0" max="365" step="1" value="' + FRISTER.gul + '"></div>' +
    '<div class="set-row"><span class="n">' + t("Rød ring fra (dager igjen)") + '</span>' +
    '<input type="number" id="stFristRod" min="0" max="365" step="1" value="' + FRISTER.rod + '"></div>' +
    '<p style="color:var(--muted); font-size:11px; margin:4px 0 0">' +
    t("Gjelder hele Storm. Varig endring gjøres i oppsett.json i SharePoint — her gjelder den bare til siden lastes på nytt.") + '</p>';

  // Sammenleggbar: 11 tastrader gjorde menyen så lang at knappene nederst havnet
  // utenfor synlig område uten at man skjønte at man måtte rulle.
  html += '<details' + (S.keyWaitFor ? " open" : "") + '><summary><h4 style="display:inline">' + t("Hurtigtaster") + '</h4>' +
    ' <span style="color:var(--muted); font-size:11px">(' + Object.keys(ACTIONS).length + ')</span></summary>';
  for (const k in ACTIONS) {
    html += '<div class="set-row"><span class="n">' + t(ACTIONS[k].label) + '</span>' +
      '<button class="keybtn' + (S.keyWaitFor === k ? " wait" : "") + '" data-key="' + k + '">' +
      (S.keyWaitFor === k ? t("Trykk tast …") : keyLabel(S.settings.keys[k])) + '</button></div>';
  }
  html += '<p style="color:var(--muted); font-size:11px; margin-top:8px">' +
    t("Esc avbryter modus og lukker paneler. Trykk på en tast-knapp og deretter ønsket tast for å endre.") + '</p></details>';

  // Også sammenleggbar, og bevisst plassert ETTER hurtigtastene: menyen skal
  // ikke bli lengre enn den var før kuben kom. Testen «få rader før
  // hurtigtastene» vokter nettopp dette.
  // Sammenleggbar, og etter hurtigtastene av samme grunn som ViewCube:
  // menyen skal ikke bli lengre enn før. Testen «få rader før hurtigtastene»
  // vokter det, og vi lå allerede på grensa.
  const gjettet = gjettEnhetSkala(S.modelSize) === 0.001 ? t("millimeter") : t("meter");
  html += '<details><summary><h4 style="display:inline">' + t("Enheter") + '</h4></summary>' +
    '<div class="set-row"><span class="n">' + t("Modellens enhet") + '</span>' +
    '<select id="stModellEnhet">' + [
      ["auto", t("Automatisk") + (S.modelGroup ? " (" + gjettet + ")" : "")],
      ["mm", t("Millimeter (mm)")], ["cm", t("Centimeter (cm)")],
      ["m", t("Meter (m)")], ["ft", t("Fot (ft)")]
    ].map(([k, navn]) =>
      '<option value="' + k + '"' + ((S.settings.modellEnhet || "auto") === k ? " selected" : "") + '>' +
      esc(navn) + '</option>').join("") + '</select></div>' +
    '<p style="color:var(--muted); font-size:11px; margin-top:8px">' +
    // Én linje med vilje: test-sprak leter etter oversettelseskall med et regulært uttrykk
    // og ser ikke en streng som er satt sammen over flere linjer.
    t("Hvilken enhet modellen er TEGNET i. Automatisk gjetter ut fra størrelsen og treffer nesten alltid – men bommer på små modeller i millimeter og på anlegg over en kilometer i meter. Står målene tusen ganger for høyt eller lavt, er det denne du skal endre.") + '</p></details>';

  html += '<details><summary><h4 style="display:inline">ViewCube</h4></summary>' +
    '<div class="set-row"><span class="n">' + t("Vis ViewCube") + '</span>' +
    '<input type="checkbox" id="stCube"' + (S.settings.cubeOn === false ? "" : " checked") + '></div>' +
    '<div class="set-row"><span class="n">' + t("Plassering") + '</span>' +
    '<select id="stCubePos">' + [
      ["tv", "Oppe til venstre"], ["th", "Oppe til høyre"],
      ["nv", "Nede til venstre"], ["nh", "Nede til høyre"]
    ].map(([k, navn]) =>
      '<option value="' + k + '"' + (S.settings.cubePos === k ? " selected" : "") + '>' +
      t(navn) + '</option>').join("") + '</select></div></details>';

  html += firmaoppsettHtml();

  html += '<h4>' + t("Lagring") + '</h4>' +
    '<p style="color:var(--muted); font-size:11px; margin:0 0 6px">' +
    t("Alt over – pluss fargelegging, egne typefarger, skjulte typer, gjennomsiktighet, snap og lav kvalitet – lagres automatisk og legges på neste gang du åpner en modell.") + '</p>' +
    '<p style="font-size:11px; margin:0 0 6px" id="stSync">' + syncStatusText() + '</p>' +
    '<div class="prop-actions" style="margin-top:10px"><button id="stReset">' + ikon("nullstill") + ' ' + t("Tilbakestill alt") + '</button></div>';

  $("setBody").innerHTML = html;

  $("stLang").onchange = (e) => {
    setLang(e.target.value);
    const sv = $("sprakVelg");
    if (sv) sv.value = S.lang;   // hold startskjerm-velgeren i takt
    renderSettings();
  };
  $("stRot").oninput = (e) => { S.settings.rotSpeed = Number(e.target.value); saveSettings(); };
  $("stZoom").oninput = (e) => { S.settings.zoomSpeed = Number(e.target.value); saveSettings(); };
  $("stInv").onchange = (e) => { S.settings.invertZoom = e.target.checked; saveSettings(); };
  $("stEvig").onchange = (e) => { S.settings.evigZoom = e.target.checked; saveSettings(); };
  $("stUnit").onchange = (e) => {
    S.settings.unit = e.target.value; saveSettings();
    if (S.syncPrefs) S.syncPrefs();
    byttEnhet();   // gamle mål- og kotelapper må tegnes om, ikke bare de neste
  };
  $("stDec").onchange = (e) => {
    S.settings.decimals = Number(e.target.value);
    saveSettings();
    refreshNumbers();
    if (S.clipOn && S.clipMode === "face") showClipBar();
  };
  // Hvor mange elementer lista i egenskapspanelet viser før den kortes av.
  // «Alle» (0) kan bli tregt på flere tusen elementer, men summene er uansett riktige.
  $("stListLimit").onchange = (e) => {
    S.settings.listLimit = Number(e.target.value);
    saveSettings();
    refreshNumbers();
  };
  $("stBg").oninput = (e) => {
    scene.background.set(e.target.value);
    saveBg(e.target.value);
  };
  $("stLight").onchange = () => $("btnLight").click();
  // ▣ Den globale bryteren låser knappene per type i 🎨 Utseende, så panelet
  // må tegnes på nytt hvis det står åpent. Uten det ville knappene sett
  // trykkbare ut mens de ikke lenger bestemte noe.
  $("stOutline").onchange = (e) => {
    S.settings.outline = e.target.checked;
    saveSettings();
    oppdaterOutline();
    if ($("colorPanel").classList.contains("open") && S.typeInfo) renderColorPanel();
  };
  // Tykkelsen bor på ETT delt materiale: slideren treffer alle strekene med én
  // gang, uten at noe bygges om. Derfor tåler den oninput per piksel man drar.
  $("stOutlineTykk").oninput = (e) => {
    S.settings.outlineTykkelse = vaskTykkelse(e.target.value);
    $("stOutlineV").textContent = S.settings.outlineTykkelse + " px";
    settTykkelse();
    saveSettings();
  };
  $("stAxFont").oninput = (e) => {
    S.axisFontF = e.target.value / 100;
    writePrefs();
    if (S.syncPrefs) S.syncPrefs();
    applyAxisFont();
  };
  $("stMini").onchange = (e) => setMini(e.target.checked);
  $("stModellEnhet").onchange = (e) => {
    S.settings.modellEnhet = e.target.value;
    saveSettings();
    if (S.syncPrefs) S.syncPrefs();
    byttEnhet();
  };
  $("stCube").onchange = (e) => setCube(e.target.checked);
  $("stCubePos").onchange = (e) => setCubePos(e.target.value);
  $("stMiniSz").oninput = (e) => {
    S.settings.miniSize = Number(e.target.value);
    $("stMiniV").textContent = S.settings.miniSize + " px";
    applyMiniSize(); saveSettings();
  };
  // onchange, ikke oninput: et tallfelt gir mellomtilstander mens man skriver
  // («1» på vei mot «14»), og hver av dem ville tegnet alle markeringene på nytt.
  const settFrist = () => {
    const g = vaskGrenser({ gul: $("stFristGul").value, rod: $("stFristRod").value });
    FRISTER.gul = g.gul; FRISTER.rod = g.rod;
    // vaskGrenser kan ha byttet om på dem — vis hva som faktisk gjelder
    $("stFristGul").value = g.gul; $("stFristRod").value = g.rod;
    tegnAlleMarkeringerPaNytt();
    renderCommentList();
  };
  $("stFristGul").onchange = settFrist;
  $("stFristRod").onchange = settFrist;
  $("setBody").querySelectorAll("button[data-key]").forEach(b => {
    b.onclick = () => { S.keyWaitFor = b.dataset.key; renderSettings(); };
  });
  $("stReset").onclick = () => {
    S.settings = Object.assign({}, DEFAULT_SETTINGS, { keys: Object.assign({}, DEFAULT_KEYS) });
    saveSettings();
    applyMiniSize();
    applyCubePos();
    // utseende, snap, aksefont og bakgrunn tilbake til standard
    S.axisFontF = 1;
    S.snapOn = true; S.snapPx = 18;
    writePrefs();
    applyAxisFont();
    setMini(true);
    oppdaterOutline();   // ▣ kantlinjene av igjen (outline: false i DEFAULT_SETTINGS)
    if (S.typeInfo) resetColors(); else { scene.background.set(DEFAULT_BG); saveBg(DEFAULT_BG); S.appear = Object.assign({}, DEFAULT_APPEAR, { colors: {}, hiddenTypes: [] }); saveAppear(); }
    renderSettings();
  };
}

// Alt som viser en lengde må regnes om når enheten endres – ellers ser
// innstillingen halvveis ødelagt ut: nye tall stemmer, gamle gjør ikke.
function byttEnhet() {
  S.enhetSkala = velgEnhetSkala(S.modelSize);
  oppdaterLengdeEtiketter();                              // mål og koter i 3D
  if (S.clipOn && S.clipMode === "face") showClipBar();   // snittavstanden
  if (S.qtyCache) { S.qtyCache = null; }                  // mengdene regnes på nytt
  try { refreshNumbers(); } catch(_) {}
  if (S.axesBuilt && S.rebuildAxes) S.rebuildAxes();      // aksemålene er i mm
}

// Husk bakgrunnsfargen mellom økter
try { if (S.bg) scene.background.set(S.bg); } catch(_) {}

window.addEventListener("keydown", (e) => {
  // venter vi på ny hurtigtast?
  if (S.keyWaitFor) {
    e.preventDefault();
    if (e.key !== "Escape") {
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      for (const a in S.settings.keys) if (S.settings.keys[a] === k && a !== S.keyWaitFor) S.settings.keys[a] = "";
      S.settings.keys[S.keyWaitFor] = k;
      saveSettings();
    }
    S.keyWaitFor = null;
    renderSettings();
    return;
  }
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;

  // ↩ Angre og gjenopprett. MÅ ligge foran ctrl-sperren under – uten dette
  // slippes ingen Ctrl-kombinasjon gjennom i det hele tatt. Ctrl+Shift+Z er
  // med fordi det er gjenopprett på Mac og Linux, der Ctrl+Y ofte er noe annet.
  if (e.ctrlKey || e.metaKey) {
    if (!e.altKey) {
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (k === "Z" && !e.shiftKey) { e.preventDefault(); angre(); return; }
      if (k === "Y" || (k === "Z" && e.shiftKey)) { e.preventDefault(); gjenopprett(); return; }
    }
    return;
  }
  if (e.altKey) return;

  if (e.key === "Escape") {
    // ❓ Hjelpekortene ligger øverst på skjermen og skal derfor lukkes først.
    // Sto de bakerst i denne rekka, ville Esc lukket et panel BAK sløret mens
    // kortene ble stående — og da ser Esc ut som om den ikke virker.
    if (hjelpApen()) { lukkHjelp(); return; }
    if ($("commentDialog").classList.contains("open")) { $("commentDialog").classList.remove("open"); return; }
    if ($("setMenu").classList.contains("open")) { closeSettings(); return; }
    if (S.clipPickFace) { stopFacePick(); showClipBar(); return; }
    if (S.mode) { setMode(S.mode); return; } // slår av gjeldende modus
    lukkPaneler();   // alle ti – før manglet clipPanel og sharePanel her
    return;
  }
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  for (const a in ACTIONS) {
    if (S.settings.keys[a] && S.settings.keys[a] === key) {
      e.preventDefault();
      try { ACTIONS[a].run(); } catch(_) {}
      return;
    }
  }
});

// høyreklikk i modellen åpner denne menyen (kobles opp av scene.js)
S.onContextMenu = openSettings;



// ---------- Statusrapport som PDF ----------
//
// Menyen henger under Rapport-knappen og virker som ⚙ Innstillinger: .open
// styrer visningen, klikk utenfor lukker. Selve rapporten ligger i
// js/rapport.js, som ikke rører DOM — det er derfor tallene kan testes i Node.
//
// jsPDF lastes først når noen faktisk trykker Fullstendig eller Byggemøte, så
// en økt uten rapport aldri betaler for biblioteket.
import { lastNedRapport } from "./rapport.js";
import { fangstBilde } from "./scene.js";
import { hentLogo, hentLogoer } from "./tegninger.js";
import { ryddLogonavn } from "./rapport.js";
import "./verktoygrupper.js";   // 🧰 grupperer verktøylinja — må lastes etter at knappene finnes

let logoerLastet = false;

async function fyllLogovalg() {
  const velg = $("rapLogo");
  if (!velg || logoerLastet) return;
  logoerLastet = true;
  velg.innerHTML = '<option value="">' + esc(t("Innebygd Storm-logo")) + "</option>";
  const liste = await hentLogoer();
  for (const l of liste) {
    const o = document.createElement("option");
    o.value = l.itemId; o.textContent = ryddLogonavn(l.fil); o.dataset.fil = l.fil;
    velg.appendChild(o);
  }
  // Husket valg gjenopprettes på FILNAVN, ikke itemId: SharePoint gir samme fil
  // ny itemId hvis den lastes opp på nytt, og da ville valget stille falt bort.
  const husket = S.settings.rapLogo;
  if (husket) {
    const treff = [...velg.options].find(o => o.dataset.fil === husket);
    if (treff) velg.value = treff.value;
  }
}

function lukkRapMeny() { const m = $("rapMeny"); if (m) m.classList.remove("open"); }

på("btnRapport", "click", () => {
  const m = $("rapMeny"), knapp = $("btnRapport");
  if (!m || !knapp) return;
  if (m.classList.contains("open")) { lukkRapMeny(); return; }
  const r = knapp.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - 310)) + "px";
  m.style.top = (r.bottom + 6) + "px";
  m.classList.add("open");
  if ($("rapCsv")) $("rapCsv").checked = !!S.settings.rapCsv;
  fyllLogovalg();
});

document.addEventListener("pointerdown", (e) => {
  const m = $("rapMeny");
  if (!m || !m.classList.contains("open")) return;
  if (m.contains(e.target) || (e.target.closest && e.target.closest("#btnRapport"))) return;
  lukkRapMeny();
});

på("rapCsv", "change", (e) => { S.settings.rapCsv = !!e.target.checked; writePrefs(); });
på("rapLogo", "change", (e) => {
  const o = e.target.selectedOptions[0];
  S.settings.rapLogo = (o && o.dataset.fil) || "";
  writePrefs();
});

// 🔁 BCF-eksport. Ligger i rapportmenyen fordi det er samme handling for
// brukeren — «få markeringene ut av Storm» — bare i et annet format.
på("rapBcf", "click", async () => {
  lukkRapMeny();
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  try {
    const bcf = await import("./bcf.js");
    const r = await bcf.eksporterBcf({
      markeringer: S.comments || [],
      modell: S.fileName,
      prosjekt: S.lettProsjekt || "",
      fangstBilde: () => fangstBilde(1400, 900)
    });
    // Sier ALLTID fra hvor mange saker som mangler elementreferanse. Uten den
    // finner ikke mottakerens verktøy fram til riktig vegg, og det er verdt å
    // vite FØR fila sendes — ikke etter at prosjekterende har spurt.
    alert(r.utenElement
      ? t("{0} BCF-saker eksportert. {1} av dem mangler elementreferanse og peker ikke på et bestemt objekt — de ble laget før elementkoblingen kom inn.", r.antall, r.utenElement)
      : t("{0} BCF-saker eksportert, alle med elementreferanse.", r.antall));
  } catch (err) {
    alert(t("Klarte ikke å lage BCF-fila: {0}", err.message));
  }
});

document.querySelectorAll(".rap-valg").forEach((b) => {
  b.addEventListener("click", async () => {
    lukkRapMeny();
    if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
    const velg = $("rapLogo");
    const itemId = velg ? velg.value : "";
    await lastNedRapport({
      utgave: b.dataset.utgave,
      medCsv: !!(S.settings && S.settings.rapCsv),
      modell: S.fileName,
      fangstBilde: () => fangstBilde(1400, 900),
      hentLogo: () => hentLogo(itemId)
    });
  });
});
