const axios = require('axios');
const ti = require('technicalindicators');
const Table = require('cli-table3');
const colors = require('colors');

require('dotenv').config();
const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'];
const REFRESH_INTERVAL = 15; // minutes

async function fetchForexData(fromCurrency, toCurrency) {
  const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromCurrency}&to_symbol=${toCurrency}&apikey=${API_KEY}&outputsize=compact`;
  const response = await axios.get(url);
  const timeSeries = response.data['Time Series FX (Daily)'];
  if (!timeSeries) throw new Error(`No data for ${fromCurrency}/${toCurrency}`);
  const candles = Object.entries(timeSeries).map(([date, d]) => ({
    date,
    open: parseFloat(d['1. open']),
    high: parseFloat(d['2. high']),
    low: parseFloat(d['3. low']),
    close: parseFloat(d['4. close'])
  })).reverse();
  return candles;
}

function detectCandlePatterns(candles) {
  const patterns = [];
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  // Doji
  const dojiValues = ti.doji({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (dojiValues[dojiValues.length - 1]) patterns.push('Doji ⚠️');

  // Hammer
  const hammerValues = ti.hammerpattern({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (hammerValues[hammerValues.length - 1]) patterns.push('Hammer 🔨');

  // Bullish Engulfing
  const bullEngulf = ti.bullishengulfingpattern({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (bullEngulf[bullEngulf.length - 1]) patterns.push('Bull Engulf 📈');

  // Bearish Engulfing
  const bearEngulf = ti.bearishengulfingpattern({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (bearEngulf[bearEngulf.length - 1]) patterns.push('Bear Engulf 📉');

  // Morning Star
  const morningStar = ti.morningstar({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (morningStar[morningStar.length - 1]) patterns.push('Morning Star 🌅');

  // Evening Star
  const eveningStar = ti.eveningstar({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (eveningStar[eveningStar.length - 1]) patterns.push('Evening Star 🌇');

  // Manual Shooting Star
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  if (upperWick > 2 * body && lowerWick < body) patterns.push('Shooting Star 🌠');

  return patterns.length > 0 ? patterns.join(', ') : 'None';
}

function analyzeSignal(candles) {
  const closes = candles.map(c => c.close);

  const rsiValues = ti.RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiValues[rsiValues.length - 1];

  const macdValues = ti.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const macd = macdValues[macdValues.length - 1];

  const sma20 = ti.SMA.calculate({ values: closes, period: 20 });
  const sma50 = ti.SMA.calculate({ values: closes, period: 50 });
  const currentPrice = closes[closes.length - 1];

  const candlePatterns = detectCandlePatterns(candles);

  let signal = 'NEUTRAL';
  let reason = '';

  if (rsi < 30 && macd.MACD > macd.signal && sma20[sma20.length - 1] > sma50[sma50.length - 1]) {
    signal = 'BUY';
    reason = 'RSI oversold + MACD bullish + SMA20 > SMA50';
  } else if (rsi > 70 && macd.MACD < macd.signal && sma20[sma20.length - 1] < sma50[sma50.length - 1]) {
    signal = 'SELL';
    reason = 'RSI overbought + MACD bearish + SMA20 < SMA50';
  } else if (rsi < 40 && macd.MACD > macd.signal) {
    signal = 'WEAK BUY';
    reason = 'RSI low + MACD bullish crossover';
  } else if (rsi > 60 && macd.MACD < macd.signal) {
    signal = 'WEAK SELL';
    reason = 'RSI high + MACD bearish crossover';
  } else {
    reason = 'No strong signal detected';
  }

  // Boost signal confidence with candle patterns
  if (candlePatterns.includes('Hammer') || candlePatterns.includes('Morning Star') || candlePatterns.includes('Bull Engulf')) {
    if (signal === 'NEUTRAL') { signal = 'WEAK BUY'; reason = 'Bullish candle pattern detected'; }
    if (signal === 'WEAK BUY') { signal = 'BUY'; reason += ' + Bullish pattern confirmed'; }
  }
  if (candlePatterns.includes('Evening Star') || candlePatterns.includes('Bear Engulf') || candlePatterns.includes('Shooting Star')) {
    if (signal === 'NEUTRAL') { signal = 'WEAK SELL'; reason = 'Bearish candle pattern detected'; }
    if (signal === 'WEAK SELL') { signal = 'SELL'; reason += ' + Bearish pattern confirmed'; }
  }

  return {
    price: currentPrice.toFixed(5),
    rsi: rsi.toFixed(2),
    macd: macd.MACD.toFixed(5),
    signal,
    reason,
    candlePatterns
  };
}

function colorSignal(signal) {
  if (signal === 'BUY') return colors.green.bold(signal);
  if (signal === 'SELL') return colors.red.bold(signal);
  if (signal === 'WEAK BUY') return colors.cyan(signal);
  if (signal === 'WEAK SELL') return colors.yellow(signal);
  return colors.grey(signal);
}

async function runAnalyzer() {
  console.clear();
  const now = new Date().toLocaleTimeString();
  console.log(colors.bold.white(`\n====== FOREX SIGNAL ANALYZER ====== [${now}]`));
  console.log(colors.grey(`Next refresh in ${REFRESH_INTERVAL} minutes...\n`));

  const table = new Table({
    head: ['Pair', 'Price', 'RSI', 'MACD', 'Signal', 'Candle Patterns', 'Reason'].map(h => colors.bold.white(h)),
    colWidths: [12, 12, 10, 12, 12, 30, 40]
  });

  for (const pair of PAIRS) {
    const [from, to] = pair.split('/');
    try {
      console.log(`Fetching data for ${pair}...`);
      const candles = await fetchForexData(from, to);
      const result = analyzeSignal(candles);
      table.push([
        colors.bold.yellow(pair),
        result.price,
        result.rsi,
        result.macd,
        colorSignal(result.signal),
        result.candlePatterns,
        result.reason
      ]);
      await new Promise(r => setTimeout(r, 15000));
    } catch (err) {
      table.push([pair, 'ERROR', '-', '-', '-', '-', err.message]);
    }
  }

  console.log(table.toString());
  console.log(colors.grey('\n⚠️  For educational purposes only. Not financial advice.\n'));
}

// Auto-refresh loop
async function startAutoRefresh() {
  await runAnalyzer();
  setInterval(async () => {
    await runAnalyzer();
  }, REFRESH_INTERVAL * 60 * 1000);
}

startAutoRefresh();