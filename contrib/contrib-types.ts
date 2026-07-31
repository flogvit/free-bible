// ============================================================
// Køformen i contrib/queue/*.json — «free-bible-contrib/1».
//
// Kontrakten selv står i contrib/verse-ref-contrib.schema.json; denne fila er
// den samme formen uttrykt for kompilatoren, slik at check.ts, review.ts og
// export.ts leser de samme filene gjennom én type i stedet for tre private
// varianter som kan drive fra hverandre.
//
// Merk at en køfil er UVALIDERT input: check.ts sin validateDoc() finnes
// nettopp fordi fila kan bryte kontrakten. Typene her beskriver derfor den
// GYLDIGE formen — de er ikke en garanti om hva som faktisk ligger på disk.
// ============================================================

/** Hva målet er. Samme refs-modell for alle tre. */
export type ContribKind = 'article_verse_refs' | 'book_verse_refs' | 'song_verse_refs';

/**
 * Hvor sterkt verket berører verset.
 *
 * `cites` = eksplisitt referanse, `discusses` = reell behandling,
 * `covers_passage` = verket/kapittelet handler om avsnittet (kommentarer).
 */
export type ContribRefKind = 'cites' | 'discusses' | 'covers_passage';

/** Moderasjonstilstanden: pending → approved | rejected | needs_info. */
export type ContribReviewStatus = 'pending' | 'needs_info' | 'approved' | 'rejected';

/** Hvem som løste `raw` → KVN. */
export type ContribResolvedBy = 'frontend' | 'pipeline' | 'reviewer';

/** Fritekst-fallback når ingen identifikator er kjent. */
export interface ContribFreetext {
    title: string;
    authors?: string[];
    year?: number;
    publisher_or_journal?: string;
}

/** Identifikasjon av artikkelen/boka/sangen. Minst ett felt skal være satt. */
export interface ContribTarget {
    catalog_id?: string;
    doi?: string;
    isbn13?: string;
    isbn10?: string;
    openlibrary_id?: string;
    song_id?: string;
    url?: string;
    freetext?: ContribFreetext;
}

/** Valgfri lokalisering inne i verket. `quote` publiseres aldri (opphavsrett). */
export interface ContribWhere {
    page?: number;
    chapter_or_section?: string;
    quote?: string;
}

export interface ContribRef {
    /** Nøyaktig det bidragsyteren skrev — aldri normalisert bort. */
    raw: string;
    /** Oversettelsen `raw` er uttrykt i; uten den er «Salme 51,3» tvetydig. */
    context_translation: string;
    /**
     * Kanonisk KVN fra `encode()` i kvn/src/types.ts — IKKE `ukvnEncode`.
     * Fylles inn av pipeline/reviewer, og er påkrevd før godkjenning.
     */
    kvnFrom?: number;
    kvnTo?: number;
    kvnRef?: string;
    resolved_by?: ContribResolvedBy;
    confirmed_by_contributor?: boolean;
    kind: ContribRefKind;
    where?: ContribWhere;
}

export interface ContribSubmittedBy {
    user_id: string;
    name?: string;
    credit?: boolean;
}

export interface ContribSubmitted {
    at: string;
    by: ContribSubmittedBy;
    client?: string;
}

export interface ContribReview {
    status: ContribReviewStatus;
    reviewer?: string;
    at?: string;
    note?: string;
}

/**
 * Én forfatter slik Crossref oppgir dem — begge feltene kan mangle.
 *
 * Både check.ts (fasit i review.note) og export.ts (metadata i verse_works)
 * slår opp DOI-er mot Crossref og setter sammen navnet på samme måte.
 */
export interface CrossrefAuthor {
    given?: string;
    family?: string;
}

/** Én innsending — én fil i contrib/queue/. */
export interface ContribDoc {
    /** Kontraktverdien er `'free-bible-contrib/1'`; typet vidt fordi
     *  validateDoc() nettopp skal kunne se at en fil har noe annet. */
    schema: string;
    kind: ContribKind;
    target: ContribTarget;
    refs: ContribRef[];
    comment?: string;
    submitted: ContribSubmitted;
    review: ContribReview;
}
