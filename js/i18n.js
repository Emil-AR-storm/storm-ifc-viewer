// Språk. Norsk tekst er NØKKELEN og reserven: t("Åpne") slår opp i ordboken og
// gir norsk tilbake hvis oversettelsen mangler eller språket er norsk. Dermed
// kan ingen manglende nøkkel knekke noe – den gir bare norsk tekst.
//
// Tekster med innfylling bruker {0}, {1} …: t("Viser {0} av {1} treff", 50, n).
//
// Statisk HTML merkes med data-i18n (tekstinnhold), data-i18n-title (title) og
// data-i18n-ph (placeholder) – oversettDom() tar dem ved oppstart og språkbytte.
//
// BEVISST IKKE oversatt (data som deles med hele Storm, alltid norsk):
// - Planner-oppgavenes tittel og notat (går til Storms felles tavle)
// - markeringenes lagrede statusverdier ("Åpen"/"Pågår"/"Løst" – vises oversatt)
// - datoformatet i lagrede markeringer (no-NO)
import { S, writePrefs } from "./state.js";

export const SPRAK = [
  ["no", "Norsk"],
  ["en", "English"],
  ["pl", "Polski"],
  ["lt", "Lietuvių"]
];

export function t(nøkkel, ...args) {
  const o = ORDBOK[nøkkel];
  let s = (o && o[S.lang]) || nøkkel;
  for (let i = 0; i < args.length; i++) s = s.split("{" + i + "}").join(args[i]);
  return s;
}

export function setLang(kode) {
  if (!SPRAK.some(([k]) => k === kode)) kode = "no";
  S.lang = kode;
  writePrefs();
  if (S.syncPrefs) S.syncPrefs();
  oversettDom();
  // ViewCube-flatene er tegnede bilder, ikke DOM – de må males på nytt
  if (S.rebuildCube) S.rebuildCube();
}

// Oversetter alt som er merket i index.html. Originalteksten (norsk) lagres i
// data-no første gang, så vi alltid kan bytte FRA et annet språk også.
export function oversettDom() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    if (!el.dataset.no) el.dataset.no = el.textContent.trim().replace(/\s+/g, " ");
    el.textContent = t(el.dataset.no);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    if (!el.dataset.noTitle) el.dataset.noTitle = el.getAttribute("title") || "";
    el.setAttribute("title", t(el.dataset.noTitle));
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    if (!el.dataset.noPh) el.dataset.noPh = el.getAttribute("placeholder") || "";
    el.setAttribute("placeholder", t(el.dataset.noPh));
  });
}

