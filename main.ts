// SCALP-10: a selective cbBTC scalper for btc-race-24h-20261118-1444.
//
// Idea (from the dev-window data, not from a hunch): the 24h dev window is a
// quiet grind down (-2.8%, 1m stdev ~7 bps) where a full round trip costs
// ~26 bps, so frequent small scalps lose money. The only moves that pay are
// (a) the sharp capitulation bounce and (b) the one 2% recovery leg. This bot
// therefore trades RARELY and only on those two setups, full size, and banks
// each win before re-entering on the next setup:
//   A. Capitulation bounce: a 1-minute drop of >=25 bps (or 2-bar >=35 bps)
//      followed by a stabilising up bar -> buy the exhaustion.
//   B. Recovery ride: a close above its 60-bar high after a >=50 bps
//      120-bar decline, on an up bar -> buy the breakout.
// Exits (from the executed entry price): take profit +200 bps, hard stop
// -50 bps, trailing giveback 70 bps from the peak close. One position at a
// time, long only, full $1,000 cash per entry. Deterministic: no clock, no
// randomness; every decision comes from the bars the harness sent.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters (tuned on the kit dev window by local replay).
const CAP1_BPS = 25; // 1-bar capitulation drop, bps
const CAP2_BPS = 35; // 2-bar capitulation drop, bps
const BREAKOUT_W = 60; // breakout lookback, bars
const DECLINE_BPS = 50; // 120-bar decline required before a breakout buy, bps
const TP_BPS = 200; // take profit from the entry fill, bps
const STOP_BPS = 50; // hard stop from the entry fill, bps
const TRAIL_BPS = 70; // trailing giveback from the peak close, bps
const MAX_HOLD = 300; // longest hold, scored bars (the recovery leg runs ~255)
const NO_ENTRY_AFTER = 1380; // scored bars: no new entries in the final hour,
// so a late entry can never be forced flat at the window's close
const MAX_SLIP_BPS = 200; // max slippage allowed on any order, bps

// Closes in USD, oldest first, one per scored bar.
const closes: number[] = [];
// Entry state, set from the buy fill; zero/negative while flat.
let entryPx = 0;
let entrySeq = -1;
let peakClose = 0;

function retBps(fromIdx: number, toIdx: number): number {
  return (closes[toIdx] / closes[fromIdx] - 1) * 10000;
}

function rollingMax(endExclusive: number, w: number): number {
  let m = -Infinity;
  const start = Math.max(0, endExclusive - w);
  for (let i = start; i < endExclusive; i++) {
    if (closes[i] > m) m = closes[i];
  }
  return m;
}

function onBatch(state: BarsState, batch: Batch) {
  if (state.warmingUp) return [];
  const s = state.seq - state.warmupBars; // scored bar index
  const close = state.close(SYMBOL);
  if (close === null) return [];
  const priceScale = state.symbols.get(SYMBOL)?.price_scale ?? 5;
  const closeUsd = Number(close) / 10 ** priceScale;
  closes.push(closeUsd);

  // Fold this batch's fills in: a buy fill fixes the entry price.
  for (const f of batch.fills) {
    if (f.symbol !== SYMBOL || f.status !== 'filled') continue;
    if (f.side === 'buy') {
      entryPx = Number(f.price) / 10 ** priceScale;
      entrySeq = s;
      peakClose = entryPx;
    } else {
      entryPx = 0;
      entrySeq = -1;
      peakClose = 0;
    }
  }

  const pos = state.positions.get(SYMBOL);
  const holding = pos !== undefined && pos.qty > 0n;

  if (holding && entryPx > 0) {
    if (closeUsd > peakClose) peakClose = closeUsd;
    const pnlBps = (closeUsd / entryPx - 1) * 10000;
    const givebackBps = (peakClose / closeUsd - 1) * 10000;
    if (pnlBps >= TP_BPS) {
      return [{ side: 'sell' as const, symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIP_BPS }];
    }
    if (pnlBps <= -STOP_BPS) {
      return [{ side: 'sell' as const, symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIP_BPS }];
    }
    if (givebackBps >= TRAIL_BPS) {
      return [{ side: 'sell' as const, symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIP_BPS }];
    }
    if (s - entrySeq >= MAX_HOLD) {
      return [{ side: 'sell' as const, symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIP_BPS }];
    }
    return [];
  }

  // Flat: look for an entry. Full cash, one position at a time.
  // Never open in the final hour: the window flattens everything at the
  // close, so a late entry only pays the round-trip cost.
  if (s >= NO_ENTRY_AFTER) return [];
  if (state.cash <= 1_000_000n) return [];
  const n = closes.length;
  const cur = closes[n - 1];
  const prev = closes[n - 2];
  if (prev === undefined) return [];

  // A. Capitulation bounce: sharp drop, then a stabilising up bar.
  // The drop is measured on the PREVIOUS bar (r1 = its 1m return, r2 = the
  // 2-bar return ending at it); the current bar must be up (stabilising).
  // Measuring the drop on the current bar would be impossible: an up bar
  // can never be down 25 bps.
  if (n >= 4) {
    const r1 = retBps(n - 3, n - 2); // previous bar's 1m return, bps
    const r2 = retBps(n - 4, n - 2); // previous 2 bars' return, bps
    if ((r1 <= -CAP1_BPS || r2 <= -CAP2_BPS) && cur > prev) {
      return [{ side: 'buy' as const, symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIP_BPS }];
    }
  }

  // B. Recovery ride: new 60-bar high after a 120-bar decline, on an up bar.
  // The high and the decline are both measured to the PREVIOUS bar.
  if (n >= 122) {
    const high = rollingMax(n - 2, BREAKOUT_W);
    const decline = retBps(n - 122, n - 2); // 120-bar return to the prior bar, bps
    if (cur >= high && decline <= -DECLINE_BPS && cur > prev) {
      return [{ side: 'buy' as const, symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIP_BPS }];
    }
  }

  return [];
}

await runBars({ onBatch });
