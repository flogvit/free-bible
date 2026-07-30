#!/bin/zsh
# Tekstverifisering av KVN-mappingene — inngangspunkt.
# Full beskrivelse: kvn/README.md → «Verifisere mappingene mot teksten»
set -u
cd "$(dirname "$0")/.."

: ${EMBED_MODEL:=bge-m3}
: ${JUDGE1:=gemma4:31b}
: ${JUDGE2:=granite4.1:30b}

usage() {
  cat <<TXT
Tekstverifisering av KVN-mappingene.

  ./scripts/run-verification.sh maal        mål farten på DENNE maskinen (~30 min)
  ./scripts/run-verification.sh struktur    gratis strukturrunde — kjør denne først
  ./scripts/run-verification.sh pri1        de 81 åpne oversettelsene
  ./scripts/run-verification.sh pri1,2      åpne + mest brukte per språk
  ./scripts/run-verification.sh alle        alle 1157
  ./scripts/run-verification.sh rapport     arbeidsliste fra det som er dømt
  ./scripts/run-verification.sh rapport --list --limit 40

Rekkefølge:
  1. «maal»     — anslaget er 25 s/vers på en M1 Max, men det er REGNET, ikke
                  målt. Dette gir det virkelige tallet, og avgjør om pri1 tar
                  åtte måneder eller to år.
  2. «struktur» — finner osmain-vers der oppslaget ikke kan lykkes uansett hva
                  teksten sier (168 774 ved første kjøring). Gratis, ingen modell.
                  Å hoppe over den betyr måneder med GPU-tid på uoppnåelige vers.
  3. «pri1»     — fem pass, ett per modell, sekvensielt.

Viktig:
  · Ikke kjør to pass samtidig, og ikke bruk ollama til noe annet mens dette går.
    To modeller i minnet gir utkasting mellom kallene: 11 s/vers mot 3,5.
  · Ctrl-C koster ingenting. Alt er gjenopptakbart per kapittel — samme kommando
    fortsetter der den var.
  · Rekkefølgen på oversettelsene: research/text-verification/priority.txt

Modeller (overstyres med EMBED_MODEL / JUDGE1 / JUDGE2):
  $EMBED_MODEL, $JUDGE1, $JUDGE2
TXT
}

MODE="${1:-}"
[[ -z "$MODE" || "$MODE" == "-h" || "$MODE" == "--help" ]] && { usage; exit 0; }

# Sjekker modellene som FAKTISK brukes, ikke hardkodede navn.
need() {
  for m in "$@"; do
    # ollama lister «bge-m3:latest», så basenavnet kan følges av : eller mellomrom
    ollama list 2>/dev/null | grep -qE "^${m%%:*}(:|[[:space:]])" || {
      echo "!! modellen «$m» er ikke lastet ned."
      echo "   ollama pull $m"
      exit 1
    }
  done
}

case "$MODE" in
  maal)
    need "$EMBED_MODEL" "$JUDGE1" "$JUDGE2"
    echo "== måler på 3 kapitler av kjv, ~80 vers per pass =="
    echo "   modeller: $EMBED_MODEL, $JUDGE1, $JUDGE2"
    echo
    for p in prep mech judge1 judge2 verdict; do
      echo "-- pass $p"
      npx tsx scripts/verify-text.ts --pass "$p" kjv --limit 3 --force 2>&1 | tail -2
    done
    cat <<'TXT'

Regn om til hele jobben:
  sekunder per vers × 2 500 000 = sekunder for pri1
  del på 86 400 for døgn, på 31 500 000 for år
  (grovt: 1 sekund per vers ≈ 1 måned for pri1)
Summér judge1 og judge2; de mekaniske passene er småtteri ved siden av.
TXT
    ;;

  struktur)
    echo "== strukturell dekningssjekk (ingen modell, ingen GPU) =="
    npx tsx scripts/check-mapping-coverage.ts "${@:2}"
    ;;

  rapport)
    npx tsx scripts/verify-text-report.ts "${@:2}"
    ;;

  pri*|alle)
    need "$EMBED_MODEL" "$JUDGE1" "$JUDGE2"
    if [[ "$MODE" == "alle" ]]; then SEL=(); else SEL=(--priority "${MODE#pri}"); fi

    if [[ ! -f data/mapping-coverage.json ]]; then
      cat <<'TXT'
!! Kjør strukturrunden først:

     ./scripts/run-verification.sh struktur

   Den er gratis og finner de versene der oppslaget ikke kan lykkes uansett hva
   teksten sier — 168 774 ved første kjøring. Uten den brukes måneder med
   GPU-tid på vers som er uoppnåelige.
TXT
      exit 1
    fi

    for p in prep mech judge1 judge2 verdict; do
      echo
      echo "=============================================================="
      echo "== pass $p   $(date '+%Y-%m-%d %H:%M')"
      echo "=============================================================="
      if ! npx tsx scripts/verify-text.ts --pass "$p" "${SEL[@]}"; then
        rc=$?
        echo
        if [[ $rc -eq 130 || $rc -eq 143 ]]; then
          echo "-- avbrutt i pass $p. Ingenting er tapt."
        else
          echo "!! pass $p feilet (exit $rc)."
        fi
        echo "   Kjør samme kommando igjen — den fortsetter der den var."
        exit $rc
      fi
    done

    echo
    npx tsx scripts/verify-text-report.ts
    ;;

  *)
    echo "ukjent modus: $MODE"
    echo
    usage
    exit 1 ;;
esac