export const ORDBOK = {
  // ---------- Toppbar og verktøylinje ----------
  "Åpne": { en: "Open", pl: "Otwórz", lt: "Atidaryti" },
  "Bibliotek": { en: "Library", pl: "Biblioteka", lt: "Biblioteka" },
  "Biblioteket": { en: "the Library", pl: "Bibliotekę", lt: "biblioteką" },
  "Lav kvalitet": { en: "Low quality", pl: "Niska jakość", lt: "Žema kokybė" },
  "Vis hele modellen": { en: "Show the whole model", pl: "Pokaż cały model", lt: "Rodyti visą modelį" },
  "Markering": { en: "Marker", pl: "Znacznik", lt: "Žymeklis" },
  "Mål": { en: "Measure", pl: "Pomiar", lt: "Matavimas" },
  "Kote": { en: "Elevation", pl: "Rzędna", lt: "Altitudė" },
  "Akser": { en: "Grids", pl: "Osie", lt: "Ašys" },
  "Snitt": { en: "Section", pl: "Przekrój", lt: "Pjūvis" },
  "Etasjer": { en: "Storeys", pl: "Kondygnacje", lt: "Aukštai" },
  "Søk": { en: "Search", pl: "Szukaj", lt: "Paieška" },
  "Gjennomsiktig": { en: "Transparent", pl: "Przezroczysty", lt: "Permatomas" },
  "Mengder": { en: "Quantities", pl: "Ilości", lt: "Kiekiai" },
  "Utseende": { en: "Appearance", pl: "Wygląd", lt: "Išvaizda" },
  "Sammenlign": { en: "Compare", pl: "Porównaj", lt: "Palyginti" },
  "Del visning": { en: "Share view", pl: "Udostępnij widok", lt: "Bendrinti vaizdą" },
  "Lett kopi": { en: "Light copy", pl: "Lekka kopia", lt: "Lengvoji kopija" },
  "Innstillinger": { en: "Settings", pl: "Ustawienia", lt: "Nustatymai" },
  "Vis alle": { en: "Show all", pl: "Pokaż wszystkie", lt: "Rodyti visus" },
  "Vis alt": { en: "Show all", pl: "Pokaż wszystko", lt: "Rodyti viską" },
  "Mer": { en: "More", pl: "Więcej", lt: "Daugiau" },
  "Flere verktøy – hold inne for Innstillinger": { en: "More tools – hold for Settings", pl: "Więcej narzędzi – przytrzymaj, aby otworzyć Ustawienia", lt: "Daugiau įrankių – palaikykite nuspaudę Nustatymams" },
  "Forenklet lasting for mobil og store modeller": { en: "Simplified loading for mobile and large models", pl: "Uproszczone ładowanie na telefon i duże modele", lt: "Supaprastintas įkėlimas telefonui ir dideliems modeliams" },
  "Sammenlign med en annen versjon av modellen": { en: "Compare with another version of the model", pl: "Porównaj z inną wersją modelu", lt: "Palyginti su kita modelio versija" },
  "Lag en lenke som gjenskaper denne visningen hos andre": { en: "Create a link that recreates this view for others", pl: "Utwórz link odtwarzający ten widok u innych", lt: "Sukurti nuorodą, atkuriančią šį vaizdą kitiems" },
  "Eksporter forenklet modell (.glb) som funker på mobil": { en: "Export a simplified model (.glb) that works on mobile", pl: "Eksportuj uproszczony model (.glb) działający na telefonie", lt: "Eksportuoti supaprastintą modelį (.glb), veikiantį telefone" },
  "Innstillinger og hurtigtaster (høyreklikk i modellen)": { en: "Settings and shortcuts (right-click in the model)", pl: "Ustawienia i skróty (prawy przycisk w modelu)", lt: "Nustatymai ir spartieji klavišai (dešinysis pelės mygtukas modelyje)" },
  "Trykk for å flytte deg dit": { en: "Click to move there", pl: "Kliknij, aby się tam przenieść", lt: "Spustelėkite, kad ten persikeltumėte" },
  "Lukk": { en: "Close", pl: "Zamknij", lt: "Uždaryti" },

  // ---------- Startskjerm ----------
  "Åpne en IFC-modell (BIM) direkte i nettleseren – på mobil eller PC. Naviger i 3D, trykk på elementer for info, mål, snitt og legg inn markeringer.": {
    en: "Open an IFC model (BIM) directly in the browser – on mobile or PC. Navigate in 3D, tap elements for info, measure, section and add markers.",
    pl: "Otwórz model IFC (BIM) bezpośrednio w przeglądarce – na telefonie lub PC. Nawiguj w 3D, dotknij elementów po informacje, mierz, twórz przekroje i dodawaj znaczniki.",
    lt: "Atidarykite IFC modelį (BIM) tiesiai naršyklėje – telefone ar kompiuteryje. Naršykite 3D, spustelėkite elementus informacijai, matuokite, pjaukite ir dėkite žymeklius." },
  "Velg IFC-fil": { en: "Choose IFC file", pl: "Wybierz plik IFC", lt: "Pasirinkti IFC failą" },
  "… eller dra fila rett inn i vinduet. Ligger modellen i OneDrive med skyikon (bare på nett), bruk Biblioteket – eller høyreklikk fila i Utforsker → «Behold alltid på denne enheten».": {
    en: "… or drag the file straight into the window. If the model is in OneDrive with a cloud icon (online-only), use the Library – or right-click the file in Explorer → “Always keep on this device”.",
    pl: "… lub przeciągnij plik prosto do okna. Jeśli model jest w OneDrive z ikoną chmury (tylko online), użyj Biblioteki – lub kliknij plik prawym przyciskiem w Eksploratorze → „Zawsze zachowuj na tym urządzeniu”.",
    lt: "… arba vilkite failą tiesiai į langą. Jei modelis yra „OneDrive“ su debesies ženkliuku (tik internete), naudokite biblioteką – arba spustelėkite failą dešiniu mygtuku naršyklėje → „Visada laikyti šiame įrenginyje“." },
  "Åpne fra biblioteket": { en: "Open from the library", pl: "Otwórz z biblioteki", lt: "Atidaryti iš bibliotekos" },
  "Filen behandles kun lokalt i nettleseren din – ingenting lastes opp.": {
    en: "The file is processed only locally in your browser – nothing is uploaded.",
    pl: "Plik jest przetwarzany wyłącznie lokalnie w przeglądarce – nic nie jest wysyłane.",
    lt: "Failas apdorojamas tik jūsų naršyklėje – niekas neįkeliama." },
  "JavaScript kjører ikke. Åpner du fila i forhåndsvisning (Filer/mail)? Åpne den i Safari eller Chrome i stedet.": {
    en: "JavaScript is not running. Are you opening the file in a preview (Files/mail)? Open it in Safari or Chrome instead.",
    pl: "JavaScript nie działa. Otwierasz plik w podglądzie (Pliki/poczta)? Otwórz go w Safari lub Chrome.",
    lt: "„JavaScript“ neveikia. Ar atidarote failą peržiūroje (Failai/paštas)? Atidarykite jį „Safari“ arba „Chrome“." },
  "Dra: roter · Midtklikk / to fingre: panorer · Rullehjul: zoom · Høyreklikk: innstillinger · Trykk på element: info": {
    en: "Drag: rotate · Middle-click / two fingers: pan · Scroll: zoom · Right-click: settings · Tap element: info",
    pl: "Przeciągnij: obrót · Środkowy przycisk / dwa palce: przesuwanie · Kółko: zoom · Prawy przycisk: ustawienia · Dotknij elementu: informacje",
    lt: "Vilkite: sukti · Vidurinis mygtukas / du pirštai: stumdyti · Ratukas: mastelis · Dešinysis mygtukas: nustatymai · Spustelėkite elementą: informacija" },
  "Laster modell …": { en: "Loading model …", pl: "Wczytywanie modelu …", lt: "Įkeliamas modelis …" },
  // Byggeplass-lenka (trinn 4): landingssiden med kodefeltet
  "Åpne modellen": { en: "Open the model", pl: "Otwórz model", lt: "Atidaryti modelį" },
  "Prosjektnummer": { en: "Project number", pl: "Numer projektu", lt: "Projekto numeris" },
  "Prosjektnummeret må være 5 siffer.": { en: "The project number must be 5 digits.", pl: "Numer projektu musi mieć 5 cyfr.", lt: "Projekto numerį turi sudaryti 5 skaitmenys." },
  "Koden står på QR-plakaten fra Storm.": { en: "The code is on the QR poster from Storm.", pl: "Kod znajduje się na plakacie QR od Storm.", lt: "Kodas nurodytas Storm QR plakate." },
  "Feil kode eller prosjekt.": { en: "Wrong code or project.", pl: "Nieprawidłowy kod lub projekt.", lt: "Neteisingas kodas arba projektas." },
  "For mange forsøk. Prøv igjen om en time.": { en: "Too many attempts. Try again in an hour.", pl: "Za dużo prób. Spróbuj ponownie za godzinę.", lt: "Per daug bandymų. Bandykite dar kartą po valandos." },
  "Ingen modeller i prosjektet ennå.": { en: "No models in this project yet.", pl: "W tym projekcie nie ma jeszcze modeli.", lt: "Šiame projekte dar nėra modelių." },
  "Fikk ikke kontakt – sjekk nettet og prøv igjen.": { en: "No connection – check your network and try again.", pl: "Brak połączenia – sprawdź sieć i spróbuj ponownie.", lt: "Nėra ryšio – patikrinkite tinklą ir bandykite dar kartą." },
  "Velg modell": { en: "Choose model", pl: "Wybierz model", lt: "Pasirinkite modelį" },
  // Byggeplass-lenka (trinn 5): kvitteringsbilder
  "Bildet er sendt. Det blir synlig for prosjektlederen neste gang han åpner modellen.": {
    en: "The photo has been sent. The project manager will see it the next time he opens the model.",
    pl: "Zdjęcie zostało wysłane. Kierownik projektu zobaczy je przy następnym otwarciu modelu.",
    lt: "Nuotrauka išsiųsta. Projekto vadovas ją pamatys kitą kartą atidaręs modelį." },
  "Fikk ikke sendt bildet": { en: "Could not send the photo", pl: "Nie udało się wysłać zdjęcia", lt: "Nepavyko išsiųsti nuotraukos" },
  "Henter kvitteringer fra byggeplassen …": { en: "Fetching site photos …", pl: "Pobieranie zdjęć z budowy …", lt: "Gaunamos nuotraukos iš statybvietės …" },
  "Laster opp markeringene …": { en: "Uploading markers …", pl: "Przesyłanie oznaczeń …", lt: "Įkeliamos žymos …" },
  // Byggeplass-lenka (trinn 5b): avvik, kommentarer og tegninger fra byggeplassen
  "Navnet ditt (vises på markeringen):": { en: "Your name (shown on the marker):", pl: "Twoje imię (widoczne na oznaczeniu):", lt: "Jūsų vardas (rodomas žymoje):" },
  "Byggeplass": { en: "Site", pl: "Budowa", lt: "Statybvietė" },
  "Markeringen er sendt til prosjektlederen.": { en: "The marker has been sent to the project manager.", pl: "Oznaczenie zostało wysłane do kierownika projektu.", lt: "Žyma išsiųsta projekto vadovui." },
  "Fikk ikke sendt dette til prosjektlederen – sjekk nettet og prøv igjen.": { en: "Could not send this to the project manager – check your connection and try again.", pl: "Nie udało się wysłać do kierownika projektu – sprawdź sieć i spróbuj ponownie.", lt: "Nepavyko išsiųsti projekto vadovui – patikrinkite ryšį ir bandykite dar kartą." },
  "Laster opp arbeidstegningene …": { en: "Uploading drawings …", pl: "Przesyłanie rysunków …", lt: "Įkeliami brėžiniai …" },
  "Tegningen er ikke lastet opp til byggeplass-lenka ennå": { en: "The drawing has not been uploaded to the site link yet", pl: "Rysunek nie został jeszcze przesłany do linku budowy", lt: "Brėžinys dar neįkeltas į statybvietės nuorodą" },
  // Rett strek i måleverktøyet + rød teller på Byggeplass-knappen
  "Rett strek": { en: "Straight line", pl: "Prosta linia", lt: "Tiesi linija" },
  "Historikk": { en: "History", pl: "Historia", lt: "Istorija" },
  "Nyeste versjon": { en: "Latest version", pl: "Najnowsza wersja", lt: "Naujausia versija" },
  "Revisjon": { en: "Revision", pl: "Rewizja", lt: "Revizija" },
  "Ingen tidligere revisjoner ennå.": { en: "No earlier revisions yet.", pl: "Brak wcześniejszych rewizji.", lt: "Ankstesnių revizijų dar nėra." },
  "Sammenlign med nyeste": { en: "Compare with latest", pl: "Porównaj z najnowszą", lt: "Palyginti su naujausia" },
  "Fikk ikke lest revisjonen for sammenligning.": { en: "Could not read the revision for comparison.", pl: "Nie udało się odczytać rewizji do porównania.", lt: "Nepavyko nuskaityti revizijos palyginimui." },
  "Fikk ikke lest modellen for sammenligning – er dette en svært gammel lett kopi uten elementdata?": { en: "Could not read the model for comparison – is this a very old light copy without element data?", pl: "Nie udało się odczytać modelu do porównania – czy to bardzo stara lekka kopia bez danych elementów?", lt: "Nepavyko nuskaityti modelio palyginimui – ar tai labai sena lengvoji kopija be elementų duomenų?" },
  "Skriv koden først.": { en: "Enter the code first.", pl: "Najpierw wpisz kod.", lt: "Pirmiausia įveskite kodą." },
  "Lås målet til rett linje langs nærmeste akse (vannrett eller loddrett)": { en: "Lock the measurement to a straight line along the nearest axis (horizontal or vertical)", pl: "Zablokuj pomiar w prostej linii wzdłuż najbliższej osi (poziomo lub pionowo)", lt: "Užfiksuoti matavimą tiesia linija pagal artimiausią ašį (horizontaliai arba vertikaliai)" },
  "nye ting fra byggeplassen – trykk Byggeplass for å hente dem inn": { en: "new items from the site – press Byggeplass to fetch them", pl: "nowe elementy z budowy – naciśnij Byggeplass, aby je pobrać", lt: "nauji elementai iš statybvietės – spauskite Byggeplass, kad juos gautumėte" },
  "Språk": { en: "Language", pl: "Język", lt: "Kalba" },
  "Fikk ikke sendt dette til prosjektlederen nå. Det er lagret på telefonen og sendes automatisk når du har nett igjen.": { en: "Couldn't send this to the project manager right now. It is saved on your phone and will be sent automatically when you are back online.", pl: "Nie udało się teraz wysłać tego do kierownika projektu. Zapisano w telefonie i zostanie wysłane automatycznie po odzyskaniu połączenia.", lt: "Nepavyko dabar išsiųsti to projekto vadovui. Išsaugota telefone ir bus išsiųsta automatiškai, kai atsiras ryšys." },
  "ikke sendt": { en: "not sent", pl: "nie wysłano", lt: "neišsiųsta" },

  // ---------- Vekt og forskaling (Mengder) ----------
  "Forskaling (m2)": { en: "Formwork (m2)", pl: "Szalunek (m2)", lt: "Klojiniai (m2)" },
  "Vekt (kg)": { en: "Weight (kg)", pl: "Masa (kg)", lt: "Svoris (kg)" },
  "Kg/m": { en: "Kg/m", pl: "kg/m", lt: "kg/m" },

  // ---------- Firmaoppsett-sjekken i ⚙ Innstillinger ----------
  "Firmaoppsett": { en: "Company settings", pl: "Ustawienia firmy", lt: "Įmonės nustatymai" },
  "MANGLER": { en: "MISSING", pl: "BRAK", lt: "TRŪKSTA" },
  "standardverdi": { en: "default value", pl: "wartość domyślna", lt: "numatytoji reikšmė" },
  "{0} er ikke lest ennå. Logg inn i Biblioteket – da hentes den.": {
    en: "{0} has not been read yet. Sign in to the Library and it will be fetched.",
    pl: "{0} nie został jeszcze odczytany. Zaloguj się do Biblioteki, a zostanie pobrany.",
    lt: "{0} dar nenuskaitytas. Prisijunkite prie bibliotekos ir jis bus gautas." },
  "Siste henting feilet: {0}": {
    en: "Last fetch failed: {0}", pl: "Ostatnie pobranie nie powiodło się: {0}", lt: "Paskutinis gavimas nepavyko: {0}" },
  "Vist fra lagret kopi på denne maskinen – ikke hentet fra SharePoint i denne økten.": {
    en: "Shown from a copy saved on this machine – not fetched from SharePoint in this session.",
    pl: "Pokazane z kopii zapisanej na tym komputerze – nie pobrane z SharePoint w tej sesji.",
    lt: "Rodoma iš šiame kompiuteryje išsaugotos kopijos – šioje sesijoje negauta iš „SharePoint“." },
  "Ansvarlig-lista på markeringer": { en: "Assignee list on markers", pl: "Lista odpowiedzialnych na znacznikach", lt: "Atsakingųjų sąrašas žymekliuose" },
  "Planner-oppgaver": { en: "Planner tasks", pl: "Zadania Planner", lt: "„Planner“ užduotys" },
  "Byggeplass-lenka (standard brukes)": { en: "Site link (default in use)", pl: "Link do budowy (używany domyślny)", lt: "Statybvietės nuoroda (naudojama numatytoji)" },
  "Varsel ved @-nevning (av)": { en: "Notification on @-mention (off)", pl: "Powiadomienie przy @-wzmiance (wył.)", lt: "Pranešimas paminėjus @ (išjungta)" },
  "Fristfarger (standard 8/3)": { en: "Deadline colours (default 8/3)", pl: "Kolory terminów (domyślnie 8/3)", lt: "Termino spalvos (numatyta 8/3)" },
  "Vekt i Mengder (standard 2400/7850)": { en: "Weight in Quantities (default 2400/7850)", pl: "Masa w Ilościach (domyślnie 2400/7850)", lt: "Svoris kiekiuose (numatyta 2400/7850)" },
  "Feltene over leses fra oppsett.json i SharePoint-mappa med modellene. Et felt som mangler er ikke en feil – da brukes standardverdien i koden – men da har du heller ikke kontroll på tallet fra fila. Merk at kopien i prosjektmappa ikke er den verktøyet leser.": {
    en: "The fields above are read from oppsett.json in the SharePoint folder with the models. A missing field is not an error – the default in the code is used – but then you are not in control of the value from the file either. Note that the copy in the project folder is not the one the tool reads.",
    pl: "Powyższe pola są odczytywane z oppsett.json w folderze SharePoint z modelami. Brakujące pole nie jest błędem – używana jest wartość domyślna z kodu – ale wtedy nie kontrolujesz wartości z pliku. Uwaga: kopia w folderze projektu nie jest tą, którą czyta narzędzie.",
    lt: "Aukščiau esantys laukai skaitomi iš oppsett.json „SharePoint“ aplanke su modeliais. Trūkstamas laukas nėra klaida – naudojama numatytoji kodo reikšmė – bet tada nekontroliuojate failo reikšmės. Atkreipkite dėmesį, kad projekto aplanko kopija nėra ta, kurią skaito įrankis." },
  "Uten vekt (stk)": { en: "Without weight (pcs)", pl: "Bez masy (szt.)", lt: "Be svorio (vnt.)" },
  "forskaling": { en: "formwork", pl: "szalunek", lt: "klojiniai" },
  "{0} element uten vekt": {
    en: "{0} elements without weight", pl: "{0} elementów bez masy", lt: "{0} elementai be svorio" },
  "mangler volum eller materiale – ikke med i kg-summen": {
    en: "missing volume or material – not included in the kg total",
    pl: "brak objętości lub materiału – nieuwzględnione w sumie kg",
    lt: "trūksta tūrio ar medžiagos – neįskaičiuota į kg sumą" },

  // ---------- Nettstatus på byggeplassen (js/nett.js) ----------
  "Ingen nett – det du gjør lagres og sendes når du får dekning.": {
    en: "No connection – what you do is saved and sent when you have coverage again.",
    pl: "Brak sieci – to, co robisz, jest zapisywane i zostanie wysłane po odzyskaniu zasięgu.",
    lt: "Nėra ryšio – tai, ką darote, išsaugoma ir bus išsiųsta, kai atsiras ryšys." },
  "{0} ikke sendt": { en: "{0} not sent", pl: "{0} niewysłanych", lt: "{0} neišsiųsta" },
  "Markeringer sist hentet {0}": {
    en: "Markers last fetched {0}", pl: "Znaczniki pobrane ostatnio {0}", lt: "Žymekliai paskutinį kartą gauti {0}" },
  "Ny versjon klar.": { en: "New version ready.", pl: "Nowa wersja gotowa.", lt: "Nauja versija paruošta." },
  "Last inn på nytt": { en: "Reload", pl: "Załaduj ponownie", lt: "Įkelti iš naujo" },
  "Åpne slik den var sist": {
    en: "Open as it was last time", pl: "Otwórz w stanie z ostatniego razu", lt: "Atidaryti tokį, koks buvo paskutinį kartą" },
  "Fikk ikke hentet markeringene. Det du ser kan mangle noe.": {
    en: "Could not fetch the markers. What you see may be incomplete.",
    pl: "Nie udało się pobrać znaczników. To, co widzisz, może być niekompletne.",
    lt: "Nepavyko gauti žymeklių. Tai, ką matote, gali būti nepilna." },
  "Markeringene tok for lang tid å hente. Sjekk dekningen og last siden på nytt.": {
    en: "Fetching the markers took too long. Check your coverage and reload the page.",
    pl: "Pobieranie znaczników trwało zbyt długo. Sprawdź zasięg i odśwież stronę.",
    lt: "Žymeklių gavimas užtruko per ilgai. Patikrinkite ryšį ir perkraukite puslapį." },
  "Modellen svarte ikke. Sjekk dekningen og prøv igjen.": {
    en: "The model did not respond. Check your coverage and try again.",
    pl: "Model nie odpowiedział. Sprawdź zasięg i spróbuj ponownie.",
    lt: "Modelis neatsakė. Patikrinkite ryšį ir bandykite dar kartą." },
  "Nettet svarte ikke. Gå ut dit du har dekning og prøv igjen.": {
    en: "The network did not respond. Move to where you have coverage and try again.",
    pl: "Sieć nie odpowiedziała. Przejdź w miejsce z zasięgiem i spróbuj ponownie.",
    lt: "Tinklas neatsakė. Pereikite ten, kur yra ryšys, ir bandykite dar kartą." },
  "Ligger lagret på telefonen og sendes når du har nett igjen.": { en: "Saved on your phone and will be sent when you are back online.", pl: "Zapisane w telefonie, zostanie wysłane po odzyskaniu połączenia.", lt: "Išsaugota telefone ir bus išsiųsta, kai atsiras ryšys." },
  "Fant ikke {0} i ansattlista, så oppgaven ville ikke fått noen mottaker. Velg en ansvarlig fra lista først.": { en: "Could not find {0} in the staff list, so the task would have had no recipient. Choose a responsible person from the list first.", pl: "Nie znaleziono {0} na liście pracowników, więc zadanie nie miałoby odbiorcy. Najpierw wybierz osobę odpowiedzialną z listy.", lt: "Sąraše nerasta {0}, todėl užduotis neturėtų gavėjo. Pirmiausia pasirinkite atsakingą asmenį iš sąrašo." },
  "Markeringen har ingen ansvarlig. Oppgaven blir liggende i Planner uten mottaker. Fortsette?": { en: "The marking has no responsible person. The task will sit in Planner with no recipient. Continue?", pl: "Oznaczenie nie ma osoby odpowiedzialnej. Zadanie pozostanie w Plannerze bez odbiorcy. Kontynuować?", lt: "Žymė neturi atsakingo asmens. Užduotis liks Planner be gavėjo. Tęsti?" },
  "{0} markeringer har ingen ansvarlig. Oppgavene blir liggende i Planner uten mottaker. Fortsette?": { en: "{0} markings have no responsible person. The tasks will sit in Planner with no recipient. Continue?", pl: "{0} oznaczeń nie ma osoby odpowiedzialnej. Zadania pozostaną w Plannerze bez odbiorcy. Kontynuować?", lt: "{0} žymės neturi atsakingo asmens. Užduotys liks Planner be gavėjo. Tęsti?" },
  "Slett talemeldingen": { en: "Delete the voice memo", pl: "Usuń wiadomość głosową", lt: "Ištrinti balso žinutę" },
  "Slette denne talemeldingen?": { en: "Delete this voice memo?", pl: "Usunąć tę wiadomość głosową?", lt: "Ištrinti šią balso žinutę?" },
  "Navigasjon": { en: "Navigation", pl: "Nawigacja", lt: "Navigacija" },
  "Navigasjonshjul – naviger uten mus": { en: "Navigation wheel – navigate without a mouse", pl: "Koło nawigacji – nawigacja bez myszy", lt: "Navigacijos ratas – naršykite be pelės" },
  "Roter": { en: "Orbit", pl: "Obróć", lt: "Sukti" },
  "Zoom": { en: "Zoom", pl: "Powiększenie", lt: "Mastelis" },
  "Panorer": { en: "Pan", pl: "Przesuń", lt: "Slinkti" },
  "Angre visning": { en: "Rewind view", pl: "Cofnij widok", lt: "Atšaukti vaizdą" },
  "Sentrer på et punkt": { en: "Centre on a point", pl: "Wyśrodkuj na punkcie", lt: "Centruoti į tašką" },
  "Trykk i modellen for å sette nytt midtpunkt": { en: "Tap in the model to set a new centre point", pl: "Kliknij w modelu, aby ustawić nowy punkt środkowy", lt: "Spustelėkite modelyje, kad nustatytumėte naują centrą" },
  "Talemelding": { en: "Voice memo", pl: "Wiadomość głosowa", lt: "Balso žinutė" },
  "Ta opp talemelding": { en: "Record voice memo", pl: "Nagraj wiadomość głosową", lt: "Įrašyti balso žinutę" },
  "Stopp": { en: "Stop", pl: "Zatrzymaj", lt: "Sustabdyti" },
  "Sender talemeldingen …": { en: "Sending the voice memo …", pl: "Wysyłanie wiadomości głosowej …", lt: "Siunčiama balso žinutė …" },
  "Talemeldingen er sendt. Den blir synlig for prosjektlederen neste gang han åpner modellen.": { en: "The voice memo has been sent. The project manager will see it the next time the model is opened.", pl: "Wiadomość głosowa została wysłana. Kierownik projektu zobaczy ją przy następnym otwarciu modelu.", lt: "Balso žinutė išsiųsta. Projekto vadovas ją pamatys kitą kartą atidaręs modelį." },
  "Denne nettleseren kan ikke ta opp lyd.": { en: "This browser cannot record audio.", pl: "Ta przeglądarka nie może nagrywać dźwięku.", lt: "Ši naršyklė negali įrašyti garso." },
  "Mikrofonen er avslått for denne siden. Slå den på i nettleserens innstillinger for nettstedet, og prøv igjen.": { en: "The microphone is blocked for this site. Enable it in your browser's site settings and try again.", pl: "Mikrofon jest zablokowany dla tej witryny. Włącz go w ustawieniach witryny w przeglądarce i spróbuj ponownie.", lt: "Mikrofonas šiai svetainei užblokuotas. Įjunkite jį naršyklės svetainės nustatymuose ir bandykite dar kartą." },
  "Fikk ikke startet opptaket: ": { en: "Could not start the recording: ", pl: "Nie udało się rozpocząć nagrywania: ", lt: "Nepavyko pradėti įrašymo: " },
  "Klarte ikke å sende talemeldingen: ": { en: "Could not send the voice memo: ", pl: "Nie udało się wysłać wiadomości głosowej: ", lt: "Nepavyko išsiųsti balso žinutės: " },
  "Talemeldinger lagres i SharePoint, så du må være innlogget. Åpne Biblioteket og logg inn, så prøv igjen.": { en: "Voice memos are stored in SharePoint, so you need to be signed in. Open the Library, sign in and try again.", pl: "Wiadomości głosowe są przechowywane w SharePoint, więc musisz być zalogowany. Otwórz Bibliotekę, zaloguj się i spróbuj ponownie.", lt: "Balso žinutės saugomos SharePoint, todėl turite būti prisijungę. Atidarykite Biblioteką, prisijunkite ir bandykite dar kartą." },
  "En markering kan ha maks {0} talemeldinger.": { en: "A marking can have at most {0} voice memos.", pl: "Oznaczenie może mieć maksymalnie {0} wiadomości głosowych.", lt: "Žymė gali turėti daugiausia {0} balso žinučių." },
  "Logg inn for å høre opptaket": { en: "Sign in to play the recording", pl: "Zaloguj się, aby odsłuchać nagranie", lt: "Prisijunkite, kad paklausytumėte įrašo" },
  "Fikk ikke sendt filen": { en: "Could not send the file", pl: "Nie udało się wysłać pliku", lt: "Nepavyko išsiųsti failo" },
  "Slipp IFC- eller .glb-fila her": { en: "Drop the IFC or .glb file here", pl: "Upuść tutaj plik IFC lub .glb", lt: "Numeskite IFC arba .glb failą čia" },
  "Fortsett med": { en: "Continue with", pl: "Kontynuuj z", lt: "Tęsti su" },
  "Din maskin": { en: "Your computer", pl: "Twój komputer", lt: "Jūsų kompiuteris" },
  " – må velges på nytt": { en: " – must be chosen again", pl: " – trzeba wybrać ponownie", lt: " – reikia pasirinkti iš naujo" },
  "glem": { en: "forget", pl: "zapomnij", lt: "pamiršti" },
  "sist åpnet i dag": { en: "last opened today", pl: "ostatnio otwarty dzisiaj", lt: "paskutinį kartą atidarytas šiandien" },
  "sist åpnet i går": { en: "last opened yesterday", pl: "ostatnio otwarty wczoraj", lt: "paskutinį kartą atidarytas vakar" },
  "sist åpnet for {0} dager siden": { en: "last opened {0} days ago", pl: "ostatnio otwarty {0} dni temu", lt: "paskutinį kartą atidarytas prieš {0} d." },
  "sist åpnet {0}": { en: "last opened {0}", pl: "ostatnio otwarty {0}", lt: "paskutinį kartą atidarytas {0}" },

  // ---------- Paneloverskrifter ----------
  "Egenskaper": { en: "Properties", pl: "Właściwości", lt: "Savybės" },
  "Markeringer": { en: "Markers", pl: "Znaczniki", lt: "Žymekliai" },
  "Modellbibliotek": { en: "Model library", pl: "Biblioteka modeli", lt: "Modelių biblioteka" },
  "Aksesystem": { en: "Grid system", pl: "Układ osi", lt: "Ašių sistema" },
  "Sammenlign versjoner": { en: "Compare versions", pl: "Porównaj wersje", lt: "Palyginti versijas" },
  "Snitt-boks": { en: "Section box", pl: "Pole przekroju", lt: "Pjūvio dėžė" },
  "Elementsøk": { en: "Element search", pl: "Wyszukiwanie elementów", lt: "Elementų paieška" },

  // ---------- Ny markering-dialogen ----------
  "Ny markering": { en: "New marker", pl: "Nowy znacznik", lt: "Naujas žymeklis" },
  "Skriv en kommentar …": { en: "Write a comment …", pl: "Napisz komentarz …", lt: "Rašykite komentarą …" },
  "Legg ved bilde (før)": { en: "Attach photo (before)", pl: "Dodaj zdjęcie (przed)", lt: "Pridėti nuotrauką (prieš)" },
  "Avbryt": { en: "Cancel", pl: "Anuluj", lt: "Atšaukti" },
  "Lagre": { en: "Save", pl: "Zapisz", lt: "Išsaugoti" },
  "1 bilde valgt": { en: "1 photo selected", pl: "1 zdjęcie wybrane", lt: "Pasirinkta 1 nuotrauka" },
  "{0} bilder valgt": { en: "{0} photos selected", pl: "Wybrano zdjęć: {0}", lt: "Pasirinkta nuotraukų: {0}" },

  // ---------- Markeringer: status, felt og liste ----------
  "Åpen": { en: "Open", pl: "Otwarty", lt: "Atviras" },
  "Pågår": { en: "In progress", pl: "W toku", lt: "Vykdoma" },
  "Løst": { en: "Resolved", pl: "Rozwiązany", lt: "Išspręsta" },
  "Alle": { en: "All", pl: "Wszystkie", lt: "Visi" },
  "Status": { en: "Status", pl: "Status", lt: "Būsena" },
  "Ansvarlig": { en: "Assignee", pl: "Odpowiedzialny", lt: "Atsakingas" },
  "Frist": { en: "Deadline", pl: "Termin", lt: "Terminas" },
  "– ingen –": { en: "– none –", pl: "– brak –", lt: "– nėra –" },
  "Fristen er gått": { en: "Deadline passed", pl: "Termin minął", lt: "Terminas praėjo" },

  // ---------- Hastegrad ut fra frist (ringen rundt markeringen) ----------
  // Navnene brukes både på filterknappene og som forklaring på prikken i lista.
  "God tid": { en: "Plenty of time", pl: "Dużo czasu", lt: "Daug laiko" },
  "Nærmer seg": { en: "Approaching", pl: "Zbliża się", lt: "Artėja" },
  "Haster": { en: "Urgent", pl: "Pilne", lt: "Skubu" },
  "Forfalt": { en: "Overdue", pl: "Po terminie", lt: "Pradelsta" },
  "Ingen frist": { en: "No deadline", pl: "Brak terminu", lt: "Nėra termino" },
  "Forfaller i dag": { en: "Due today", pl: "Termin dzisiaj", lt: "Terminas šiandien" },
  "Forfaller i morgen": { en: "Due tomorrow", pl: "Termin jutro", lt: "Terminas rytoj" },
  "Forfaller om {0} dager": { en: "Due in {0} days", pl: "Termin za {0} dni", lt: "Terminas po {0} d." },
  "Forfalt for {0} dager siden": { en: "Overdue by {0} days", pl: "Po terminie o {0} dni", lt: "Pradelsta {0} d." },

  // ---------- Fristgrenser i ⚙ Innstillinger ----------
  "Frister": { en: "Deadlines", pl: "Terminy", lt: "Terminai" },
  "Gul ring fra (dager igjen)": { en: "Yellow ring from (days left)", pl: "Żółty pierścień od (dni)", lt: "Geltonas žiedas nuo (d.)" },
  "Rød ring fra (dager igjen)": { en: "Red ring from (days left)", pl: "Czerwony pierścień od (dni)", lt: "Raudonas žiedas nuo (d.)" },
  "Gjelder hele Storm. Varig endring gjøres i oppsett.json i SharePoint — her gjelder den bare til siden lastes på nytt.": {
    en: "Applies to all of Storm. Change it permanently in oppsett.json in SharePoint — here it only lasts until the page reloads.",
    pl: "Dotyczy całej firmy Storm. Trwałą zmianę wprowadza się w oppsett.json w SharePoint — tutaj obowiązuje tylko do przeładowania strony.",
    lt: "Galioja visai „Storm“. Nuolatinis pakeitimas daromas oppsett.json faile „SharePoint“ — čia galioja tik iki puslapio perkrovimo." },

  // ---------- Frist i «Ny markering» ----------
  "ingen frist": { en: "no deadline", pl: "brak terminu", lt: "nėra termino" },
  "Gå til": { en: "Go to", pl: "Przejdź do", lt: "Eiti į" },
  "Se oppgave": { en: "View task", pl: "Zobacz zadanie", lt: "Žiūrėti užduotį" },
  "Slett": { en: "Delete", pl: "Usuń", lt: "Ištrinti" },
  "Åpne oppgaven i Planner": { en: "Open the task in Planner", pl: "Otwórz zadanie w Plannerze", lt: "Atidaryti užduotį „Planner“" },
  "Lag Teams Planner-oppgave": { en: "Create a Teams Planner task", pl: "Utwórz zadanie Teams Planner", lt: "Sukurti „Teams Planner“ užduotį" },
  "Har en Planner-oppgave": { en: "Has a Planner task", pl: "Ma zadanie w Plannerze", lt: "Turi „Planner“ užduotį" },
  "· frist ": { en: "· due ", pl: "· termin ", lt: "· terminas " },
  "gått": { en: "passed", pl: "minął", lt: "praėjo" },
  "(før/etter)": { en: "(before/after)", pl: "(przed/po)", lt: "(prieš/po)" },
  "Før": { en: "Before", pl: "Przed", lt: "Prieš" },
  "Etter": { en: "After", pl: "Po", lt: "Po" },
  "Ingen markeringer ennå. Trykk på Markering og deretter på modellen.": {
    en: "No markers yet. Tap Marker and then tap the model.",
    pl: "Brak znaczników. Dotknij Znacznik, a potem modelu.",
    lt: "Žymeklių dar nėra. Spustelėkite Žymeklis, tada modelį." },
  "Ingen markeringer med status «{0}».": { en: "No markers with status “{0}”.", pl: "Brak znaczników o statusie „{0}”.", lt: "Nėra žymeklių su būsena „{0}“." },
  "Delt via SharePoint – alle med tilgang ser disse": {
    en: "Shared via SharePoint – everyone with access sees these",
    pl: "Udostępnione przez SharePoint – widzą je wszyscy z dostępem",
    lt: "Bendrinama per „SharePoint“ – mato visi, turintys prieigą" },
  "Kun lagret på denne enheten – logg inn i Biblioteket for å dele": {
    en: "Only stored on this device – sign in via the Library to share",
    pl: "Zapisane tylko na tym urządzeniu – zaloguj się w Bibliotece, aby udostępnić",
    lt: "Išsaugota tik šiame įrenginyje – prisijunkite bibliotekoje, kad bendrintumėte" },
  "Lag {0} Planner-oppgaver": { en: "Create {0} Planner tasks", pl: "Utwórz {0} zadań Planner", lt: "Sukurti {0} „Planner“ užduočių" },
  "Markeringen mangler frist.": { en: "The marker has no deadline.", pl: "Znacznik nie ma terminu.", lt: "Žymeklis neturi termino." },
  "{0} markeringer mangler frist.": { en: "{0} markers have no deadline.", pl: "{0} znaczników nie ma terminu.", lt: "{0} žymeklių neturi termino." },
  " Sett frist først – Planner-oppgaven trenger en dato.": {
    en: " Set a deadline first – the Planner task needs a date.",
    pl: " Najpierw ustaw termin – zadanie Planner wymaga daty.",
    lt: " Pirmiausia nustatykite terminą – „Planner“ užduočiai reikia datos." },
  "Denne markeringen har allerede en Planner-oppgave. Lage en ny?": {
    en: "This marker already has a Planner task. Create a new one?",
    pl: "Ten znacznik ma już zadanie Planner. Utworzyć nowe?",
    lt: "Šis žymeklis jau turi „Planner“ užduotį. Sukurti naują?" },
  "{0} av markeringene har allerede oppgaver. Lage nye for alle?": {
    en: "{0} of the markers already have tasks. Create new ones for all?",
    pl: "{0} znaczników ma już zadania. Utworzyć nowe dla wszystkich?",
    lt: "{0} žymeklių jau turi užduotis. Sukurti naujas visiems?" },
  "Lager Planner-oppgave …": { en: "Creating Planner task …", pl: "Tworzenie zadania Planner …", lt: "Kuriama „Planner“ užduotis …" },
  "Lager Planner-oppgave {0} av {1} …": { en: "Creating Planner task {0} of {1} …", pl: "Tworzenie zadania Planner {0} z {1} …", lt: "Kuriama „Planner“ užduotis {0} iš {1} …" },
  "{0} opprettet i Planner.\n\nÅpne Planner-tavla nå?": {
    en: "{0} created in Planner.\n\nOpen the Planner board now?",
    pl: "Utworzono w Plannerze: {0}.\n\nOtworzyć tablicę Planner?",
    lt: "Sukurta „Planner“: {0}.\n\nAtidaryti „Planner“ lentą?" },
  "oppgave": { en: "task", pl: "zadanie", lt: "užduotis" },
  "oppgaver": { en: "tasks", pl: "zadania", lt: "užduotys" },
  "Planner nektet. Vanligste årsak: den ansvarlige er ikke medlem av gruppen som eier planen.": {
    en: "Planner refused. Most common cause: the assignee is not a member of the group that owns the plan.",
    pl: "Planner odmówił. Najczęstsza przyczyna: odpowiedzialny nie jest członkiem grupy będącej właścicielem planu.",
    lt: "„Planner“ atmetė. Dažniausia priežastis: atsakingas nėra plano savininkų grupės narys." },
  "Klarte ikke å lage Planner-oppgave: ": { en: "Could not create Planner task: ", pl: "Nie udało się utworzyć zadania Planner: ", lt: "Nepavyko sukurti „Planner“ užduoties: " },
  "For å lage Planner-oppgaver må du gi Storm IFC-Viewer tilgang til oppgavene dine – det skjer én gang. Siden lastes på nytt, så modellen må åpnes igjen etterpå («Fortsett med …» på startskjermen).\n\nFortsette?": {
    en: "To create Planner tasks you must grant Storm IFC-Viewer access to your tasks – this happens once. The page reloads, so the model must be opened again afterwards (“Continue with …” on the start screen).\n\nContinue?",
    pl: "Aby tworzyć zadania Planner, musisz jednorazowo dać Storm IFC-Viewer dostęp do swoich zadań. Strona przeładuje się, więc model trzeba będzie otworzyć ponownie („Kontynuuj z …” na ekranie startowym).\n\nKontynuować?",
    lt: "Norėdami kurti „Planner“ užduotis, turite vieną kartą suteikti „Storm IFC-Viewer“ prieigą prie savo užduočių. Puslapis bus perkrautas, todėl modelį reikės atidaryti iš naujo („Tęsti su …“ pradžios ekrane).\n\nTęsti?" },
  "Kunne ikke fullføre Planner-oppgaven:": { en: "Could not complete the Planner task:", pl: "Nie udało się ukończyć zadania Planner:", lt: "Nepavyko užbaigti „Planner“ užduoties:" },

  // ---------- Bilder på markeringer ----------
  "Ta bilde eller velg fil ({0})": { en: "Take a photo or choose a file ({0})", pl: "Zrób zdjęcie lub wybierz plik ({0})", lt: "Nufotografuokite arba pasirinkite failą ({0})" },
  "Åpne bildet": { en: "Open the photo", pl: "Otwórz zdjęcie", lt: "Atidaryti nuotrauką" },
  "Logg inn for å se bildet": { en: "Sign in to see the photo", pl: "Zaloguj się, aby zobaczyć zdjęcie", lt: "Prisijunkite, kad pamatytumėte nuotrauką" },
  "Fant ingen bildefiler blant det du valgte.": { en: "No image files among what you selected.", pl: "Wśród wybranych nie ma plików graficznych.", lt: "Tarp pasirinktų nėra nuotraukų failų." },
  "Hver seksjon kan ha maks {0} bilder.": { en: "Each section can have at most {0} photos.", pl: "Każda sekcja może mieć maks. {0} zdjęć.", lt: "Kiekviena sekcija gali turėti daugiausiai {0} nuotraukų." },
  "Laster opp {0} bilder …": { en: "Uploading {0} photos …", pl: "Wysyłanie {0} zdjęć …", lt: "Įkeliama nuotraukų: {0} …" },
  "Laster opp bildet …": { en: "Uploading the photo …", pl: "Wysyłanie zdjęcia …", lt: "Įkeliama nuotrauka …" },
  "Bilder lagres i SharePoint, så du må være innlogget. Åpne Biblioteket og logg inn, så prøv igjen.": {
    en: "Photos are stored in SharePoint, so you must be signed in. Open the Library, sign in, and try again.",
    pl: "Zdjęcia są zapisywane w SharePoint, więc musisz być zalogowany. Otwórz Bibliotekę, zaloguj się i spróbuj ponownie.",
    lt: "Nuotraukos saugomos „SharePoint“, todėl turite būti prisijungę. Atidarykite biblioteką, prisijunkite ir bandykite dar kartą." },
  "Klarte ikke å legge ved bildet: ": { en: "Could not attach the photo: ", pl: "Nie udało się dodać zdjęcia: ", lt: "Nepavyko pridėti nuotraukos: " },
  "Klarte ikke å lage bildefil av dette bildet": { en: "Could not make an image file from this photo", pl: "Nie udało się utworzyć pliku z tego zdjęcia", lt: "Nepavyko sukurti failo iš šios nuotraukos" },
  "Kunne ikke lese bildefilen": { en: "Could not read the image file", pl: "Nie udało się odczytać pliku graficznego", lt: "Nepavyko nuskaityti nuotraukos failo" },
  "Zoom ut (−)": { en: "Zoom out (−)", pl: "Pomniejsz (−)", lt: "Mažinti (−)" },
  "Zoom inn (+)": { en: "Zoom in (+)", pl: "Powiększ (+)", lt: "Didinti (+)" },
  "Tilpass til skjermen (0)": { en: "Fit to screen (0)", pl: "Dopasuj do ekranu (0)", lt: "Pritaikyti prie ekrano (0)" },
  "Lukk (Esc)": { en: "Close (Esc)", pl: "Zamknij (Esc)", lt: "Uždaryti (Esc)" },
  "Forrige bilde (←)": { en: "Previous image (←)", pl: "Poprzednie zdjęcie (←)", lt: "Ankstesnė nuotrauka (←)" },
  "Neste bilde (→)": { en: "Next image (→)", pl: "Następne zdjęcie (→)", lt: "Kita nuotrauka (→)" },
  "{0} av {1}": { en: "{0} of {1}", pl: "{0} z {1}", lt: "{0} iš {1}" },

  // ---------- Arbeidstegninger ----------
  "Arbeidstegninger": { en: "Drawings", pl: "Rysunki", lt: "Brėžiniai" },
  "Legg til arbeidstegning": { en: "Add drawing", pl: "Dodaj rysunek", lt: "Pridėti brėžinį" },

  // ---------- ✏️ Redigering og 💬 kommentarer på en markering ----------
  "Endre teksten": { en: "Edit the text", pl: "Edytuj tekst", lt: "Redaguoti tekstą" },
  "(endret {0})": { en: "(edited {0})", pl: "(edytowano {0})", lt: "(redaguota {0})" },
  "(endret av {0} {1})": { en: "(edited by {0} {1})", pl: "(edytowane przez {0} {1})", lt: "(redagavo {0} {1})" },
  "Kommentarer": { en: "Comments", pl: "Komentarze", lt: "Komentarai" },
  "Skriv en kommentar": { en: "Write a comment", pl: "Napisz komentarz", lt: "Rašyti komentarą" },
  "Endre kommentaren": { en: "Edit the comment", pl: "Edytuj komentarz", lt: "Redaguoti komentarą" },
  "Slett kommentaren": { en: "Delete the comment", pl: "Usuń komentarz", lt: "Ištrinti komentarą" },
  "Slette denne kommentaren?": { en: "Delete this comment?", pl: "Usunąć ten komentarz?", lt: "Ištrinti šį komentarą?" },
  "{0} kommentarer": { en: "{0} comments", pl: "Komentarze: {0}", lt: "Komentarai: {0}" },
  "Åpne {0}": { en: "Open {0}", pl: "Otwórz {0}", lt: "Atidaryti {0}" },
  "Fjern henvisningen (tegningen slettes ikke)": { en: "Remove the reference (the drawing is not deleted)", pl: "Usuń odwołanie (rysunek nie zostanie usunięty)", lt: "Pašalinti nuorodą (brėžinys neištrinamas)" },
  "Henter tegninger fra SharePoint …": { en: "Fetching drawings from SharePoint …", pl: "Pobieranie rysunków z SharePoint …", lt: "Gaunami brėžiniai iš „SharePoint“ …" },
  "Henter tegninger …": { en: "Fetching drawings …", pl: "Pobieranie rysunków …", lt: "Gaunami brėžiniai …" },
  "Tegningene ligger i SharePoint, så du må være innlogget. Åpne Biblioteket og logg inn.": {
    en: "The drawings are in SharePoint, so you must be signed in. Open the Library and sign in.",
    pl: "Rysunki są w SharePoint, więc musisz być zalogowany. Otwórz Bibliotekę i zaloguj się.",
    lt: "Brėžiniai yra „SharePoint“, todėl turite būti prisijungę. Atidarykite biblioteką ir prisijunkite." },
  "Fant ingen tegningsmappe for «{0}». Mappa skal ligge i <b>{1}</b>.": {
    en: "No drawing folder found for “{0}”. The folder should be in <b>{1}</b>.",
    pl: "Nie znaleziono folderu rysunków dla „{0}”. Folder powinien być w <b>{1}</b>.",
    lt: "Nerastas brėžinių aplankas „{0}“. Aplankas turi būti <b>{1}</b>." },
  "Velg mappa som hører til denne modellen:": { en: "Choose the folder that belongs to this model:", pl: "Wybierz folder należący do tego modelu:", lt: "Pasirinkite šiam modeliui priklausantį aplanką:" },
  "Det ligger ingen mapper der ennå.": { en: "There are no folders there yet.", pl: "Nie ma tam jeszcze folderów.", lt: "Ten dar nėra aplankų." },
  "Mappa <b>{0}</b> er tom. Legg PDF-ene inn i {1}.": {
    en: "The folder <b>{0}</b> is empty. Put the PDFs in {1}.",
    pl: "Folder <b>{0}</b> jest pusty. Umieść PDF-y w {1}.",
    lt: "Aplankas <b>{0}</b> tuščias. Įdėkite PDF failus į {1}." },
  "{0} tegninger": { en: "{0} drawings", pl: "Rysunków: {0}", lt: "Brėžinių: {0}" },
  "Søk etter tegning …": { en: "Search for a drawing …", pl: "Szukaj rysunku …", lt: "Ieškoti brėžinio …" },
  "Side": { en: "Page", pl: "Strona", lt: "Puslapis" },
  "Legg ved": { en: "Attach", pl: "Dodaj", lt: "Pridėti" },
  "stor fil": { en: "large file", pl: "duży plik", lt: "didelis failas" },
  "Ingen treff.": { en: "No matches.", pl: "Brak wyników.", lt: "Nėra atitikmenų." },
  "Du må være innlogget for å åpne tegninger fra SharePoint.": {
    en: "You must be signed in to open drawings from SharePoint.",
    pl: "Musisz być zalogowany, aby otwierać rysunki z SharePoint.",
    lt: "Turite būti prisijungę, kad atidarytumėte brėžinius iš „SharePoint“." },
  "Klarte ikke å åpne tegningen: ": { en: "Could not open the drawing: ", pl: "Nie udało się otworzyć rysunku: ", lt: "Nepavyko atidaryti brėžinio: " },
  " · side ": { en: " · page ", pl: " · strona ", lt: " · puslapis " },
  " · s. ": { en: " · p. ", pl: " · s. ", lt: " · p. " },
  "{0} er {1} MB. Over mobilnett kan nedlastingen ta et minutt. Åpne likevel?": {
    en: "{0} is {1} MB. On mobile data the download can take a minute. Open anyway?",
    pl: "{0} ma {1} MB. Przez sieć komórkową pobieranie może potrwać minutę. Otworzyć mimo to?",
    lt: "{0} yra {1} MB. Mobiliuoju ryšiu atsisiuntimas gali užtrukti minutę. Vis tiek atidaryti?" },
  "Henter {0} …": { en: "Fetching {0} …", pl: "Pobieranie {0} …", lt: "Gaunama {0} …" },
  "Åpner {0} …": { en: "Opening {0} …", pl: "Otwieranie {0} …", lt: "Atidaroma {0} …" },
  "Tegner side {0} …": { en: "Rendering page {0} …", pl: "Rysowanie strony {0} …", lt: "Braižomas puslapis {0} …" },
  "Tegningen finnes ikke i SharePoint lenger": { en: "The drawing no longer exists in SharePoint", pl: "Rysunek już nie istnieje w SharePoint", lt: "Brėžinio „SharePoint“ nebėra" },
  "Klarte ikke å tegne siden": { en: "Could not render the page", pl: "Nie udało się narysować strony", lt: "Nepavyko nubraižyti puslapio" },
  "Ingen modell er åpen": { en: "No model is open", pl: "Żaden model nie jest otwarty", lt: "Neatidarytas joks modelis" },

  // ---------- Egenskaper / valg ----------
  "Skjul element": { en: "Hide element", pl: "Ukryj element", lt: "Slėpti elementą" },
  "Lett kopi – åpne original-IFC-en for full egenskapsliste": {
    en: "Light copy – open the original IFC for the full property list",
    pl: "Lekka kopia – otwórz oryginalny IFC, aby zobaczyć pełną listę właściwości",
    lt: "Lengvoji kopija – atidarykite originalų IFC visam savybių sąrašui" },
  "Kunne ikke lese egenskaper": { en: "Could not read properties", pl: "Nie udało się odczytać właściwości", lt: "Nepavyko nuskaityti savybių" },
  "Feil": { en: "Error", pl: "Błąd", lt: "Klaida" },
  "Materiale": { en: "Material", pl: "Materiał", lt: "Medžiaga" },
  "Mål L×B×H (ca)": { en: "Size L×W×H (approx.)", pl: "Wymiary D×S×W (ok.)", lt: "Matmenys I×P×A (apyt.)" },
  "Areal, fotavtrykk (ca)": { en: "Area, footprint (approx.)", pl: "Powierzchnia rzutu (ok.)", lt: "Plotas, projekcija (apyt.)" },
  "Volum (ca)": { en: "Volume (approx.)", pl: "Objętość (ok.)", lt: "Tūris (apyt.)" },
  "Merk": { en: "Mark", pl: "Oznaczenie", lt: "Žymuo" },
  "Merk: ": { en: "Mark: ", pl: "Oznaczenie: ", lt: "Žymuo: " },
  "{0} elementer valgt": { en: "{0} elements selected", pl: "Wybrano elementów: {0}", lt: "Pasirinkta elementų: {0}" },
  "Sum volum": { en: "Total volume", pl: "Suma objętości", lt: "Bendras tūris" },
  "Sum areal (fotavtrykk)": { en: "Total area (footprint)", pl: "Suma powierzchni (rzut)", lt: "Bendras plotas (projekcija)" },
  "Sum lengde (lengste mål)": { en: "Total length (longest dimension)", pl: "Suma długości (najdłuższy wymiar)", lt: "Bendras ilgis (ilgiausias matmuo)" },
  "Antall": { en: "Count", pl: "Liczba", lt: "Kiekis" },
  " stk": { en: " pcs", pl: " szt.", lt: " vnt." },
  "… og {0} til (summene øverst gjelder alle).": { en: "… and {0} more (the totals above cover all).", pl: "… i jeszcze {0} (sumy powyżej obejmują wszystkie).", lt: "… ir dar {0} (sumos viršuje apima visus)." },
  "… og {0} til (summene øverst gjelder alle). Endre grensen i ⚙ Innstillinger → Visning.": {
    en: "… and {0} more (the totals above cover all). Change the limit in ⚙ Settings → Display.",
    pl: "… i jeszcze {0} (sumy powyżej obejmują wszystkie). Zmień limit w ⚙ Ustawienia → Widok.",
    lt: "… ir dar {0} (sumos viršuje apima visus). Ribą keiskite ⚙ Nustatymai → Rodymas." },
  "Shift-klikk legger til/fjerner. Shift + dra lager markeringsboks: mot høyre = kun synlige, mot venstre = alt i boksen. Vanlig klikk nullstiller.": {
    en: "Shift-click adds/removes. Shift + drag makes a selection box: to the right = visible only, to the left = everything in the box. A normal click resets.",
    pl: "Shift-klik dodaje/usuwa. Shift + przeciągnięcie tworzy ramkę: w prawo = tylko widoczne, w lewo = wszystko w ramce. Zwykły klik resetuje.",
    lt: "„Shift“ + spustelėjimas prideda/pašalina. „Shift“ + vilkimas kuria žymėjimo langelį: į dešinę = tik matomi, į kairę = viskas langelyje. Paprastas spustelėjimas atstato." },

  // ---------- Søk ----------
  "Bygger søkeindeks …": { en: "Building search index …", pl: "Budowanie indeksu wyszukiwania …", lt: "Kuriamas paieškos indeksas …" },
  "Navn, merke, profil eller ID …": { en: "Name, mark, profile or ID …", pl: "Nazwa, oznaczenie, profil lub ID …", lt: "Pavadinimas, žymuo, profilis ar ID …" },
  "Skriv minst 2 tegn – søker i navn, merke (Tag), profil og ExpressID. {0} elementer i indeksen.": {
    en: "Type at least 2 characters – searches name, mark (Tag), profile and ExpressID. {0} elements in the index.",
    pl: "Wpisz co najmniej 2 znaki – szuka w nazwie, oznaczeniu (Tag), profilu i ExpressID. Elementów w indeksie: {0}.",
    lt: "Įveskite bent 2 simbolius – ieško pavadinime, žymenyje (Tag), profilyje ir ExpressID. Indekse elementų: {0}." },
  "Ingen treff på «{0}».": { en: "No matches for “{0}”.", pl: "Brak wyników dla „{0}”.", lt: "Nėra atitikmenų „{0}“." },
  "Viser 50 av {0} treff – skriv mer for å avgrense.": { en: "Showing 50 of {0} matches – type more to narrow down.", pl: "Pokazano 50 z {0} wyników – wpisz więcej, aby zawęzić.", lt: "Rodoma 50 iš {0} atitikmenų – įveskite daugiau, kad susiaurintumėte." },

  // ---------- Mengder ----------
  "Regner ut mengder …": { en: "Calculating quantities …", pl: "Obliczanie ilości …", lt: "Skaičiuojami kiekiai …" },
  "Objekttype": { en: "Object type", pl: "Typ obiektu", lt: "Objekto tipas" },
  "Alle typer ({0} stk)": { en: "All types ({0} pcs)", pl: "Wszystkie typy ({0} szt.)", lt: "Visi tipai ({0} vnt.)" },
  "Alle materialer ({0} stk)": { en: "All materials ({0} pcs)", pl: "Wszystkie materiały ({0} szt.)", lt: "Visos medžiagos ({0} vnt.)" },
  "Materialgrupper": { en: "Material groups", pl: "Grupy materiałów", lt: "Medžiagų grupės" },
  "Nøyaktige navn": { en: "Exact names", pl: "Dokładne nazwy", lt: "Tikslūs pavadinimai" },
  "Grupper (CSV)": { en: "Groups (CSV)", pl: "Grupy (CSV)", lt: "Grupės (CSV)" },
  "Alle elementer": { en: "All elements", pl: "Wszystkie elementy", lt: "Visi elementai" },
  "Kopier": { en: "Copy", pl: "Kopiuj", lt: "Kopijuoti" },
  "Kopiert": { en: "Copied", pl: "Skopiowano", lt: "Nukopijuota" },
  "Én rad per gruppe, bare valgt objekttype": { en: "One row per group, selected object type only", pl: "Jeden wiersz na grupę, tylko wybrany typ", lt: "Viena eilutė grupei, tik pasirinktas tipas" },
  "Én rad per element – for mengdeberegning og vareordre": { en: "One row per element – for take-off and ordering", pl: "Jeden wiersz na element – do przedmiaru i zamówień", lt: "Viena eilutė elementui – kiekiams ir užsakymams" },
  "Lim rett inn i et åpent regneark": { en: "Paste straight into an open spreadsheet", pl: "Wklej prosto do otwartego arkusza", lt: "Įklijuokite tiesiai į atvirą skaičiuoklę" },
  "Klarte ikke å kopiere. Bruk Grupper (CSV) i stedet.": { en: "Could not copy. Use Groups (CSV) instead.", pl: "Nie udało się skopiować. Użyj Grupy (CSV).", lt: "Nepavyko nukopijuoti. Naudokite Grupės (CSV)." },
  "Antall desimaler settes i Innstillinger. Velg objekttype og materiale for å få ett ark om gangen – nedlastingen inneholder bare det som står i lista nå (f.eks. Søyler + Betong gir bare betongsøylene). Materialgruppene samler navn som betyr det samme: «B35», «C35/45» og «Concrete» havner alle under Betong. Mangler materiale på et element, står det ikke i IFC-fila. Lengde = lengste mål per element (ca-verdi, summert per gruppe). Areal = fotavtrykk, altså grunnflaten sett rett ovenfra – det målet dekker, plater og fundamenter bestilles etter. Volum er regnet ut av geometrien og gjelder lukkede volumer – hule profiler blir riktige, flater uten tykkelse blir 0.": {
    en: "Decimals are set in Settings. Choose object type and material to get one sheet at a time – the download contains only what the list shows now (e.g. Columns + Concrete gives only the concrete columns). Material groups gather names that mean the same: “B35”, “C35/45” and “Concrete” all end up under Concrete. If an element has no material, it is not in the IFC file. Length = longest dimension per element (approx., summed per group). Area = footprint, i.e. the plan area seen from above – the measure slabs and foundations are ordered by. Volume is computed from the geometry and applies to closed volumes – hollow profiles come out right, zero-thickness surfaces become 0.",
    pl: "Liczbę miejsc dziesiętnych ustawia się w Ustawieniach. Wybierz typ obiektu i materiał, aby otrzymać jeden arkusz naraz – pobranie zawiera tylko to, co jest teraz na liście (np. Słupy + Beton daje tylko słupy żelbetowe). Grupy materiałów łączą nazwy o tym samym znaczeniu: „B35”, „C35/45” i „Concrete” trafiają do grupy Beton. Jeśli element nie ma materiału, nie ma go w pliku IFC. Długość = najdłuższy wymiar elementu (ok., sumowany w grupie). Powierzchnia = rzut z góry – miara, według której zamawia się stropy i fundamenty. Objętość jest liczona z geometrii i dotyczy brył zamkniętych – profile puste wychodzą poprawnie, powierzchnie bez grubości dają 0.",
    lt: "Dešimtainiai skaičiai nustatomi Nustatymuose. Pasirinkite objekto tipą ir medžiagą, kad gautumėte po vieną lapą – atsisiuntime yra tik tai, kas dabar sąraše (pvz., Kolonos + Betonas duoda tik betonines kolonas). Medžiagų grupės sujungia tą patį reiškiančius pavadinimus: „B35“, „C35/45“ ir „Concrete“ patenka į Betonas. Jei elementas neturi medžiagos, jos nėra IFC faile. Ilgis = ilgiausias elemento matmuo (apyt., sumuojamas grupėje). Plotas = projekcija iš viršaus – matas, pagal kurį užsakomos perdangos ir pamatai. Tūris skaičiuojamas iš geometrijos ir galioja uždariems tūriams – tuščiaviduriai profiliai teisingi, paviršiai be storio tampa 0." },
  // CSV-kolonner
  "Gruppe": { en: "Group", pl: "Grupa", lt: "Grupė" },
  "Type": { en: "Type", pl: "Typ", lt: "Tipas" },
  "Antall (stk)": { en: "Count (pcs)", pl: "Liczba (szt.)", lt: "Kiekis (vnt.)" },
  "Sum lengde (m)": { en: "Total length (m)", pl: "Suma długości (m)", lt: "Bendras ilgis (m)" },
  "Areal (m2)": { en: "Area (m2)", pl: "Powierzchnia (m2)", lt: "Plotas (m2)" },
  "Volum (m3)": { en: "Volume (m3)", pl: "Objętość (m3)", lt: "Tūris (m3)" },
  "SUM": { en: "TOTAL", pl: "SUMA", lt: "IŠ VISO" },
  "ElementID": { en: "ElementID", pl: "ElementID", lt: "ElementID" },
  "Navn": { en: "Name", pl: "Nazwa", lt: "Pavadinimas" },
  "IFC-type": { en: "IFC type", pl: "Typ IFC", lt: "IFC tipas" },
  "L (m)": { en: "L (m)", pl: "D (m)", lt: "I (m)" },
  "B (m)": { en: "W (m)", pl: "S (m)", lt: "P (m)" },
  "H (m)": { en: "H (m)", pl: "W (m)", lt: "A (m)" },
  "Lengste mål (m)": { en: "Longest dimension (m)", pl: "Najdłuższy wymiar (m)", lt: "Ilgiausias matmuo (m)" },
  "Totalt": { en: "Total", pl: "Razem", lt: "Iš viso" },
  "Enkeltmaterialer": { en: "Individual materials", pl: "Poszczególne materiały", lt: "Atskiros medžiagos" },
  "Element": { en: "Element", pl: "Element", lt: "Elementas" },
  "Lengde (m)": { en: "Length (m)", pl: "Długość (m)", lt: "Ilgis (m)" },
  "Bredde (m)": { en: "Width (m)", pl: "Szerokość (m)", lt: "Plotis (m)" },
  "Høyde (m)": { en: "Height (m)", pl: "Wysokość (m)", lt: "Aukštis (m)" },
  "Sum areal (m2)": { en: "Total area (m2)", pl: "Suma powierzchni (m2)", lt: "Bendras plotas (m2)" },
  "Sum volum (m3)": { en: "Total volume (m3)", pl: "Suma objętości (m3)", lt: "Bendras tūris (m3)" },

  // ---------- Objekttyper og materialer ----------
  "Fundamenter": { en: "Foundations", pl: "Fundamenty", lt: "Pamatai" },
  "Peler": { en: "Piles", pl: "Pale", lt: "Poliai" },
  "Søyler": { en: "Columns", pl: "Słupy", lt: "Kolonos" },
  "Stålsøyler": { en: "Steel columns", pl: "Słupy stalowe", lt: "Plieninės kolonos" },
  "Betongsøyler": { en: "Concrete columns", pl: "Słupy żelbetowe", lt: "Betoninės kolonos" },
  "Søyler (andre)": { en: "Columns (other)", pl: "Słupy (inne)", lt: "Kolonos (kitos)" },
  "Bjelker": { en: "Beams", pl: "Belki", lt: "Sijos" },
  "Staver": { en: "Members", pl: "Pręty", lt: "Strypai" },
  "Stag/sperrer": { en: "Braces", pl: "Stężenia", lt: "Spyriai" },
  "Plater": { en: "Plates", pl: "Płyty", lt: "Plokštės" },
  "Vegger": { en: "Walls", pl: "Ściany", lt: "Sienos" },
  "Glassfasader": { en: "Curtain walls", pl: "Fasady szklane", lt: "Stiklo fasadai" },
  "Dekker": { en: "Slabs", pl: "Stropy", lt: "Perdangos" },
  "Tak": { en: "Roofs", pl: "Dachy", lt: "Stogai" },
  "Trapper": { en: "Stairs", pl: "Schody", lt: "Laiptai" },
  "Trappeløp": { en: "Stair flights", pl: "Biegi schodowe", lt: "Laiptatakiai" },
  "Ramper": { en: "Ramps", pl: "Rampy", lt: "Rampos" },
  "Rampeløp": { en: "Ramp flights", pl: "Biegi ramp", lt: "Rampų takai" },
  "Rekkverk": { en: "Railings", pl: "Balustrady", lt: "Turėklai" },
  "Kledning": { en: "Cladding", pl: "Okładziny", lt: "Apdaila" },
  "Dører": { en: "Doors", pl: "Drzwi", lt: "Durys" },
  "Vinduer": { en: "Windows", pl: "Okna", lt: "Langai" },
  "Armering": { en: "Reinforcement", pl: "Zbrojenie", lt: "Armatūra" },
  "Armeringsjern": { en: "Rebar", pl: "Pręty zbrojeniowe", lt: "Armatūros strypai" },
  "Armeringsnett": { en: "Reinforcement mesh", pl: "Siatki zbrojeniowe", lt: "Armatūros tinklai" },
  "Festemidler": { en: "Fasteners", pl: "Łączniki", lt: "Tvirtinimo detalės" },
  "Tilbehør": { en: "Accessories", pl: "Akcesoria", lt: "Priedai" },
  "Øvrige bygningsdeler": { en: "Other building elements", pl: "Inne elementy budowlane", lt: "Kiti statybos elementai" },
  "Sammenstillinger": { en: "Assemblies", pl: "Zespoły", lt: "Sąrankos" },
  "Rør": { en: "Pipes", pl: "Rury", lt: "Vamzdžiai" },
  "Kanaler": { en: "Ducts", pl: "Kanały", lt: "Ortakiai" },
  "Rør/kanaler": { en: "Pipes/ducts", pl: "Rury/kanały", lt: "Vamzdžiai/ortakiai" },
  "Inventar": { en: "Furniture", pl: "Wyposażenie", lt: "Įranga" },
  "Rom": { en: "Spaces", pl: "Pomieszczenia", lt: "Patalpos" },
  "Tomt": { en: "Site", pl: "Teren", lt: "Sklypas" },
  "Uten IFC-type": { en: "No IFC type", pl: "Bez typu IFC", lt: "Be IFC tipo" },
  "Annet": { en: "Other", pl: "Inne", lt: "Kita" },
  "Ukjent": { en: "Unknown", pl: "Nieznany", lt: "Nežinoma" },
  "Betong": { en: "Concrete", pl: "Beton", lt: "Betonas" },
  "Stål": { en: "Steel", pl: "Stal", lt: "Plienas" },
  "Tre": { en: "Timber", pl: "Drewno", lt: "Mediena" },
  "Mur": { en: "Masonry", pl: "Mur", lt: "Mūras" },
  "Isolasjon": { en: "Insulation", pl: "Izolacja", lt: "Izoliacija" },
  "Gips": { en: "Gypsum", pl: "Gips", lt: "Gipsas" },
  "Uten materiale": { en: "No material", pl: "Bez materiału", lt: "Be medžiagos" },
  "Etasje {0}": { en: "Storey {0}", pl: "Kondygnacja {0}", lt: "Aukštas {0}" },

  // ---------- Utseende ----------
  "Bakgrunn": { en: "Background", pl: "Tło", lt: "Fonas" },
  "Fargelegg etter type": { en: "Colour by type", pl: "Koloruj wg typu", lt: "Spalvinti pagal tipą" },
  "Originalfarger": { en: "Original colours", pl: "Oryginalne kolory", lt: "Originalios spalvos" },
  "Skjul/vis": { en: "Hide/show", pl: "Ukryj/pokaż", lt: "Slėpti/rodyti" },
  "Fargelegging og skjuling per type er ikke tilgjengelig i lav kvalitet. Last modellen i full kvalitet for å bruke det.": {
    en: "Colouring and hiding per type is not available in low quality. Load the model in full quality to use it.",
    pl: "Kolorowanie i ukrywanie wg typu nie działa w niskiej jakości. Wczytaj model w pełnej jakości.",
    lt: "Spalvinimas ir slėpimas pagal tipą negalimas žemoje kokybėje. Įkelkite modelį visa kokybe." },

  // ---------- Akser ----------
  "Velg hvilke elementtyper aksene lages fra:": { en: "Choose which element types the grids are made from:", pl: "Wybierz, z jakich typów elementów tworzone są osie:", lt: "Pasirinkite, iš kokių elementų tipų kuriamos ašys:" },
  "Fant ingen egnede elementtyper (søyler, fundamenter, peler, vegger, bjelker) i modellen.": {
    en: "No suitable element types (columns, foundations, piles, walls, beams) found in the model.",
    pl: "Nie znaleziono odpowiednich typów (słupy, fundamenty, pale, ściany, belki) w modelu.",
    lt: "Modelyje nerasta tinkamų elementų tipų (kolonos, pamatai, poliai, sienos, sijos)." },
  "Fant ikke nok elementer på linje til å lage akser fra valgt kilde": {
    en: "Not enough elements in line to make grids from the chosen source",
    pl: "Za mało elementów w linii, aby utworzyć osie z wybranego źródła",
    lt: "Per mažai elementų linijoje, kad iš pasirinkto šaltinio būtų sukurtos ašys" },
  "Mål-lappene (gule) vises først når du zoomer nær nok – det holder store modeller ryddige. Skriftstørrelsen justeres i Innstillinger (høyreklikk).": {
    en: "The (yellow) dimension labels appear when you zoom close enough – it keeps large models tidy. Font size is adjusted in Settings (right-click).",
    pl: "Żółte etykiety wymiarów pojawiają się po zbliżeniu – dzięki temu duże modele są czytelne. Rozmiar czcionki w Ustawieniach (prawy przycisk).",
    lt: "Geltonos matmenų etiketės rodomos priartinus – taip dideli modeliai lieka tvarkingi. Šrifto dydis keičiamas Nustatymuose (dešinysis mygtukas)." },

  // ---------- Snitt ----------
  "Snitt:": { en: "Section:", pl: "Przekrój:", lt: "Pjūvis:" },
  "høyde": { en: "height", pl: "wysokość", lt: "aukštis" },
  "Trykk på en flate i modellen …": { en: "Tap a face in the model …", pl: "Dotknij powierzchni w modelu …", lt: "Spustelėkite paviršių modelyje …" },
  "Y (høyde)": { en: "Y (height)", pl: "Y (wysokość)", lt: "Y (aukštis)" },
  "Fra flate": { en: "From face", pl: "Z powierzchni", lt: "Nuo paviršiaus" },
  "Boks": { en: "Box", pl: "Ramka", lt: "Dėžė" },
  "Snu": { en: "Flip", pl: "Odwróć", lt: "Apversti" },
  "Legg snittet parallelt med en flate du trykker på – for skjeive bygg": {
    en: "Place the section parallel to a face you tap – for skewed buildings",
    pl: "Ustaw przekrój równolegle do dotkniętej powierzchni – dla ukośnych budynków",
    lt: "Pjūvis lygiagrečiai paliestam paviršiui – pasvirusiems pastatams" },
  "Seks plan du kan krympe hver for seg – isolerer et utsnitt av bygget": {
    en: "Six planes you can shrink individually – isolates a portion of the building",
    pl: "Sześć płaszczyzn zmniejszanych osobno – wydziela fragment budynku",
    lt: "Šešios plokštumos, mažinamos atskirai – išskiria pastato dalį" },
  "Lagrede snitt for denne modellen": { en: "Saved sections for this model", pl: "Zapisane przekroje tego modelu", lt: "Išsaugoti šio modelio pjūviai" },
  "Skyv snittet langs flatens normal": { en: "Slide the section along the face normal", pl: "Przesuwaj przekrój wzdłuż normalnej", lt: "Stumkite pjūvį išilgai normalės" },
  "Krymp boksen fra hver av de seks sidene. Alt utenfor skjules. Boksen kan stå sammen med Etasjer.": {
    en: "Shrink the box from each of the six sides. Everything outside is hidden. The box can be combined with Storeys.",
    pl: "Zmniejszaj ramkę z każdej z sześciu stron. Wszystko poza nią jest ukryte. Ramka działa razem z Kondygnacjami.",
    lt: "Mažinkite dėžę iš šešių pusių. Viskas už jos paslepiama. Dėžė veikia kartu su Aukštais." },
  "X fra": { en: "X from", pl: "X od", lt: "X nuo" },
  "X til": { en: "X to", pl: "X do", lt: "X iki" },
  "Y fra (gulv)": { en: "Y from (floor)", pl: "Y od (podłoga)", lt: "Y nuo (grindys)" },
  "Y til (tak)": { en: "Y to (roof)", pl: "Y do (dach)", lt: "Y iki (stogas)" },
  "Z fra": { en: "Z from", pl: "Z od", lt: "Z nuo" },
  "Z til": { en: "Z to", pl: "Z do", lt: "Z iki" },
  "Hele modellen": { en: "Whole model", pl: "Cały model", lt: "Visas modelis" },
  "Midten": { en: "Centre", pl: "Środek", lt: "Vidurys" },
  "Krymp alle sider 25 % inn": { en: "Shrink all sides 25 % in", pl: "Zmniejsz wszystkie strony o 25 %", lt: "Sumažinti visas puses 25 %" },
  "Lagre som …": { en: "Save as …", pl: "Zapisz jako …", lt: "Išsaugoti kaip …" },
  "Lagre nåværende snitt": { en: "Save current section", pl: "Zapisz bieżący przekrój", lt: "Išsaugoti dabartinį pjūvį" },
  "Tilbake til boksen": { en: "Back to the box", pl: "Wróć do ramki", lt: "Grįžti prie dėžės" },
  "Tilbake til snitt-boksen": { en: "Back to the section box", pl: "Wróć do pola przekroju", lt: "Grįžti prie pjūvio dėžės" },
  "Åpne en modell først.": { en: "Open a model first.", pl: "Najpierw otwórz model.", lt: "Pirmiausia atidarykite modelį." },
  "Navn på snittet:": { en: "Name of the section:", pl: "Nazwa przekroju:", lt: "Pjūvio pavadinimas:" },
  "Ingen lagrede snitt for <b>{0}</b> ennå.": { en: "No saved sections for <b>{0}</b> yet.", pl: "Brak zapisanych przekrojów dla <b>{0}</b>.", lt: "Dar nėra išsaugotų pjūvių <b>{0}</b>." },
  "Fant ingen etasjer (IfcBuildingStorey) i modellen": { en: "No storeys (IfcBuildingStorey) found in the model", pl: "Nie znaleziono kondygnacji (IfcBuildingStorey) w modelu", lt: "Modelyje nerasta aukštų (IfcBuildingStorey)" },
  " – lag en ny lett kopi fra original-IFC-en for å få med etasjedata": {
    en: " – make a new light copy from the original IFC to include storey data",
    pl: " – utwórz nową lekką kopię z oryginalnego IFC, aby dołączyć kondygnacje",
    lt: " – sukurkite naują lengvąją kopiją iš originalaus IFC su aukštų duomenimis" },
  "Etasje:": { en: "Storey:", pl: "Kondygnacja:", lt: "Aukštas:" },

  // ---------- Mål og kote ----------
  "Trykk på to punkter": { en: "Tap two points", pl: "Dotknij dwóch punktów", lt: "Spustelėkite du taškus" },
  "Snap": { en: "Snap", pl: "Przyciąganie", lt: "Pritraukimas" },
  "Fest til nærmeste hjørne/kant": { en: "Snap to nearest corner/edge", pl: "Przyciągaj do najbliższego narożnika/krawędzi", lt: "Pritraukti prie artimiausio kampo/briaunos" },
  "Snap-følsomhet (piksler)": { en: "Snap sensitivity (pixels)", pl: "Czułość przyciągania (piksele)", lt: "Pritraukimo jautrumas (pikseliai)" },
  "Tøm mål": { en: "Clear measurements", pl: "Wyczyść pomiary", lt: "Išvalyti matavimus" },
  "Tøm koter": { en: "Clear elevations", pl: "Wyczyść rzędne", lt: "Išvalyti altitudes" },
  "Trykk på et punkt for å vise kotehøyde": { en: "Tap a point to show its elevation", pl: "Dotknij punktu, aby zobaczyć rzędną", lt: "Spustelėkite tašką altitudei parodyti" },
  "Trykk på modellen for å plassere markering": { en: "Tap the model to place a marker", pl: "Dotknij modelu, aby umieścić znacznik", lt: "Spustelėkite modelį žymekliui padėti" },

  // ---------- Sammenligning ----------
  "Avtrykk tatt av <b>{0}</b> ({1} elementer).": { en: "Snapshot taken of <b>{0}</b> ({1} elements).", pl: "Wykonano zrzut <b>{0}</b> ({1} elementów).", lt: "Padarytas <b>{0}</b> atspaudas ({1} elementų)." },
  "Åpne nå den nye versjonen – med Åpne eller Biblioteket. Endringene fargelegges automatisk når modellen er lastet.": {
    en: "Now open the new version – with Open or the Library. Changes are coloured automatically once loaded.",
    pl: "Teraz otwórz nową wersję – przez Otwórz lub Bibliotekę. Zmiany pokolorują się automatycznie.",
    lt: "Dabar atidarykite naują versiją – per Atidaryti arba biblioteką. Pakeitimai nusispalvins automatiškai." },
  "Avbryt sammenligning": { en: "Cancel comparison", pl: "Anuluj porównanie", lt: "Atšaukti palyginimą" },
  "Sammenligning krever en IFC-modell i full eller lav kvalitet – ikke lett kopi.": {
    en: "Comparison requires an IFC model in full or low quality – not a light copy.",
    pl: "Porównanie wymaga modelu IFC w pełnej lub niskiej jakości – nie lekkiej kopii.",
    lt: "Palyginimui reikia IFC modelio visa arba žema kokybe – ne lengvosios kopijos." },
  "Bare endringer": { en: "Only changes", pl: "Tylko zmiany", lt: "Tik pakeitimai" },
  "Avslutt": { en: "Exit", pl: "Zakończ", lt: "Baigti" },
  " · gjenkjent på ": { en: " · matched by ", pl: " · rozpoznano po ", lt: " · atpažinta pagal " },
  "Under halvparten av elementene lot seg parre. Er dette to versjoner av samme modell? Ellers har eksporten byttet både GlobalId og geometri.": {
    en: "Less than half of the elements could be paired. Are these two versions of the same model? Otherwise the export changed both GlobalId and geometry.",
    pl: "Mniej niż połowę elementów udało się sparować. Czy to dwie wersje tego samego modelu? Inaczej eksport zmienił i GlobalId, i geometrię.",
    lt: "Mažiau nei pusę elementų pavyko suporuoti. Ar tai dvi to paties modelio versijos? Kitaip eksportas pakeitė ir GlobalId, ir geometriją." },
  "Nye": { en: "New", pl: "Nowe", lt: "Nauji" },
  "Slettet": { en: "Deleted", pl: "Usunięte", lt: "Ištrinti" },
  "Endret": { en: "Changed", pl: "Zmienione", lt: "Pakeisti" },
  "Uendret": { en: "Unchanged", pl: "Bez zmian", lt: "Nepakitę" },
  "Ingen forskjeller funnet.": { en: "No differences found.", pl: "Nie znaleziono różnic.", lt: "Skirtumų nerasta." },
  " · fantes i forrige versjon": { en: " · existed in the previous version", pl: " · było w poprzedniej wersji", lt: " · buvo ankstesnėje versijoje" },
  "… og {0} flere": { en: "… and {0} more", pl: "… i jeszcze {0}", lt: "… ir dar {0}" },
  "forrige versjon": { en: "previous version", pl: "poprzednia wersja", lt: "ankstesnė versija" },
  "flyttet ": { en: "moved ", pl: "przesunięto ", lt: "perkelta " },
  "mål endret ": { en: "size changed ", pl: "zmieniono wymiar ", lt: "pakeistas matmuo " },
  "volum ": { en: "volume ", pl: "objętość ", lt: "tūris " },
  "Leser modellen …": { en: "Reading the model …", pl: "Odczyt modelu …", lt: "Skaitomas modelis …" },
  "Sammenligner versjoner …": { en: "Comparing versions …", pl: "Porównywanie wersji …", lt: "Lyginamos versijos …" },
  "Lenka var for stor til å ta med navn og mål – fargene og antallene stemmer, men lista er uten detaljer.": {
    en: "The link was too big to include names and sizes – colours and counts are right, but the list lacks details.",
    pl: "Link był za duży, by zawierał nazwy i wymiary – kolory i liczby się zgadzają, ale lista jest bez szczegółów.",
    lt: "Nuoroda buvo per didelė pavadinimams ir matmenims – spalvos ir kiekiai teisingi, bet sąrašas be detalių." },

  // ---------- Del visning ----------
  "Lenka gjenskaper kamera, snitt, etasje, skjulte typer og elementer, fargelegging, gjennomsiktighet": {
    en: "The link recreates camera, section, storey, hidden types and elements, colouring, transparency",
    pl: "Link odtwarza kamerę, przekrój, kondygnację, ukryte typy i elementy, kolory, przezroczystość",
    lt: "Nuoroda atkuria kamerą, pjūvį, aukštą, paslėptus tipus ir elementus, spalvinimą, permatomumą" },
  " og hele sammenligningen": { en: " and the whole comparison", pl: " oraz całe porównanie", lt: " ir visą palyginimą" },
  ". Den inneholder ingen modellfil og virker uten innlogging.": {
    en: ". It contains no model file and works without signing in.",
    pl: ". Nie zawiera pliku modelu i działa bez logowania.",
    lt: ". Joje nėra modelio failo ir ji veikia be prisijungimo." },
  "av": { en: "of", pl: "z", lt: "iš" },
  "Kunne ikke hente tegningen (Graph {0})": { en: "Could not fetch the drawing (Graph {0})", pl: "Nie udało się pobrać rysunku (Graph {0})", lt: "Nepavyko gauti brėžinio (Graph {0})" },
  "Kopier lenke": { en: "Copy link", pl: "Kopiuj link", lt: "Kopijuoti nuorodą" },
  "Modellen ligger i biblioteket, så mottakeren kan åpne den med ett trykk.": {
    en: "The model is in the library, so the recipient can open it with one tap.",
    pl: "Model jest w bibliotece, więc odbiorca otworzy go jednym dotknięciem.",
    lt: "Modelis yra bibliotekoje, todėl gavėjas atidarys jį vienu spustelėjimu." },
  "Modellen ble åpnet fra din maskin. Mottakeren må ha samme fil – legg den i Biblioteket hvis flere skal se den.": {
    en: "The model was opened from your computer. The recipient needs the same file – put it in the Library if others should see it.",
    pl: "Model otwarto z Twojego komputera. Odbiorca musi mieć ten sam plik – umieść go w Bibliotece, jeśli mają go widzieć inni.",
    lt: "Modelis atidarytas iš jūsų kompiuterio. Gavėjui reikia to paties failo – įdėkite jį į biblioteką, jei turi matyti kiti." },
  "<br>Lengde: ": { en: "<br>Length: ", pl: "<br>Długość: ", lt: "<br>Ilgis: " },
  " tegn.": { en: " characters.", pl: " znaków.", lt: " simbolių." },
  " <b>Så lange adresser kan bli kuttet i noen program – skjul færre typer.</b>": {
    en: " <b>Such long addresses may get cut in some programs – hide fewer types.</b>",
    pl: " <b>Tak długie adresy mogą być ucinane w niektórych programach – ukryj mniej typów.</b>",
    lt: " <b>Tokios ilgos nuorodos kai kur nukerpamos – slėpkite mažiau tipų.</b>" },
  "Trykk Ctrl+C for å kopiere lenka.": { en: "Press Ctrl+C to copy the link.", pl: "Naciśnij Ctrl+C, aby skopiować link.", lt: "Paspauskite Ctrl+C nuorodai nukopijuoti." },
  "Sammenligningen var stor, så navn og mål er utelatt – fargene og antallene er med.": {
    en: "The comparison was large, so names and sizes were left out – colours and counts are included.",
    pl: "Porównanie było duże, więc pominięto nazwy i wymiary – kolory i liczby są w linku.",
    lt: "Palyginimas buvo didelis, todėl pavadinimai ir matmenys praleisti – spalvos ir kiekiai yra." },
  "Sammenligningen var for stor for en adresse og er ikke med. Mottakeren må kjøre Sammenlign selv.": {
    en: "The comparison was too big for an address and is not included. The recipient must run Compare themselves.",
    pl: "Porównanie było za duże na adres i nie zostało dołączone. Odbiorca musi sam uruchomić Porównaj.",
    lt: "Palyginimas buvo per didelis nuorodai ir neįtrauktas. Gavėjas turi pats paleisti Palyginti." },
  "Delt visning": { en: "Shared view", pl: "Udostępniony widok", lt: "Bendrintas vaizdas" },
  "en modell": { en: "a model", pl: "model", lt: "modelis" },
  "Inneholder en sammenligning mot «{0}»": { en: "Contains a comparison against “{0}”", pl: "Zawiera porównanie z „{0}”", lt: "Yra palyginimas su „{0}“" },
  "Åpne samme fil med Åpne-knappen, så legges visningen på automatisk.": {
    en: "Open the same file with the Open button, and the view is applied automatically.",
    pl: "Otwórz ten sam plik przyciskiem Otwórz, a widok zostanie nałożony automatycznie.",
    lt: "Atidarykite tą patį failą mygtuku Atidaryti – vaizdas bus pritaikytas automatiškai." },
  "Den delte visningen ble laget for «{0}», men du har åpnet «{1}». Visningen legges på så godt det går.": {
    en: "The shared view was made for “{0}”, but you opened “{1}”. The view is applied as far as possible.",
    pl: "Udostępniony widok utworzono dla „{0}”, ale otwarto „{1}”. Widok zostanie nałożony w miarę możliwości.",
    lt: "Bendrintas vaizdas sukurtas „{0}“, bet atidarėte „{1}“. Vaizdas pritaikomas kiek įmanoma." },
  "Klarte ikke å legge på hele den delte visningen:": { en: "Could not apply the whole shared view:", pl: "Nie udało się nałożyć całego widoku:", lt: "Nepavyko pritaikyti viso bendrinto vaizdo:" },

  // ---------- Bibliotek ----------
  "Modeller": { en: "Models", pl: "Modele", lt: "Modeliai" },
  "Lette kopier": { en: "Light copies", pl: "Lekkie kopie", lt: "Lengvosios kopijos" },
  "Biblioteket er ikke satt opp ennå – client-ID mangler i konfigurasjonen.": {
    en: "The library is not set up yet – client ID missing in the configuration.",
    pl: "Biblioteka nie jest jeszcze skonfigurowana – brak client ID w konfiguracji.",
    lt: "Biblioteka dar nesukonfigūruota – konfigūracijoje trūksta „client ID“." },
  "Henter fil-liste fra SharePoint …": { en: "Fetching file list from SharePoint …", pl: "Pobieranie listy plików z SharePoint …", lt: "Gaunamas failų sąrašas iš „SharePoint“ …" },
  "Sender deg til Microsoft-innlogging …": { en: "Sending you to Microsoft sign-in …", pl: "Przekierowanie do logowania Microsoft …", lt: "Nukreipiama į „Microsoft“ prisijungimą …" },
  "Søk etter modell …": { en: "Search for a model …", pl: "Szukaj modelu …", lt: "Ieškoti modelio …" },
  "Feil: ": { en: "Error: ", pl: "Błąd: ", lt: "Klaida: " },
  "Sjekk at mappen «{0}» finnes på {1} og at du har tilgang.": {
    en: "Check that the folder “{0}” exists on {1} and that you have access.",
    pl: "Sprawdź, czy folder „{0}” istnieje w {1} i czy masz dostęp.",
    lt: "Patikrinkite, ar aplankas „{0}“ yra {1} ir ar turite prieigą." },
  "Ingen filer i «{0}» ennå.": { en: "No files in “{0}” yet.", pl: "Brak plików w „{0}”.", lt: "„{0}“ dar nėra failų." },
  " Lag en med Lett kopi-knappen og legg .glb-filen i denne mappa.": {
    en: " Make one with the Light copy button and put the .glb file in this folder.",
    pl: " Utwórz ją przyciskiem Lekka kopia i umieść plik .glb w tym folderze.",
    lt: " Sukurkite mygtuku Lengvoji kopija ir įdėkite .glb failą į šį aplanką." },
  " · <span style=\"color:var(--accent2)\">ligger i {0}</span>": { en: " · <span style=\"color:var(--accent2)\">located in {0}</span>", pl: " · <span style=\"color:var(--accent2)\">w {0}</span>", lt: " · <span style=\"color:var(--accent2)\">yra {0}</span>" },
  "Laster ned {0} … {1} %": { en: "Downloading {0} … {1} %", pl: "Pobieranie {0} … {1} %", lt: "Atsisiunčiama {0} … {1} %" },
  "Laster ned {0} …": { en: "Downloading {0} …", pl: "Pobieranie {0} …", lt: "Atsisiunčiama {0} …" },
  "Fikk ingen nedlastingslenke fra SharePoint": { en: "Got no download link from SharePoint", pl: "Brak linku pobierania z SharePoint", lt: "Negauta atsisiuntimo nuoroda iš „SharePoint“" },
  "Nedlasting feilet ({0})": { en: "Download failed ({0})", pl: "Pobieranie nie powiodło się ({0})", lt: "Atsisiųsti nepavyko ({0})" },
  "Klarte ikke å åpne fra biblioteket: ": { en: "Could not open from the library: ", pl: "Nie udało się otworzyć z biblioteki: ", lt: "Nepavyko atidaryti iš bibliotekos: " },
  "Du er ikke innlogget mot SharePoint (eller innloggingen er utløpt). Åpne Biblioteket og logg inn, så prøv igjen.": {
    en: "You are not signed in to SharePoint (or the sign-in expired). Open the Library, sign in, and try again.",
    pl: "Nie jesteś zalogowany do SharePoint (lub sesja wygasła). Otwórz Bibliotekę, zaloguj się i spróbuj ponownie.",
    lt: "Nesate prisijungę prie „SharePoint“ (arba sesija baigėsi). Atidarykite biblioteką, prisijunkite ir bandykite dar kartą." },
  "Innloggings-biblioteket (MSAL) lastet ikke – sjekk nettforbindelsen": {
    en: "The sign-in library (MSAL) did not load – check your connection",
    pl: "Biblioteka logowania (MSAL) nie wczytała się – sprawdź połączenie",
    lt: "Prisijungimo biblioteka (MSAL) neįsikėlė – patikrinkite ryšį" },

  // ---------- Innstillinger ----------
  "Kamera": { en: "Camera", pl: "Kamera", lt: "Kamera" },
  "Rotasjonshastighet": { en: "Rotation speed", pl: "Prędkość obrotu", lt: "Sukimo greitis" },
  "Zoomhastighet": { en: "Zoom speed", pl: "Prędkość zoomu", lt: "Mastelio greitis" },
  "Invertér zoom": { en: "Invert zoom", pl: "Odwróć zoom", lt: "Apversti mastelį" },
  "Visning": { en: "Display", pl: "Wyświetlanie", lt: "Rodymas" },
  "Måleenhet": { en: "Unit", pl: "Jednostka", lt: "Vienetas" },
  "Meter (m)": { en: "Metres (m)", pl: "Metry (m)", lt: "Metrai (m)" },
  "Millimeter (mm)": { en: "Millimetres (mm)", pl: "Milimetry (mm)", lt: "Milimetrai (mm)" },
  "Desimaler i mål og mengder": { en: "Decimals in measurements and quantities", pl: "Miejsca dziesiętne w pomiarach i ilościach", lt: "Dešimtainiai matavimuose ir kiekiuose" },
  " (hele meter)": { en: " (whole metres)", pl: " (pełne metry)", lt: " (sveiki metrai)" },
  " (mm)": { en: " (mm)", pl: " (mm)", lt: " (mm)" },
  "Elementer i lista": { en: "Items in the list", pl: "Elementy na liście", lt: "Elementai sąraše" },
  "Bakgrunnsfarge": { en: "Background colour", pl: "Kolor tła", lt: "Fono spalva" },
  "Skriftstørrelse akser": { en: "Grid label size", pl: "Rozmiar czcionki osi", lt: "Ašių šrifto dydis" },
  "Minikart": { en: "Minimap", pl: "Minimapa", lt: "Mini žemėlapis" },
  "Vis minikart": { en: "Show minimap", pl: "Pokaż minimapę", lt: "Rodyti mini žemėlapį" },
  "Størrelse": { en: "Size", pl: "Rozmiar", lt: "Dydis" },
  "Hurtigtaster": { en: "Shortcuts", pl: "Skróty", lt: "Spartieji klavišai" },
  "Trykk tast …": { en: "Press a key …", pl: "Naciśnij klawisz …", lt: "Paspauskite klavišą …" },
  "Mellomrom": { en: "Space", pl: "Spacja", lt: "Tarpas" },
  "Esc avbryter modus og lukker paneler. Trykk på en tast-knapp og deretter ønsket tast for å endre.": {
    en: "Esc cancels the mode and closes panels. Click a key button and then the desired key to change it.",
    pl: "Esc przerywa tryb i zamyka panele. Kliknij przycisk klawisza, a potem żądany klawisz, aby zmienić.",
    lt: "Esc nutraukia režimą ir uždaro skydelius. Spustelėkite klavišo mygtuką, tada norimą klavišą." },
  "Lagring": { en: "Saving", pl: "Zapisywanie", lt: "Išsaugojimas" },
  "Alt over – pluss fargelegging, egne typefarger, skjulte typer, gjennomsiktighet, snap og lav kvalitet – lagres automatisk og legges på neste gang du åpner en modell.": {
    en: "Everything above – plus colouring, custom type colours, hidden types, transparency, snap and low quality – is saved automatically and applied next time you open a model.",
    pl: "Wszystko powyżej – plus kolory, własne kolory typów, ukryte typy, przezroczystość, przyciąganie i niska jakość – zapisuje się automatycznie i wraca przy następnym otwarciu modelu.",
    lt: "Viskas aukščiau – plius spalvinimas, savos tipų spalvos, paslėpti tipai, permatomumas, pritraukimas ir žema kokybė – išsaugoma automatiškai ir pritaikoma kitą kartą atidarius modelį." },
  "Lagres bare i denne nettleseren. Logg inn via Biblioteket for at oppsettet skal følge deg på alle maskiner.": {
    en: "Saved only in this browser. Sign in via the Library so the setup follows you on all machines.",
    pl: "Zapisywane tylko w tej przeglądarce. Zaloguj się przez Bibliotekę, aby ustawienia podążały za Tobą.",
    lt: "Išsaugoma tik šioje naršyklėje. Prisijunkite per biblioteką, kad nustatymai sektų jus visur." },
  "Følger kontoen din ({0})": { en: "Follows your account ({0})", pl: "Podąża za Twoim kontem ({0})", lt: "Seka jūsų paskyrą ({0})" },
  "Prøver å lagre til SharePoint …": { en: "Trying to save to SharePoint …", pl: "Próba zapisu do SharePoint …", lt: "Bandoma išsaugoti į „SharePoint“ …" },
  "Tilbakestill alt": { en: "Reset everything", pl: "Zresetuj wszystko", lt: "Atstatyti viską" },

  // ---------- Lasting og feil (ifc/main/lite/ifcrpc) ----------
  "Dette ser ikke ut som en IFC- eller lett kopi-fil ({0}). Velg en fil som slutter på .ifc eller .glb": {
    en: "This does not look like an IFC or light-copy file ({0}). Choose a file ending in .ifc or .glb",
    pl: "To nie wygląda na plik IFC ani lekką kopię ({0}). Wybierz plik .ifc lub .glb",
    lt: "Tai nepanašu į IFC ar lengvosios kopijos failą ({0}). Pasirinkite .ifc arba .glb failą" },
  "Starter IFC-motor …": { en: "Starting IFC engine …", pl: "Uruchamianie silnika IFC …", lt: "Paleidžiamas IFC variklis …" },
  "Leser {0} …": { en: "Reading {0} …", pl: "Odczyt {0} …", lt: "Skaitoma {0} …" },
  "Klarte ikke å lese fila. Ligger den i OneDrive og er merket «bare på nett»? Høyreklikk fila i Utforsker → «Behold alltid på denne enheten», og prøv igjen.": {
    en: "Could not read the file. Is it in OneDrive marked “online-only”? Right-click the file in Explorer → “Always keep on this device”, then try again.",
    pl: "Nie udało się odczytać pliku. Czy jest w OneDrive jako „tylko online”? Kliknij plik prawym przyciskiem w Eksploratorze → „Zawsze zachowuj na tym urządzeniu” i spróbuj ponownie.",
    lt: "Nepavyko nuskaityti failo. Ar jis „OneDrive“ pažymėtas „tik internete“? Spustelėkite failą dešiniu mygtuku → „Visada laikyti šiame įrenginyje“ ir bandykite dar kartą." },
  "Klarte ikke å lese IFC-filen: ": { en: "Could not read the IFC file: ", pl: "Nie udało się odczytać pliku IFC: ", lt: "Nepavyko nuskaityti IFC failo: " },
  "Klarte ikke å lese filen: ": { en: "Could not read the file: ", pl: "Nie udało się odczytać pliku: ", lt: "Nepavyko nuskaityti failo: " },
  "IFC-modell eller lett kopi": { en: "IFC model or light copy", pl: "Model IFC lub lekka kopia", lt: "IFC modelis arba lengvoji kopija" },
  "Åpner IFC-filen …": { en: "Opening the IFC file …", pl: "Otwieranie pliku IFC …", lt: "Atidaromas IFC failas …" },
  "Fullfører …": { en: "Finishing …", pl: "Kończenie …", lt: "Užbaigiama …" },
  " elementer": { en: " elements", pl: " elementów", lt: " elementų" },
  " · lav kvalitet": { en: " · low quality", pl: " · niska jakość", lt: " · žema kokybė" },
  " små utelatt)": { en: " small omitted)", pl: " małych pominięto)", lt: " smulkių praleista)" },
  "Leser geometrien … {0} %": { en: "Reading geometry … {0} %", pl: "Odczyt geometrii … {0} %", lt: "Skaitoma geometrija … {0} %" },
  "Leser geometrien …": { en: "Reading geometry …", pl: "Odczyt geometrii …", lt: "Skaitoma geometrija …" },
  "Forenkler geometri …": { en: "Simplifying geometry …", pl: "Upraszczanie geometrii …", lt: "Paprastinama geometrija …" },
  "Setter sammen geometrien …": { en: "Assembling geometry …", pl: "Składanie geometrii …", lt: "Surenkama geometrija …" },
  " elementer · lett kopi": { en: " elements · light copy", pl: " elementów · lekka kopia", lt: " elementų · lengvoji kopija" },
  "Denne modellen er allerede en lett kopi.": { en: "This model is already a light copy.", pl: "Ten model jest już lekką kopią.", lt: "Šis modelis jau yra lengvoji kopija." },
  " elementer i lett kopi": { en: " elements in the light copy", pl: " elementów w lekkiej kopii", lt: " elementų lengvojoje kopijoje" },
  " små/festemidler utelatt)": { en: " small/fasteners omitted)", pl: " małych/łączników pominięto)", lt: " smulkių/tvirtinimo detalių praleista)" },
  "Klarte ikke å lage lett kopi: ": { en: "Could not make a light copy: ", pl: "Nie udało się utworzyć lekkiej kopii: ", lt: "Nepavyko sukurti lengvosios kopijos: " },
  "Laste modellen på nytt i {0} kvalitet?": { en: "Reload the model in {0} quality?", pl: "Wczytać model ponownie w jakości: {0}?", lt: "Įkelti modelį iš naujo {0} kokybe?" },
  "lav": { en: "low", pl: "niskiej", lt: "žema" },
  "full": { en: "full", pl: "pełnej", lt: "visa" },
  "Laster på nytt …": { en: "Reloading …", pl: "Ponowne wczytywanie …", lt: "Įkeliama iš naujo …" },
  "Fant ikke modellfilen igjen – åpne den på nytt": { en: "Could not find the model file again – open it anew", pl: "Nie znaleziono ponownie pliku modelu – otwórz go jeszcze raz", lt: "Modelio failas neberastas – atidarykite jį iš naujo" },
  "Klarte ikke å laste på nytt: ": { en: "Could not reload: ", pl: "Nie udało się wczytać ponownie: ", lt: "Nepavyko įkelti iš naujo: " },
  "Klarte ikke å laste modellen ({0}).\n\nPrøve på nytt i lav kvalitet?": {
    en: "Could not load the model ({0}).\n\nTry again in low quality?",
    pl: "Nie udało się wczytać modelu ({0}).\n\nSpróbować w niskiej jakości?",
    lt: "Nepavyko įkelti modelio ({0}).\n\nBandyti žema kokybe?" },
  "Prøver i lav kvalitet …": { en: "Trying in low quality …", pl: "Próba w niskiej jakości …", lt: "Bandoma žema kokybe …" },
  "Fant ikke modellfilen igjen": { en: "Could not find the model file again", pl: "Nie znaleziono ponownie pliku modelu", lt: "Modelio failas neberastas" },
  "Gikk ikke i lav kvalitet heller: ": { en: "Did not work in low quality either: ", pl: "Nie powiodło się też w niskiej jakości: ", lt: "Nepavyko ir žema kokybe: " },
  "Forrige forsøk på å åpne <b>{0}</b> ser ut til å ha krasjet nettleseren.": {
    en: "The previous attempt to open <b>{0}</b> seems to have crashed the browser.",
    pl: "Poprzednia próba otwarcia <b>{0}</b> prawdopodobnie zawiesiła przeglądarkę.",
    lt: "Ankstesnis bandymas atidaryti <b>{0}</b> greičiausiai nulaužė naršyklę." },
  " Den var allerede i lav kvalitet – modellen er trolig for stor for denne enheten.": {
    en: " It was already in low quality – the model is probably too big for this device.",
    pl: " Był już w niskiej jakości – model jest zapewne za duży na to urządzenie.",
    lt: " Jau buvo žema kokybe – modelis šiam įrenginiui greičiausiai per didelis." },
  "Prøv igjen i lav kvalitet": { en: "Try again in low quality", pl: "Spróbuj ponownie w niskiej jakości", lt: "Bandyti dar kartą žema kokybe" },
  "Velg «{0}» på nytt – den åpnes nå i lav kvalitet.": {
    en: "Choose “{0}” again – it now opens in low quality.",
    pl: "Wybierz „{0}” ponownie – otworzy się w niskiej jakości.",
    lt: "Pasirinkite „{0}“ iš naujo – dabar atsidarys žema kokybe." },
  "Velg «{0}» på nytt – nettleseren tillater ikke at siden åpner en lokal fil av seg selv.": {
    en: "Choose “{0}” again – the browser does not allow the page to open a local file by itself.",
    pl: "Wybierz „{0}” ponownie – przeglądarka nie pozwala stronie samodzielnie otworzyć pliku lokalnego.",
    lt: "Pasirinkite „{0}“ iš naujo – naršyklė neleidžia puslapiui pačiam atidaryti vietinio failo." },
  "Fikk ikke tilgang til filen. Velg den på nytt med Åpne-knappen.": {
    en: "Did not get access to the file. Choose it again with the Open button.",
    pl: "Brak dostępu do pliku. Wybierz go ponownie przyciskiem Otwórz.",
    lt: "Negauta prieiga prie failo. Pasirinkite jį iš naujo mygtuku Atidaryti." },
  "Fant ikke «{0}» der den lå sist. Er den flyttet eller slettet? Velg den på nytt med Åpne-knappen.": {
    en: "Could not find “{0}” where it was last. Was it moved or deleted? Choose it again with the Open button.",
    pl: "Nie znaleziono „{0}” w poprzednim miejscu. Przeniesiony lub usunięty? Wybierz go ponownie przyciskiem Otwórz.",
    lt: "„{0}“ neberasta ten, kur buvo. Perkelta ar ištrinta? Pasirinkite iš naujo mygtuku Atidaryti." },
  "Klarte ikke å gjenåpne filen: ": { en: "Could not reopen the file: ", pl: "Nie udało się ponownie otworzyć pliku: ", lt: "Nepavyko iš naujo atidaryti failo: " },
  "Leser elementdata …": { en: "Reading element data …", pl: "Odczyt danych elementów …", lt: "Skaitomi elementų duomenys …" },
  "Henter elementdata …": { en: "Fetching element data …", pl: "Pobieranie danych elementów …", lt: "Gaunami elementų duomenys …" },
  "Slår sammen geometri …": { en: "Merging geometry …", pl: "Scalanie geometrii …", lt: "Jungiama geometrija …" },
  "Komprimerer geometri …": { en: "Compressing geometry …", pl: "Kompresja geometrii …", lt: "Spaudžiama geometrija …" },
  "Skriver .glb …": { en: "Writing .glb …", pl: "Zapisywanie .glb …", lt: "Rašomas .glb …" },
  "Laster innebygd modell …": { en: "Loading embedded model …", pl: "Wczytywanie osadzonego modelu …", lt: "Įkeliamas įtaisytas modelis …" },
  "Klarte ikke å laste innebygd modell: ": { en: "Could not load embedded model: ", pl: "Nie udało się wczytać osadzonego modelu: ", lt: "Nepavyko įkelti įtaisyto modelio: " },
  "Nettleseren støtter ikke Web Workers": { en: "The browser does not support Web Workers", pl: "Przeglądarka nie obsługuje Web Workers", lt: "Naršyklė nepalaiko „Web Workers“" },

  // ---------- Etterslep: nøkler som manglet i ordboken (byggeplass, sammenligning, lettmodus) ----------
  "Denne modellen er allerede en lett kopi – åpne originalen (IFC) og prøv igjen.": {
    en: "This model is already a light copy – open the original (IFC) and try again.",
    pl: "Ten model jest już lekką kopią – otwórz oryginał (IFC) i spróbuj ponownie.",
    lt: "Šis modelis jau yra lengva kopija – atidarykite originalą (IFC) ir bandykite dar kartą." },
  "Adressen til byggeplass-tjenesten er ikke satt opp. Den står i js/config.js, og kan overstyres i oppsett.json i SharePoint-mappa.": {
    en: "The construction site service address is not set up. It lives in js/config.js and can be overridden in oppsett.json in the SharePoint folder.",
    pl: "Adres usługi placu budowy nie jest skonfigurowany. Znajduje się w js/config.js i można go nadpisać w oppsett.json w folderze SharePoint.",
    lt: "Statybvietės paslaugos adresas nenustatytas. Jis yra js/config.js ir gali būti pakeistas oppsett.json faile SharePoint aplanke." },
  "Planner er ikke satt opp ennå. Plan-ID-en legges inn i «oppsett.json» i SharePoint-mappa med modellene.": {
    en: "Planner is not set up yet. The plan ID goes into “oppsett.json” in the SharePoint folder with the models.",
    pl: "Planner nie jest jeszcze skonfigurowany. Identyfikator planu należy wpisać w „oppsett.json” w folderze SharePoint z modelami.",
    lt: "„Planner“ dar nesukonfigūruotas. Plano ID įrašomas į „oppsett.json“ SharePoint aplanke su modeliais." },
  "Prosjektnummer (5 siffer):": { en: "Project number (5 digits):", pl: "Numer projektu (5 cyfr):", lt: "Projekto numeris (5 skaitmenys):" },
  "Opplastingsnøkkel:": { en: "Upload key:", pl: "Klucz przesyłania:", lt: "Įkėlimo raktas:" },
  "Laster opp …": { en: "Uploading …", pl: "Przesyłanie …", lt: "Įkeliama …" },
  "Feil opplastingsnøkkel – trykk på knappen og skriv den på nytt.": {
    en: "Wrong upload key – press the button and type it again.",
    pl: "Błędny klucz przesyłania – naciśnij przycisk i wpisz go ponownie.",
    lt: "Neteisingas įkėlimo raktas – paspauskite mygtuką ir įveskite jį iš naujo." },
  "Opplastingen feilet: ": { en: "The upload failed: ", pl: "Przesyłanie nie powiodło się: ", lt: "Įkelti nepavyko: " },
  "Se alle": { en: "Show all", pl: "Pokaż wszystko", lt: "Rodyti visus" },
  "Skjul {0} valgte": { en: "Hide {0} selected", pl: "Ukryj zaznaczone: {0}", lt: "Slėpti pažymėtus: {0}" },

  // ---------- 🧊 ViewCube ----------
  "Topp": { en: "Top", pl: "Góra", lt: "Viršus" },
  "Bunn": { en: "Bottom", pl: "Dół", lt: "Apačia" },
  "Front": { en: "Front", pl: "Przód", lt: "Priekis" },
  "Bak": { en: "Back", pl: "Tył", lt: "Galas" },
  "Høyre": { en: "Right", pl: "Prawo", lt: "Dešinė" },
  "Venstre": { en: "Left", pl: "Lewo", lt: "Kairė" },
  "Vis ViewCube": { en: "Show ViewCube", pl: "Pokaż ViewCube", lt: "Rodyti „ViewCube“" },
  "Plassering": { en: "Placement", pl: "Umiejscowienie", lt: "Vieta" },
  "Oppe til venstre": { en: "Top left", pl: "Lewy górny róg", lt: "Viršuje kairėje" },
  "Oppe til høyre": { en: "Top right", pl: "Prawy górny róg", lt: "Viršuje dešinėje" },
  "Nede til venstre": { en: "Bottom left", pl: "Lewy dolny róg", lt: "Apačioje kairėje" },
  "Nede til høyre": { en: "Bottom right", pl: "Prawy dolny róg", lt: "Apačioje dešinėje" },
  "Trykk på en flate, kant eller hjørne for å snu modellen": {
    en: "Click a face, edge or corner to turn the model",
    pl: "Kliknij ścianę, krawędź lub narożnik, aby obrócić model",
    lt: "Spustelėkite sienelę, briauną ar kampą, kad pasuktumėte modelį" },
  "Klarte ikke å laste modellen: ": { en: "Could not load the model: ", pl: "Nie udało się wczytać modelu: ", lt: "Nepavyko įkelti modelio: " },

  // ---------- ↩ Angre og gjenopprett ----------
  // Handlingsnavnene under brukes både i knappenes tittel («Angre: Mål») og i
  // kvitteringsboblen. «Mål», «Kote», «Tøm mål», «Tøm koter», «Skjul element»,
  // «Vis alle», «Originalfarger» og «Fargelegg etter type» finnes fra før.
  "Angre": { en: "Undo", pl: "Cofnij", lt: "Atšaukti" },
  "Gjenopprett": { en: "Redo", pl: "Ponów", lt: "Pakartoti" },
  "Angre siste handling (Ctrl+Z)": {
    en: "Undo last action (Ctrl+Z)",
    pl: "Cofnij ostatnią czynność (Ctrl+Z)",
    lt: "Atšaukti paskutinį veiksmą (Ctrl+Z)" },
  "Gjenopprett handlingen du angret (Ctrl+Y)": {
    en: "Redo the action you undid (Ctrl+Y)",
    pl: "Ponów cofniętą czynność (Ctrl+Y)",
    lt: "Pakartoti atšauktą veiksmą (Ctrl+Y)" },
  "Angre: {0}": { en: "Undo: {0}", pl: "Cofnij: {0}", lt: "Atšaukti: {0}" },
  "Gjenopprett: {0}": { en: "Redo: {0}", pl: "Ponów: {0}", lt: "Pakartoti: {0}" },
  "Angret: {0}": { en: "Undone: {0}", pl: "Cofnięto: {0}", lt: "Atšaukta: {0}" },
  "Gjenopprettet: {0}": { en: "Redone: {0}", pl: "Ponowiono: {0}", lt: "Pakartota: {0}" },
  "Skjul flere element": { en: "Hide several elements", pl: "Ukryj kilka elementów", lt: "Slėpti kelis elementus" },
  "Gjennomsiktig på": { en: "Transparent on", pl: "Przezroczystość wł.", lt: "Permatomumas įjungtas" },
  "Gjennomsiktig av": { en: "Transparent off", pl: "Przezroczystość wył.", lt: "Permatomumas išjungtas" },
  "Farge på elementtype": { en: "Element type colour", pl: "Kolor typu elementu", lt: "Elemento tipo spalva" },
  "Skjul elementtype": { en: "Hide element type", pl: "Ukryj typ elementu", lt: "Slėpti elemento tipą" },
  "Vis elementtype": { en: "Show element type", pl: "Pokaż typ elementu", lt: "Rodyti elemento tipą" },
  "Snitt på": { en: "Section on", pl: "Przekrój wł.", lt: "Pjūvis įjungtas" },
  "Snitt av": { en: "Section off", pl: "Przekrój wył.", lt: "Pjūvis išjungtas" },

  // ---------- Enheter ----------
  "Enheter": { en: "Units", pl: "Jednostki", lt: "Vienetai" },
  "Modellens enhet": { en: "Model unit", pl: "Jednostka modelu", lt: "Modelio vienetas" },
  "Automatisk": { en: "Automatic", pl: "Automatycznie", lt: "Automatiškai" },
  "millimeter": { en: "millimetres", pl: "milimetry", lt: "milimetrai" },
  "meter": { en: "metres", pl: "metry", lt: "metrai" },
  "Centimeter (cm)": { en: "Centimetres (cm)", pl: "Centymetry (cm)", lt: "Centimetrai (cm)" },
  "Fot (ft)": { en: "Feet (ft)", pl: "Stopy (ft)", lt: "Pėdos (ft)" },
  "Hvilken enhet modellen er TEGNET i. Automatisk gjetter ut fra størrelsen og treffer nesten alltid – men bommer på små modeller i millimeter og på anlegg over en kilometer i meter. Står målene tusen ganger for høyt eller lavt, er det denne du skal endre.": {
    en: "Which unit the model is DRAWN in. Automatic guesses from the size and is nearly always right – but it misses on small models in millimetres and on sites over a kilometre in metres. If measurements are a thousand times too high or low, this is the one to change.",
    pl: "W jakiej jednostce model został NARYSOWANY. Automatycznie zgaduje na podstawie rozmiaru i prawie zawsze trafia – ale myli się przy małych modelach w milimetrach i przy terenach powyżej kilometra w metrach. Jeśli wymiary są tysiąc razy za duże lub za małe, to jest to ustawienie do zmiany.",
    lt: "Kokiais vienetais modelis NUBRAIŽYTAS. Automatinis spėja pagal dydį ir beveik visada pataiko – bet klysta su mažais modeliais milimetrais ir su daugiau nei kilometro objektais metrais. Jei matmenys tūkstantį kartų per dideli ar per maži, keiskite čia." },

  // ---------- Delte markeringer ----------
  "Fikk ikke lagret markeringene – noen andre skriver i samme fil akkurat nå. Ingenting er tapt lokalt; prøv igjen om litt.": {
    en: "Could not save the markers to SharePoint – someone else is writing to the same file right now. Nothing is lost locally; try again shortly.",
    pl: "Nie udało się zapisać oznaczeń w SharePoint – ktoś inny właśnie zapisuje ten sam plik. Nic nie zostało utracone lokalnie; spróbuj ponownie za chwilę.",
    lt: "Nepavyko išsaugoti žymų SharePoint – šiuo metu tą patį failą rašo kas nors kitas. Vietiniai duomenys nedingo; pabandykite netrukus dar kartą." },

  // ---------- Kø for vedlegg (bilder og talemeldinger) ----------
  "Bildet er lagret på telefonen. Det sendes automatisk når du har nett igjen.": { en: "The photo is saved on your phone. It will be sent automatically when you are back online.", pl: "Zdjęcie jest zapisane w telefonie. Zostanie wysłane automatycznie, gdy wróci połączenie.", lt: "Nuotrauka išsaugota telefone. Ji bus išsiųsta automatiškai, kai atsiras ryšys." },
  "Talemeldingen er lagret på telefonen. Den sendes automatisk når du har nett igjen.": { en: "The voice message is saved on your phone. It will be sent automatically when you are back online.", pl: "Wiadomość głosowa jest zapisana w telefonie. Zostanie wysłana automatycznie, gdy wróci połączenie.", lt: "Balso žinutė išsaugota telefone. Ji bus išsiųsta automatiškai, kai atsiras ryšys." },
  "{0} vedlegg som lå og ventet er nå sendt til prosjektlederen.": { en: "{0} attachments that were waiting have now been sent to the project manager.", pl: "{0} załączników, które czekały, zostało wysłanych do kierownika projektu.", lt: "{0} priedai, kurie laukė, dabar išsiųsti projekto vadovui." },
  "{0} vedlegg er sendt. {1} venter fortsatt på nett.": { en: "{0} attachments sent. {1} are still waiting for a connection.", pl: "Wysłano {0} załączników. {1} nadal czeka na połączenie.", lt: "Išsiųsta {0} priedų. {1} vis dar laukia ryšio." },
  "Det ligger allerede {0} vedlegg og venter på nett. Finn dekning og prøv igjen før du tar flere bilder.": { en: "There are already {0} attachments waiting for a connection. Find coverage and try again before taking more photos.", pl: "Już {0} załączników czeka na połączenie. Znajdź zasięg i spróbuj ponownie przed zrobieniem kolejnych zdjęć.", lt: "Jau {0} priedų laukia ryšio. Susiraskite ryšį ir pabandykite dar kartą prieš darydami daugiau nuotraukų." },

  // ---------- Statusrapport (PDF) ----------
  "Tegninger": { en: "Drawings", pl: "Rysunki", lt: "Brėžiniai" },
  "INGEN SVAR ENNÅ": { en: "NO REPLIES YET", pl: "BRAK ODPOWIEDZI", lt: "DAR NĖRA ATSAKYMŲ" },
  "{0} bilde": { en: "{0} photo", pl: "{0} zdjęcie", lt: "{0} nuotrauka" },
  "{0} bilde før": { en: "{0} photo before", pl: "{0} zdjęcie przed", lt: "{0} nuotrauka prieš" },
  "{0} bilde etter": { en: "{0} photo after", pl: "{0} zdjęcie po", lt: "{0} nuotrauka po" },
  "{0} talemelding": { en: "{0} voice message", pl: "{0} wiadomość głosowa", lt: "{0} balso žinutė" },
  "{0} tegning": { en: "{0} drawing", pl: "{0} rysunek", lt: "{0} brėžinys" },
  "– {0} markering": { en: "– {0} marking", pl: "– {0} oznaczenie", lt: "– {0} žyma" },
  "ID": { en: "ID", pl: "ID", lt: "ID" },
  "Henter PDF-biblioteket …": { en: "Fetching the PDF library …", pl: "Pobieranie biblioteki PDF …", lt: "Gaunama PDF biblioteka …" },
  "Tegner {0} sider …": { en: "Drawing {0} pages …", pl: "Rysowanie {0} stron …", lt: "Piešiama {0} puslapių …" },
  "Modell": { en: "Model", pl: "Model", lt: "Modelis" },
  "Sak": { en: "Case", pl: "Sprawa", lt: "Byla" },
  "Hastegrad": { en: "Urgency", pl: "Pilność", lt: "Skuba" },
  "Opprettet": { en: "Created", pl: "Utworzono", lt: "Sukurta" },
  "Bytt til mørkt tema": { en: "Switch to dark theme", pl: "Przełącz na ciemny motyw", lt: "Perjungti į tamsią temą" },
  "Bytt til lyst tema": { en: "Switch to light theme", pl: "Przełącz na jasny motyw", lt: "Perjungti į šviesią temą" },
  "Rapport": { en: "Report", pl: "Raport", lt: "Ataskaita" },
  "Last ned PDF": { en: "Download PDF", pl: "Pobierz PDF", lt: "Atsisiųsti PDF" },
  "Last ned statusrapport som PDF": { en: "Download status report as PDF", pl: "Pobierz raport statusu w PDF", lt: "Atsisiųsti būsenos ataskaitą PDF" },
  "Fullstendig": { en: "Complete", pl: "Pełny", lt: "Pilna" },
  "hele kommentartråden – til arkiv og analyse": { en: "the entire comment thread – for archive and analysis", pl: "cały wątek komentarzy – do archiwum i analizy", lt: "visa komentarų gija – archyvui ir analizei" },
  "Byggemøte": { en: "Site meeting", pl: "Spotkanie budowlane", lt: "Statybų susirinkimas" },
  "første og de tre siste innleggene – til utdeling": { en: "the first and last three entries – for handout", pl: "pierwszy i trzy ostatnie wpisy – do rozdania", lt: "pirmas ir trys paskutiniai įrašai – dalijimui" },
  "Logo": { en: "Logo", pl: "Logo", lt: "Logotipas" },
  "Innebygd Storm-logo": { en: "Built-in Storm logo", pl: "Wbudowane logo Storm", lt: "Įtaisytas Storm logotipas" },
  "Ta med CSV med samme data": { en: "Include CSV with the same data", pl: "Dołącz CSV z tymi samymi danymi", lt: "Pridėti CSV su tais pačiais duomenimis" },
  "Statusrapport markeringer": { en: "Status report – markings", pl: "Raport statusu – oznaczenia", lt: "Būsenos ataskaita – žymos" },
  "Lager rapport …": { en: "Building report …", pl: "Tworzenie raportu …", lt: "Kuriama ataskaita …" },
  "Rapporten er lastet ned.": { en: "The report has been downloaded.", pl: "Raport został pobrany.", lt: "Ataskaita atsisiųsta." },
  "Klarte ikke å lage rapporten: {0}": { en: "Could not create the report: {0}", pl: "Nie udało się utworzyć raportu: {0}", lt: "Nepavyko sukurti ataskaitos: {0}" },
  "Modellen": { en: "The model", pl: "Model", lt: "Modelis" },
  "– slik den sto da rapporten ble laget": { en: "– as it was when the report was created", pl: "– w stanie z chwili utworzenia raportu", lt: "– kokia buvo kuriant ataskaitą" },
  "Etter frist": { en: "By deadline", pl: "Wg terminu", lt: "Pagal terminą" },
  "Etter status": { en: "By status", pl: "Wg statusu", lt: "Pagal būseną" },
  "Krever handling nå": { en: "Needs action now", pl: "Wymaga działania teraz", lt: "Reikia veiksmų dabar" },
  "– forfalt og hastende, verst først": { en: "– overdue and urgent, worst first", pl: "– po terminie i pilne, najgorsze najpierw", lt: "– pradelsti ir skubūs, blogiausi pirmi" },
  "Ingenting er forfalt eller haster.": { en: "Nothing is overdue or urgent.", pl: "Nic nie jest po terminie ani pilne.", lt: "Nėra pradelstų ar skubių." },
  "De kommer ikke med i morgenvarselet og havner ikke i prioriteringslista.": { en: "They are left out of the morning alert and the priority list.", pl: "Nie trafiają do porannego powiadomienia ani na listę priorytetów.", lt: "Jos nepatenka į rytinį pranešimą ir prioritetų sąrašą." },
  "Endret siden revisjon {0}": { en: "Changed since revision {0}", pl: "Zmienione od wersji {0}", lt: "Pakeista nuo {0} versijos" },
  "Nye markeringer": { en: "New markings", pl: "Nowe oznaczenia", lt: "Naujos žymos" },
  "Løst siden sist": { en: "Resolved since last time", pl: "Rozwiązane od ostatniego razu", lt: "Išspręsta nuo praėjusio karto" },
  "Fikk ny frist": { en: "Given a new deadline", pl: "Otrzymały nowy termin", lt: "Gavo naują terminą" },
  "Saksmapper": { en: "Case files", pl: "Teczki spraw", lt: "Bylų aplankai" },
  "– vedlegg og hele kommentartråden, én blokk per sak": { en: "– attachments and the full comment thread, one block per case", pl: "– załączniki i cały wątek komentarzy, jeden blok na sprawę", lt: "– priedai ir visa komentarų gija, po bloką kiekvienai bylai" },
  "Kommentartråd – {0} innlegg": { en: "Comment thread – {0} entries", pl: "Wątek komentarzy – {0} wpisów", lt: "Komentarų gija – {0} įrašai" },
  "Kommentartråd – {0} av {1} innlegg": { en: "Comment thread – {0} of {1} entries", pl: "Wątek komentarzy – {0} z {1} wpisów", lt: "Komentarų gija – {0} iš {1} įrašų" },
  "{0} tidligere innlegg utelatt ({1} – {2}). Se fullstendig rapport.": { en: "{0} earlier entries omitted ({1} – {2}). See the complete report.", pl: "Pominięto {0} wcześniejszych wpisów ({1} – {2}). Zobacz pełny raport.", lt: "Praleisti {0} ankstesni įrašai ({1} – {2}). Žr. pilną ataskaitą." },
  "Møteutgave – forkortet.": { en: "Meeting edition – abridged.", pl: "Wydanie na spotkanie – skrócone.", lt: "Susirinkimo laida – sutrumpinta." },
  "Kommentartrådene viser første og de tre siste innleggene. Fullstendig rapport ligger i prosjektmappa.": { en: "The comment threads show the first and last three entries. The complete report is in the project folder.", pl: "Wątki komentarzy pokazują pierwszy i trzy ostatnie wpisy. Pełny raport znajduje się w folderze projektu.", lt: "Komentarų gijos rodo pirmą ir tris paskutinius įrašus. Pilna ataskaita yra projekto aplanke." },
  "møteutgave": { en: "meeting edition", pl: "wydanie na spotkanie", lt: "susirinkimo laida" },
  "Side {0} av {1}": { en: "Page {0} of {1}", pl: "Strona {0} z {1}", lt: "{0} psl. iš {1}" },
  "Utskrift fra Storm IFC-Viewer": { en: "Printed from Storm IFC-Viewer", pl: "Wydruk ze Storm IFC-Viewer", lt: "Spausdinta iš Storm IFC-Viewer" },
  "{0} dager over": { en: "{0} days over", pl: "{0} dni po terminie", lt: "{0} d. viršyta" },
  "i dag": { en: "today", pl: "dzisiaj", lt: "šiandien" },
  "i morgen": { en: "tomorrow", pl: "jutro", lt: "rytoj" },
  "om {0} dager": { en: "in {0} days", pl: "za {0} dni", lt: "po {0} d." },
  "{0} bilder": { en: "{0} photos", pl: "{0} zdjęć", lt: "{0} nuotraukos" },
  "{0} bilder før": { en: "{0} photos before", pl: "{0} zdjęć przed", lt: "{0} nuotraukos prieš" },
  "{0} bilder etter": { en: "{0} photos after", pl: "{0} zdjęć po", lt: "{0} nuotraukos po" },
  "{0} talemeldinger": { en: "{0} voice messages", pl: "{0} wiadomości głosowych", lt: "{0} balso žinutės" },
  "{0} svar": { en: "{0} replies", pl: "{0} odpowiedzi", lt: "{0} atsakymai" },
  "{0} markeringer": { en: "{0} markings", pl: "{0} oznaczeń", lt: "{0} žymos" },
  "– {0} markeringer": { en: "– {0} markings", pl: "– {0} oznaczeń", lt: "– {0} žymos" },
  "talemelding": { en: "voice message", pl: "wiadomość głosowa", lt: "balso žinutė" },
  "tegning": { en: "drawing", pl: "rysunek", lt: "brėžinys" },
  "Siste": { en: "Latest", pl: "Ostatnie", lt: "Paskutinis" },
  "ansvarlig": { en: "responsible", pl: "odpowiedzialny", lt: "atsakingas" },
  "frist": { en: "deadline", pl: "termin", lt: "terminas" },
  "opprettet": { en: "created", pl: "utworzono", lt: "sukurta" },
  "KONTOR": { en: "OFFICE", pl: "BIURO", lt: "BIURAS" },
  "BYGGEPLASS": { en: "SITE", pl: "BUDOWA", lt: "STATYBVIETĖ" }
};
