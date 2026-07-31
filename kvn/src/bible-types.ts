// ============================================================
// Versdataformen i generate/bibles_raw/<oversettelse>/<bok>/<kapittel>.json
//
// Denne fila er den delte sannheten om formen. Før den fantes beskrev
// `load-bible.ts` en privat `RawVerse` med fire felter, mens skriptene i
// `generate/` leste de samme filene med `JSON.parse` og dynamisk feltaksess
// — ingenting bandt dem sammen, så en endring i betydningen av `versions[]`
// eller `checked` hadde ingen kompilator som kunne finne stedene som måtte
// følge med.
// ============================================================

/**
 * Hvorfor en tidligere lesning ble erstattet.
 *
 * Engelske identifikatorer, i motsetning til `Footnote.source` — se der.
 */
export type VersionType = 'suggestion' | 'correction' | 'alternative';

/** Hvor mye en endring betyr. */
export type Severity = 'minor' | 'moderate' | 'major';

/**
 * Kilden til en fotnote.
 *
 * **Verdiene er norske i ALLE språk** (`oversettelse`, `lingvistisk`, …).
 * Det er ikke en glipp: dette er delte identifikatorer, ikke visningstekst.
 * Selve fotnoteteksten (`Footnote.text`) skrives på oversettelsens eget språk.
 * De fleste andre enumene i dataene er engelske, så asymmetrien ser ut som en
 * feil og er blitt «rettet» før.
 */
export type FootnoteSource =
    | 'oversettelse'
    | 'lingvistisk'
    | 'historisk'
    | 'geografisk'
    | 'kulturelt'
    | 'teologisk'
    | 'tekstkritisk';

/** En tidligere lesning av verset, eldst først. */
export interface VerseVersion {
    text: string;
    type: VersionType;
    severity: Severity;
    explanation: string;
    /**
     * `true` = dette er et gyldig valg å vise leseren, ikke bare historikk.
     *
     * Dette feltet er brukervendt dybde, ikke internt bokholderi: variasjon
     * mellom gjengivelser ER produktet. Det er også det som hindrer at
     * korrekturen svinger fram og tilbake, så poster blir stående selv når
     * den tidligere lesningen var feil.
     */
    alternative?: boolean;
}

export interface Footnote {
    text: string;
    source: FootnoteSource;
}

/**
 * Gjenopptaksmarkør på formen `versions.length:text.length`, f.eks. `"3:214"`.
 *
 * Alt som endrer verset ugyldiggjør markøren, så et vers som er blitt tømt
 * blir sjekket på nytt automatisk når det trenger det. Egen type framfor
 * `string` fordi formatet er en avtale, ikke fritekst.
 */
export type ResumeMarker = `${number}:${number}`;

/** Gjenopptaksmarkører for de to bunkekorrektur-modusene. */
export interface CheckedMarkers {
    length?: ResumeMarker;
    changed?: ResumeMarker;
}

/** Ett vers slik det ligger på disk. */
export interface Verse {
    bookId: number;
    chapterId: number;
    verseId: number;
    text: string;
    /** Tidligere lesninger, nyeste sist. */
    versions?: VerseVersion[];
    footnotes?: Footnote[];
    /** Per-vers gjenopptaksmarkør for korrekturen. */
    textChecked?: boolean;
    checked?: CheckedMarkers;
}

/** Et kapittel er ganske enkelt versene sine. */
export type Chapter = Verse[];

/**
 * Delvers-nummer: 0 = helt vers, 1 = a, 2 = b, …
 *
 * Brukes når osmain slår sammen flere oversettelsesvers til ett. Se
 * `kvn/README.md` → *Sub-vers mapping (part-feltet)*.
 */
export type Part = number;
