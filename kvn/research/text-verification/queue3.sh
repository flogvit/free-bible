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
step "mekaniske signaler" node run.mjs --signals --n 40
step "felles skår"       node joint.mjs --n 40
step "tegnsetting"       node punct.mjs --n 40
step "leddekning"        node coverage.mjs 40
step "rangering"         node rank.mjs 40

# Dommerne. shots-auto er produksjonsvarianten (velger eksempler mekanisk);
# shots er med for å se om forskjellen holder seg på stort utvalg.
step "gemma4 mekanisk kalibrert" node run.mjs gemma4:31b --prompt E --shots-auto --n 40
step "granite4.1"                node run.mjs granite4.1:30b --prompt E --n 40
step "gemma4 fasit-kalibrert"    node run.mjs gemma4:31b --prompt E --shots --n 40
step "gemma4 rå"                 node run.mjs gemma4:31b --prompt E --n 40

step "ensemble"     node ensemble.mjs --dir verdicts-n40 --per-tr --cheapest
step "holdout"      node ensemble.mjs --dir verdicts-n40 --holdout
step "stratifisert" node strata.mjs --dir verdicts-n40
step "verdiktfordeling" node verdicts-analyse.mjs --dir verdicts-n40
