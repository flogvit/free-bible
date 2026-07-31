# Lage en ny bibeloversettelse

Fra ingenting til en publiserbar oversettelse. Rekkefølgen under er den `osen`
faktisk ble laget i (commit `7fc76c25c`, 2026-07-26) — 31 167 vers i 66 bøker.

Flaggene som nevnes er beskrevet i [skript.md](skript.md). Tilleggsmaterialet —
sammendrag, kontekst, kryssreferanser, personer — hører til
[tilleggsmateriale.md](tilleggsmateriale.md); denne kokeboka stopper når selve
bibelteksten er ferdig og indeksert.

## Kostnad før du begynner

Målt med Claude Opus 5, per vers og for hele Bibelen:

| steg | per vers | hele bibelen |
|---|---|---|
| oversettelse | $0,0022 | $70 |
| bunkekorrektur, stopper på skår 8 | $0,0055 | $171 |
| bunke, 3 tvungne runder | $0,0168 | $524 |
| per-vers, kun tekst | $0,0364 | $1 135 |

**Å oversette et vers på nytt koster omtrent 1/16 av å korrekturlese det.** Det
er verdt å huske når du vurderer en ekstra korrekturrunde mot å bare kjøre
oversettelsen igjen.

---

## Steg 0 — Bestem stilen, og skriv den inn

Stilen ligger i `generate/constants.ts` → `bibleStyles`, ikke i en CLI-standard:

```ts
export const bibleStyles: Record<string, string> = {
    osnb: "oral",
    osnn: "oral",
    osen: "oral",
    oses: "oral",
};
```

**Dette er ikke en detalj.** Et skript som kjøres uten `--style` faller tilbake
på `"standard"`, og stilen lagres **ikke** i versdataene. En oversettelse laget
mot feil brief kan derfor ikke oppdages i ettertid — du ser bare tekst som er
litt annerledes enn resten, uten å vite hvorfor.

Legg til den nye oversettelsen i `bibleStyles` **før** du kjører noe.

## Steg 1 — Navngi den

Grunnformen er språkkoden: `osnb`, `osnn`, `osen`, `oses`. Varianter tar et
suffiks (`osnb-child`). **Aldri et løpenummer** — `osnb2`, `osnn1` og `osnb1`
ble omdøpt bort 2026-07-26 fordi de ikke sier noe om hva som skiller dem.

## Steg 2 — Oversett

```bash
bun generate/bible.ts <navn> --style oral --ot      # Det gamle testamentet
bun generate/bible.ts <navn> --style oral --nt      # Det nye
bun generate/bible.ts <navn> --style oral --book 1-5
```

**Kapittel er oversettelsesenheten**, og grunnen er god: setninger krysser
nesten aldri en kapittelgrense, så et kapittel gir versene den sammenhengen de
trenger. Ikke prøv å oversette bok for bok eller vers for vers.

Kilden er grunnteksten i `generate/bibles_raw/tanach/` og `.../sblgnt/`, som
importeres av `make_tanach.ts` og `make_sblgnt.ts` fra `external/bibles/`.

## Steg 3 — Korrekturles

**Bruk `--batch`.** Den sender kapitlet i noen få kall og får bare funnene
tilbake, i en tilbakemeldingssløyfe til kapitlet når `--min-score` eller
rundene tar slutt.

```bash
bun generate/bible.ts <navn> --proofread --batch --apply --min-score 8
```

Det er metoden som produserte `osnb` — 99,2 % av kapitlene der er korrekturlest
slik — og den er **6,6× billigere** enn per-vers.

Per-vers-modus (uten `--batch`) leser hvert vers med naboene sine, i to faser:
tekst, så fotnoter. Grundigere, men dyr. `--text-only` hopper over fotnotefasen.

## Steg 4 — De målrettede andrerundene

Begge er **gratis å kjøre på nytt**, fordi de skriver gjenopptaksmarkører.

```bash
bun generate/bible.ts <navn> --proofread --check-length --apply
bun generate/bible.ts <navn> --proofread --changed-only --apply
```

**`--check-length` fanger en ekte og gjentakende feil.** Modellen returnerer
noen ganger bare frasen den var fokusert på i `suggested`, og dropper resten av
verset. **97 vers i `osen` ble avkortet slik**, deriblant hele gudstalen i
1 Mos 28:13. En lengdevakt (`MIN_LENGTH_RATIO`) avviser slike forslag ved
skriving nå, men runden finnes fordi det skjedde.

`--changed-only` går gjennom vers som allerede er endret, eventuelt filtrert på
type. Målene drar med seg naboene sine, merket `[context only]` i prompten.

### Gjenopptaksmarkørene

`checked` er `versions.length:text.length`, f.eks. `"3:214"`. Alt som endrer
verset ugyldiggjør markøren, så et vers som er blitt tømt blir sjekket på nytt
automatisk når det trenger det. Det er derfor du kan kjøre andrerundene så ofte
du vil uten å betale for arbeid som allerede er gjort.

## Steg 5 — KVN-mapping

Følger oversettelsen **hebraisk/gresk versifikasjon** — Joel har 4 kapitler,
Jona 1 har 16 vers — deler den mapping med `osnb` og `osnn`, og du trenger ikke
lage en ny. Det var tilfellet for `osen`.

Følger den europeisk nummerering, må du lage en:

```bash
bun kvn/scripts/generate-mapping.ts --source <navn> --format raw
```

Les [`kvn/README.md`](../kvn/README.md) først. Mappingen går gjennom `osmain`
som nav — ikke gjennom `osnb`.

## Steg 6 — `meta.json` og `license.json`

Begge ligger i `generate/bibles_raw/<navn>/`.

**`license.json` er ikke valgfri.** Uten den blir oversettelsen **stille**
utelatt fra `translations/index.json` — ingen feilmelding, den bare finnes ikke
for konsumentene. Feltene:

```json
{
  "translation": "osen",
  "name": "Open Source English",
  "language": "English",
  "license": "CC BY",
  "spdx": "CC-BY-4.0",
  "attribution_required": true,
  "noncommercial": false,
  "kvn_renumber_ok": true,
  "source": "manual",
  "statement": "..."
}
```

`statement` må bære videre forpliktelsene fra grunnteksten. SBLGNT er CC BY 4.0,
og **den forpliktelsen arves av alt som er oversatt fra den** — også av denne
oversettelsen og av alt som avledes videre.

`meta.json` har feltene `translation`, `name`, `abbreviation`, `language`,
`philosophy`, `tradition`, `textual_basis`, `body`, `work`, `links`, `legacy`,
`coverage`, `features`, `provenance`. `coverage` regnes ut fra dataene — ikke
skriv den for hånd.

## Steg 7 — Regenerer indeksen

```bash
bun generate/translations_index.ts
```

**Kjør denne etter enhver endring i `meta.json` eller `license.json`.** Den
bygger `generate/translations/index.json`, som er det konsumentene leser.

---

## Sjekkliste

- [ ] navnet følger konvensjonen (språkkode, ev. med suffiks — aldri løpenummer)
- [ ] stilen står i `constants.ts` → `bibleStyles`
- [ ] oversatt med eksplisitt `--style`
- [ ] korrekturlest med `--batch`
- [ ] `--check-length` kjørt
- [ ] KVN-mapping finnes, eller det er bekreftet at den deler en eksisterende
- [ ] `meta.json` og `license.json` på plass
- [ ] `translations_index.ts` kjørt, og oversettelsen finnes i `index.json`
- [ ] `bun run test` er grønn
