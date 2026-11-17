// Bot mean-reversion untuk make.fun btc-race-24h-20261117-0603.
//
// Idenya sederhana: Bitcoin di bar 1-menit itu berisik, jadi bot ini hampir
// tidak pernah trade. Ia hanya masuk saat pasar benar-benar kapitulasi
// (oversold ekstrem + harga jatuh jauh dari puncak sejam terakhir), lalu
// menahan posisi sampai recovery-nya kehabisan tenaga (RSI overbought).
// Targetnya 1-4 trade dalam 24 jam, bukan scalping: sekali round trip
// makan ~26 bps (fee + slippage + impact), jadi tiap trade harus
// menangkap gerakan yang jauh lebih besar dari itu.
//
// Aturan masuk (semuanya harus benar di close bar yang sama):
//   - RSI(14) Wilder di bawah 30 DAN close di bawah lower Bollinger band
//     (20 close, 2 sigma), ATAU RSI di bawah 25 DAN close masih di
//     seperlima bawah band (%b < 20) -- oversold yang lebih dalam
//     mengkompensasi harga yang belum sempat menembus band bawah karena
//     band-nya melebar saat jatuh cepat.
//   - Washout: close minimal 1% di bawah harga tertinggi 60 bar terakhir.
//     Ini yang membedakan "jatuh beneran" dari goyangan 1-menit biasa.
//   - Jeda 30 bar sejak exit terakhir, supaya tidak langsung masuk lagi
//     ke sinyal yang sama (whipsaw).
//
// Aturan keluar (salah satu cukup):
//   - RSI(14) di atas 75 -- recovery sudah overbought, ambil untung.
//   - Trailing stop: close turun 2% dari close tertinggi sejak entry.
//   - Hard stop: nilai posisi di bawah 98% dari modal masuknya.
//
// Posisi: seluruh cash (all-in), satu posisi saja. Tidak ada short,
// tidak ada leverage, tidak ada acak-acakan: semua keputusan murni
// fungsi dari bar yang sudah diterima (deterministik).
//
// Backtest lokal di dev window (1.440 bar, model fill harness yang sama):
// net PnL +12,82 USDC, 3 round trip, max drawdown -1,00% -- lolos dev
// gate (PnL > 0). Parameter dipilih dari plateau, bukan dari puncak
// tunggal: semua variasi washout 0,8-1,5% dan RSI exit 75-80 positif.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 100;

const RSI_BARS = 14;
const RSI_MASUK = 30;
const RSI_MASUK_DALAM = 25;
const RSI_KELUAR = 75;
const BAND_BARS = 20;
const BAND_SIGMA = 2;
const BAND_BAWAH_PERSEN = 20; // %b di bawah ini = masih di seperlima bawah band
const WASHOUT_BARS = 60;
const WASHOUT_PERSEN = 1; // close minimal 1% di bawah puncak 60 bar
const JEDA_BAR = 30;
const TRAILING_PERSEN = 2; // close turun 2% dari puncak sejak entry
const HARD_STOP_PERSEN = 2; // nilai posisi di bawah 98% dari cost

// ---------------------------------------------------------------- indikator

const closes: number[] = [];
let closeTerakhir: number | null = null;
const perubahanAwal: number[] = [];
let rataGain: number | null = null;
let rataLoss: number | null = null;

/** Catat satu close baru, perbarui RSI Wilder dan deret close. */
function catatClose(close: number): void {
  closes.push(close);
  if (closeTerakhir !== null) {
    const berubah = close - closeTerakhir;
    if (rataGain === null || rataLoss === null) {
      perubahanAwal.push(berubah);
      if (perubahanAwal.length === RSI_BARS) {
        let g = 0;
        let l = 0;
        for (const x of perubahanAwal) {
          if (x > 0) g += x;
          else l -= x;
        }
        rataGain = g / RSI_BARS;
        rataLoss = l / RSI_BARS;
      }
    } else {
      const naik = berubah > 0 ? berubah : 0;
      const turun = berubah < 0 ? -berubah : 0;
      rataGain = (rataGain * (RSI_BARS - 1) + naik) / RSI_BARS;
      rataLoss = (rataLoss * (RSI_BARS - 1) + turun) / RSI_BARS;
    }
  }
  closeTerakhir = close;
}

