#!/bin/zsh
# Sekvensiell køkjører for forskningsprogrammet.
#
# Alt går serielt — GPU-en er flaskehalsen, og parallelle kjøringer gir bare
# misvisende tidsmålinger.
#
# MERK: ingen `pgrep -f <skriptnavn>` for å vente. En slik ventesløyfe matcher
# sin EGEN kommandolinje (den inneholder navnet den leter etter) og henger for
# alltid. Det låste hele køen én gang. Vent på PID, eller ikke i det hele tatt.
#
# Kjør:  ./queue.sh [pid-å-vente-på]  2>&1 | tee -a queue.log
set -u
cd "$(dirname "$0")"

if [[ $# -ge 1 ]]; then
  echo "venter på pid $1 …"
  while kill -0 "$1" 2>/dev/null; do sleep 20; done
  echo "pid $1 ferdig"
fi

step() {
  echo
  echo "=============================================================="
  echo "== $1"
  echo "=============================================================="
  shift
  "$@" || echo "!! steget feilet (exit $?), fortsetter"
}

# Mekanisk, treffer der alt annet er svakest (GRENSE)
step "leddekning (bge-m3, ingen LLM)" node coverage.mjs 6

# Referansedommeren, per par — grunnlaget for alle ensembler
step "gemma4 (referanse)" node run.mjs gemma4:31b --prompt E --n 6

# Hjelper eksempler fra samme oversettelse mot falsk alarm?
step "gemma4 + kalibreringseksempler" node run.mjs gemma4:31b --prompt E --shots --n 6

# Tenkemodus — aldri testet
step "gemma4 + tenkemodus" node run.mjs gemma4:31b --prompt E --think --n 6

# Andre familier, for ensemble
step "qwen3.5:27b" node run.mjs qwen3.5:27b --prompt E --n 6
step "granite4.1:30b" node run.mjs granite4.1:30b --prompt E --n 6

for m in aya:35b sailor2:20b; do
  if ollama list 2>/dev/null | grep -q "^${m%%:*}"; then
    step "$m" node run.mjs "$m" --prompt E --n 6
  else
    echo "-- $m ikke nedlastet, hopper over"
  fi
done

step "ENSEMBLE"            node ensemble.mjs --per-tr
step "STRATIFISERT"        node strata.mjs
step "EKTE FEIL (FUNN.md)" node real-errors.mjs gemma4:31b

# --- Tillegg: identitet og dekning som ADSKILTE spørsmål ---
# Å spørre «bærer de samme innhold?» blander to ting. Identitet (er dette samme
# vers?) skal være raus med fri gjengivelse; dekning (mangler noe?) skal ikke.
step "gemma4 IDENTITET"  node run.mjs gemma4:31b --prompt ID  --n 6
step "gemma4 DEKNING"    node run.mjs gemma4:31b --prompt COV --n 6
step "ENSEMBLE (oppdatert)" node ensemble.mjs --per-tr

# --- Runde to: dobbeltsjekk begge veier på DEKNING ---
step "gemma4 DEKNING + ombytting" node run.mjs gemma4:31b --prompt COV --swap --n 6
step "ENSEMBLE (endelig)"        node ensemble.mjs --per-tr
step "STRATIFISERT (endelig)"    node strata.mjs

# --- Runde to, alternativ vei: tilbakeoversett og sammenlikn enspråklig ---
step "tilbakeoversettelse" node backtranslate.mjs gemma4:31b --n 6
step "ENSEMBLE (m/tilbakeoversettelse)" node ensemble.mjs --per-tr
step "STRATIFISERT (m/tilbakeoversettelse)" node strata.mjs

# --- Enspråklig dom på tilbakeoversettelsen ---
step "dom norsk mot norsk" node judge-nb.mjs gemma4:31b
step "ENSEMBLE (alt)"      node ensemble.mjs --per-tr
step "STRATIFISERT (alt)"  node strata.mjs

# ============================================================
# BEKREFTELSESRUNDE — stort utvalg
# ============================================================
# Null bom på 210 forsøk betyr «under 1,4 % med 95 % sikkerhet», ikke null.
# --n 40 gir ~1900 par, ~1400 ekte feil, og ~50 per forskyvningsbånd. Da blir
# den øvre grensen ~0,2 % og båndtallene noe å stole på.
step "BEKREFT: mekaniske signaler" node run.mjs --signals --n 40
step "BEKREFT: felles skår"        node joint.mjs --n 40
step "BEKREFT: tegnsetting"        node punct.mjs --n 40
step "BEKREFT: leddekning"         node coverage.mjs 40
step "BEKREFT: rangering"          node rank.mjs 40
step "BEKREFT: gemma4"             node run.mjs gemma4:31b --prompt E --n 40
step "BEKREFT: gemma4 kalibrert"   node run.mjs gemma4:31b --prompt E --shots --n 40
step "BEKREFT: ensemble"           node ensemble.mjs --per-tr
step "BEKREFT: stratifisert"       node strata.mjs

# --- Kalibrering uten fasit: eksemplene velges mekanisk ---
# Kritisk for produksjon. --shots tar eksemplene fra fasiten, som ikke finnes
# når vi faktisk skal verifisere. --shots-auto velger dem på likhet og lengde.
step "gemma4 kalibrert MEKANISK" node run.mjs gemma4:31b --prompt E --shots-auto --n 6
step "ENSEMBLE (m/mekanisk kalibrering)" node ensemble.mjs --cheapest

# ============================================================
# KOMPETANSE PER OVERSETTELSE — trenger ingen fasit
# ============================================================
# Avgjør hvilken protokoll hver oversettelse trenger. Kjøres på et bredt utvalg
# språk, ikke bare de tolv i testsettet.
step "kompetanse: pri1-utvalg" node competence.mjs kjv,bsb,luther_1912,segond_1910,rv_1909,synodal,diodati,almeida_rc,cornilescu,albanian,swahili,thaikjv,cadman,indo_tm,tagab,maori,hcv,my_judson,bn_irv,ta_irv,te_irv,kn_irv,gu_irv,mr_irv,pa_irv,irv,ha_con,kougo,chinese_union_simp,svd,opt,finn --n 30
