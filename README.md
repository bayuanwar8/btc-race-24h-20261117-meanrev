# btc-race-24h-20261117-meanrev

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/bayuanwar8/btc-race-24h-20261117-meanrev/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/bayuanwar8/btc-race-24h-20261117-meanrev/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Bot trading cbBTC vs USDC untuk bounty [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261117-0603) di make.fun. Strategi: **RSI + Bollinger mean reversion** — beli saat kapitulasi (RSI oversold ekstrem + harga di bawah lower Bollinger band + jatuh ≥1% dari puncak 60 bar), jual saat recovery overbought (RSI > 75), dengan trailing stop 2% dan hard stop 2% sebagai pengaman. Jarang trade (target 1–4 trade per 24 jam): sekali round trip makan ~26 bps, jadi tiap trade harus menangkap gerakan besar, bukan scalping noise bar 1-menit.

Backtest lokal di dev window (1.440 bar, model fill harness): **net PnL +12,82 USDC, 3 round trip, max drawdown -1,00%** — lolos dev gate (PnL > 0).

## Run it

```sh
node /bot/main.ts
```

Bot berbicara protokol `agent-fun/bars-replay/v1` lewat stdin/stdout (JSON per baris) via `vendor/makefun-bars.ts` (salinan byte-identical dari SDK kit). Deterministik: tidak membaca jam, environment, atau angka acak.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
