#!/bin/zsh
# Svake språk: bge-m3-baserte signaler er målt på oversettelser med likhet
# 0,66-0,87. Korpuset har mye lavere — hcv 0,573, maori 0,607, burmesisk 0,706,
# kinesisk 0,724. Der er simZ, leddekning og rangering svakere, mens tegnsetting
# og lengde er upåvirket. Uten denne målingen gjelder tallene bare halve korpuset.
set -u
cd "$(dirname "$0")"
step() { echo; echo "=============================================================="; echo "== $1"; echo "=============================================================="; shift; "$@" || echo "!! feilet, fortsetter"; }

step "testsett: svake språk" bun matrix.ts \
  --tr hcv,maori,my_judson,chinese_union_simp,ta_irv,pa_irv,kn_irv,te_irv \
  --out testset-svak.json
