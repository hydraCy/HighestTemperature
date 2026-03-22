# Baseline v1

This project is currently pinned to the following stable baseline markers:

- `certaintyContractVersion = "v1"`
- `modelBaselineVersion = "shanghai-rule-v1"`

## Included in this baseline

1. Probability engine baseline (`shanghai-rule-v1`)
2. `CertaintySummary` stable contract (`v1`)
3. Realtime stability script version tags in output
4. Page explainability layer wired to `certaintySummary` (`summaryZh` / `summaryEn`)

## Not included in this baseline

1. No trading-rule coupling from `certaintySummary`
2. No model structure change (distribution/sigma/cap logic unchanged in this baseline note)
3. No UI structure overhaul in this baseline note

This file is the reference starting point for future iterations.

