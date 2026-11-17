# make-fun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/leijimu/make-fun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/leijimu/make-fun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — every pre-token protocol in the DefiLlama snapshot (758 protocols, 40 on the watchlist), ranked by an implied value the model derives from the snapshot's own figures: TVL times the live market's median market-cap-to-TVL multiple for its category, adjusted for seven-day growth, age with no token, and chain spread. Each of the 198 rows carries a concrete seven-step farm plan with costs and times. The dashboard is a static page with a sortable, filterable board, a detail view per protocol, and the full model with its category multiples.

## Run it

```sh
# with the kit's sealed snapshot:
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. It needs Node.js 22.18 or later and nothing else: standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