/** RSI(14) Wilder, atau null sebelum 14 perubahan pertama terkumpul. */
function rsi(): number | null {
  if (rataGain === null || rataLoss === null) return null;
  const gerak = rataGain + rataLoss;
  return gerak === 0 ? 50 : (100 * rataGain) / gerak;
}

/** Bollinger (mean, lower, upper) dari 20 close terakhir, atau null. */
function bollinger(): { mean: number; lower: number; upper: number } | null {
  if (closes.length < BAND_BARS) return null;
  const jendela = closes.slice(-BAND_BARS);
  let jumlah = 0;
  for (const x of jendela) jumlah += x;
  const mean = jumlah / BAND_BARS;
  let varians = 0;
  for (const x of jendela) varians += (x - mean) * (x - mean);
  const sd = Math.sqrt(varians / BAND_BARS);
  return { mean, lower: mean - BAND_SIGMA * sd, upper: mean + BAND_SIGMA * sd };
}

/** Posisi close di dalam band, 0 = lower band, 100 = upper band. */
function persenBand(close: number, lower: number, upper: number): number {
  if (upper === lower) return 50;
  return ((close - lower) / (upper - lower)) * 100;
}

/** Benar kalau close jatuh minimal WASHOUT_PERSEN dari puncak 60 bar. */
function washout(close: number): boolean {
  const jendela = closes.slice(-WASHOUT_BARS);
  let puncak = -Infinity;
  for (const x of jendela) if (x > puncak) puncak = x;
  return close < puncak * (1 - WASHOUT_PERSEN / 100);
}

// ---------------------------------------------------------------- state posisi

let puncakSejakMasuk: number | null = null;
let barSejakKeluar = 1e9;

await runBars({
  onBatch(state: BarsState, batch: { bars: Bar[] }) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    catatClose(close);
    barSejakKeluar += 1;
    if (state.warmingUp) return [];

    const r = rsi();
    const band = bollinger();
    const pegang = state.positions.get(SYMBOL);

    if (pegang !== undefined) {
      if (puncakSejakMasuk === null || close > puncakSejakMasuk) puncakSejakMasuk = close;
      let keluar = false;
      if (r !== null && r > RSI_KELUAR) keluar = true;
      if (
        puncakSejakMasuk !== null &&
        close < puncakSejakMasuk * (1 - TRAILING_PERSEN / 100)
      ) {
        keluar = true;
      }
      const nilai = state.value(SYMBOL, pegang.qty);
      if (nilai * 100n < pegang.cost * BigInt(100 - HARD_STOP_PERSEN)) keluar = true;
      if (!keluar) return [];
      puncakSejakMasuk = null;
      barSejakKeluar = 0;
      const jual: SellInput = { side: 'sell', symbol: SYMBOL, qty: pegang.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [jual];
    }

    if (r === null || band === null) return [];
    if (barSejakKeluar < JEDA_BAR) return [];
    const diBawahBand = close < band.lower;
    const oversoldDalam =
      r < RSI_MASUK_DALAM && persenBand(close, band.lower, band.upper) < BAND_BAWAH_PERSEN;
    if (r >= RSI_MASUK || (!diBawahBand && !oversoldDalam)) return [];
    if (!washout(close)) return [];
    if (state.cash <= 0n) return [];

    puncakSejakMasuk = close;
    const beli: BuyInput = {
      side: 'buy',
      symbol: SYMBOL,
      notional_quote_units: state.cash,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    };
    return [beli];
  },
});
