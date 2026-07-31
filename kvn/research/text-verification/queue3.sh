#!/bin/zsh
# BEKREFTELSESRUNDE — n=40, egen katalog (verdicts-n40).
#
# «0 av 210» betyr statistisk «under 1,4 % med 95 % sikkerhet», ikke null.
# ~1900 par gir ~1400 ekte feil, ~50 per forskyvningsbånd, og en øvre grense
# rundt 0,2 %. Det er dette som avgjør om resultatet er noe å bygge på.
#
# Fallgruver som allerede har kostet tid, ikke gjenta dem:
#  - `pgrep -f <skriptnavn>` i en ventesløyfe matcher sin EGEN kommandolinje og
#    henger for alltid. Kjør sekvensielt i stedet.
#  - Ulike utvalgsstørrelser MÅ til hver sin katalog: n=6 og n=40 gir ulike
#    utvalg, og blandes de, regner ensemblet over to testsett og svarer feil
#    uten å feile.
set -u
cd "$(dirname "$0")"

step() {
  echo
  echo "=============================================================="
  echo "== $1"
  echo "=============================================================="
  shift
  "$@" || echo "!! steget feilet (exit $?), fortsetter"
}

# Mekaniske signaler først — de er raske og trenger ingen dommer
step "mekaniske signaler" bun run.ts --signals --n 40
step "felles skår"       bun joint.ts --n 40
step "tegnsetting"       bun punct.ts --n 40
step "leddekning"        bun coverage.ts 40
step "rangering"         bun rank.ts 40

# Dommerne. shots-auto er produksjonsvarianten (velger eksempler mekanisk);
# shots er med for å se om forskjellen holder seg på stort utvalg.
step "gemma4 mekanisk kalibrert" bun run.ts gemma4:31b --prompt E --shots-auto --n 40
step "granite4.1"                bun run.ts granite4.1:30b --prompt E --n 40
step "gemma4 fasit-kalibrert"    bun run.ts gemma4:31b --prompt E --shots --n 40
step "gemma4 rå"                 bun run.ts gemma4:31b --prompt E --n 40

step "ensemble"     bun ensemble.ts --dir verdicts-n40 --per-tr --cheapest
step "holdout"      bun ensemble.ts --dir verdicts-n40 --holdout
step "stratifisert" bun strata.ts --dir verdicts-n40
step "verdiktfordeling" bun verdicts-analyse.ts --dir verdicts-n40
