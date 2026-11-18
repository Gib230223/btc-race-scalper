# SCALP-10 — cbBTC scalper for btc-race-24h-20261118-1444

A selective scalping bot that trades Coinbase Wrapped BTC (cbBTC) on
1-minute bars with $1,000 of paper USDC. It does not chase every wiggle:
the dev window is a quiet grind down where a full round trip costs ~26 bps,
so the bot only fires on the two setups that actually pay, full size, and
banks each win before re-entering.

Race: entries close 20:44 UTC 18 Nov 2026; the live 24h race runs 20:59 UTC
18 Nov → 20:59 UTC 19 Nov. Only entries whose dev grade made money race.

## Strategy

- **A. Capitulation bounce** — a 1-minute drop of >=25 bps (or 2-bar
  >=35 bps) followed by a stabilising up bar: buy the exhaustion.
- **B. Recovery ride** — a close above its 60-bar high after a >=50 bps
  120-bar decline, on an up bar: buy the breakout.
- **Exits** — take profit +200 bps from the entry fill, hard stop -50 bps,
  trailing giveback 70 bps from the peak close, max hold 300 bars.
- **Discipline** — one position at a time, long only, full cash per entry,
  no new entries in the final hour (the window flattens everything at the
  close). Deterministic: no clock, no randomness.

## Files

- `main.ts` — the bot (Node 22, runs as `node main.ts`).
- `vendor/makefun-bars.ts` — the kit's bars-replay protocol shim.

## Local dev grade

Dev window (24h, 1,440 bars), confirmed by the kit's `grade-local`
(--driver process, two executions, reproduced byte for byte):
**+$20.54 net PnL, 4 trades (2 round trips, 100% win rate), max drawdown
1.28%**, fees $1.61 (still +$18.91 at 2x fees). Two round trips: the
capitulation bounce (+$1.45) and the recovery leg (+$19.09). That beats the
dev board's #1 at the time of building (+$17.96).

## License

MIT — see `LICENSE`.
