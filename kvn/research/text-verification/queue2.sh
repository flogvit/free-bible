#!/bin/zsh
# Resten av forskningsprogrammet.
#
# MERK to fallgruver som allerede har kostet tid:
#  - `pgrep -f <skriptnavn>` i en ventesløyfe matcher sin EGEN kommandolinje og
#    henger for alltid. Ikke vent på navn; kjør sekvensielt.
#  - Ulike utvalgsstørrelser MÅ skrive til hver sin katalog. n=6 og n=40 gir
#    forskjellige utvalg (steglengden avhenger av N), så blandes de, regner
#    ensemblet over to ulike testsett og svarer feil uten å feile.
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

# --- Kalibrering uten fasit. Kritisk: --shots tar eksemplene fra fasiten, som
#     ikke finnes i produksjon. --shots-auto velger dem på likhet og lengde.
step "gemma4 kalibrert MEKANISK"  node run.mjs gemma4:31b --prompt E --shots-auto --n 6
step "ensemble n=6"               node ensemble.mjs --cheapest

# --- Kompetanse per oversettelse. Trenger ingen fasit, så den kan kjøres på
#     alle 1158. Avgjør hvilken protokoll hver oversettelse trenger.
step "kompetanse: 32 pri1-språk" node competence.mjs \
  kjv,bsb,luther_1912,segond_1910,rv_1909,synodal,diodati,almeida_rc,cornilescu,albanian,swahili,thaikjv,cadman,indo_tm,tagab,maori,hcv,my_judson,bn_irv,ta_irv,te_irv,kn_irv,gu_irv,mr_irv,pa_irv,irv,ha_con,kougo,chinese_union_simp,svd,opt,finn \
  --n 30

# ============================================================
# BEKREFTELSESRUNDE — n=40, egen katalog
# ============================================================
# Null bom på 210 forsøk betyr «under 1,4 % med 95 % sikkerhet», ikke null.
# ~1900 par gir ~1400 ekte feil og ~50 per forskyvningsbånd.
step "BEKREFT: mekaniske signaler" node run.mjs --signals --n 40
step "BEKREFT: felles skår"        node joint.mjs --n 40
step "BEKREFT: tegnsetting"        node punct.mjs --n 40
step "BEKREFT: leddekning"         node coverage.mjs 40
step "BEKREFT: rangering"          node rank.mjs 40
step "BEKREFT: gemma4 kalibrert"   node run.mjs gemma4:31b --prompt E --shots --n 40
step "BEKREFT: gemma4 mekanisk kal." node run.mjs gemma4:31b --prompt E --shots-auto --n 40
step "BEKREFT: gemma4 rå"          node run.mjs gemma4:31b --prompt E --n 40
step "BEKREFT: ensemble"           node ensemble.mjs --dir verdicts-n40 --per-tr --cheapest
step "BEKREFT: holdout"            node ensemble.mjs --dir verdicts-n40 --holdout
step "BEKREFT: stratifisert"       node strata.mjs --dir verdicts-n40

# --- Er falsk alarm systematisk B_EXTRA? ---
# 15 av 15 leste falske alarmer var B_EXTRA: osmain er bygget fra osnb og er
# tersere enn ordrette oversettelser, så KJV og Reina-Valera «har mer» uten at
# noe er galt. Fletting — den ekte feilen B_EXTRA skal fange — gir et HELT
# ekstra vers og slår derfor også ut på lengde. Så B_EXTRA alene bør ikke flagge.
step "verdikt lagret: gemma4 mek.kal." node run.mjs gemma4:31b --prompt E --shots-auto --n 6 --force
step "verdikt lagret: granite"         node run.mjs granite4.1:30b --prompt E --n 6 --force
step "ensemble m/verdikter"            node ensemble.mjs --cheapest
