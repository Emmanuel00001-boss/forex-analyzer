require('dotenv').config();
const axios = require('axios');
const ti = require('technicalindicators');
const colors = require('colors');

const API_KEY = 'd3d77c3767e440ec96ce83df0e5adc39';
const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'];
const REFRESH_INTERVAL = 15; // minutes
const ACCOUNT_SIZE = 35; // USD
const RISK_PERCENT = 2; // 2% per trade
const RISK_AMOUNT = ACCOUNT_SIZE * (RISK_PERCENT / 100); // $0.70

async function fetchForexData(pair) {
  const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=1day&outputsize=100&apikey=${API_KEY}`;
  const response = await axios.get(url);
  if (response.data.status === 'error') throw new Error(response.data.message);
  const candles = response.data.values.map(d => ({
    date: d.datetime,
    open: parseFloat(d.open),
    high: parseFloat(d.high),
    low: parseFloat(d.low),
    close: parseFloat(d.close)
  })).reverse();
  return candles;
}

function detectCandlePatterns(candles) {
  const patterns = [];
  const last = candles[candles.length - 1];

  const dojiValues = ti.doji({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (dojiValues[dojiValues.length - 1]) patterns.push('Doji');

  const hammerValues = ti.hammerpattern({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (hammerValues[hammerValues.length - 1]) patterns.push('Hammer');

  const bullEngulf = ti.bullishengulfingpattern({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (bullEngulf[bullEngulf.length - 1]) patterns.push('Bull Engulf');

  const bearEngulf = ti.bearishengulfingpattern({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (bearEngulf[bearEngulf.length - 1]) patterns.push('Bear Engulf');

  const morningStar = ti.morningstar({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (morningStar[morningStar.length - 1]) patterns.push('Morning Star');

  const eveningStar = ti.eveningstar({ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close) });
  if (eveningStar[eveningStar.length - 1]) patterns.push('Evening Star');

  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  if (upperWick > 2 * body && lowerWick < body) patterns.push('Shooting Star');

  return patterns;
}

function detectTrend(closes) {
  const sma20 = ti.SMA.calculate({ values: closes, period: 20 });
  const sma50 = ti.SMA.calculate({ values: closes, period: 50 });
  const lastSma20 = sma20[sma20.length - 1];
  const lastSma50 = sma50[sma50.length - 1];
  const prevSma20 = sma20[sma20.length - 5];

  if (lastSma20 > lastSma50 && lastSma20 > prevSma20) return 'UPTREND';
  if (lastSma20 < lastSma50 && lastSma20 < prevSma20) return 'DOWNTREND';
  return 'SIDEWAYS';
}

function findSupportResistance(candles) {
  const recentHighs = candles.slice(-20).map(c => c.high);
  const recentLows = candles.slice(-20).map(c => c.low);
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);
  return { support, resistance };
}

function calculateSignalStrength(rsi, macd, trend, patterns, signal) {
  let score = 0;

  if (signal === 'BUY' || signal === 'WEAK BUY') {
    if (rsi < 30) score += 30;
    else if (rsi < 40) score += 15;
    if (macd.MACD > macd.signal) score += 25;
    if (trend === 'UPTREND') score += 20;
    if (patterns.includes('Hammer') || patterns.includes('Morning Star') || patterns.includes('Bull Engulf')) score += 25;
  } else if (signal === 'SELL' || signal === 'WEAK SELL') {
    if (rsi > 70) score += 30;
    else if (rsi > 60) score += 15;
    if (macd.MACD < macd.signal) score += 25;
    if (trend === 'DOWNTREND') score += 20;
    if (patterns.includes('Shooting Star') || patterns.includes('Evening Star') || patterns.includes('Bear Engulf')) score += 25;
  } else {
    score = 20;
  }

  return Math.min(score, 100);
}

function calculateRiskManagement(signal, currentPrice, support, resistance, pair) {
  const isJPY = pair.includes('JPY');
  const pipSize = isJPY ? 0.01 : 0.0001;
  const pipValue = isJPY ? 0.0007 : 0.07;

  let entry, stopLoss, takeProfit, stopPips, takePips, ratio, positionSize, recommendation;

  if (signal === 'BUY' || signal === 'WEAK BUY') {
    entry = currentPrice;
    stopLoss = parseFloat((support - pipSize * 5).toFixed(5));
    stopPips = Math.round((entry - stopLoss) / pipSize);
    takePips = stopPips * 2;
    takeProfit = parseFloat((entry + pipSize * takePips).toFixed(5));
    ratio = '1:2';
    positionSize = (RISK_AMOUNT / (stopPips * pipValue)).toFixed(2);
    recommendation = stopPips > 5 && stopPips < 100 ? '✅ TAKE TRADE' : '⚠️ SKIP - SL too wide';
  } else if (signal === 'SELL' || signal === 'WEAK SELL') {
    entry = currentPrice;
    stopLoss = parseFloat((resistance + pipSize * 5).toFixed(5));
    stopPips = Math.round((stopLoss - entry) / pipSize);
    takePips = stopPips * 2;
    takeProfit = parseFloat((entry - pipSize * takePips).toFixed(5));
    ratio = '1:2';
    positionSize = (RISK_AMOUNT / (stopPips * pipValue)).toFixed(2);
    recommendation = stopPips > 5 && stopPips < 100 ? '✅ TAKE TRADE' : '⚠️ SKIP - SL too wide';
  } else {
    return {
      entry: '-', stopLoss: '-', takeProfit: '-',
      stopPips: '-', takePips: '-', ratio: '-',
      positionSize: '-', recommendation: '⏳ WAIT'
    };
  }

  return { entry, stopLoss, takeProfit, stopPips, takePips, ratio, positionSize, recommendation };
}

function analyzeSignal(candles, pair) {
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
  const trend = detectTrend(closes);
  const { support, resistance } = findSupportResistance(candles);
  const patterns = detectCandlePatterns(candles);

  let signal = 'NEUTRAL';
  let reason = '';

  if (rsi < 30 && macd.MACD > macd.signal && sma20[sma20.length - 1] > sma50[sma50.length - 1]) {
    signal = 'BUY';
    reason = 'RSI oversold + MACD bullish + SMA crossover';
  } else if (rsi > 70 && macd.MACD < macd.signal && sma20[sma20.length - 1] < sma50[sma50.length - 1]) {
    signal = 'SELL';
    reason = 'RSI overbought + MACD bearish + SMA crossover';
  } else if (rsi < 40 && macd.MACD > macd.signal) {
    signal = 'WEAK BUY';
    reason = 'RSI low + MACD bullish crossover';
  } else if (rsi > 60 && macd.MACD < macd.signal) {
    signal = 'WEAK SELL';
    reason = 'RSI high + MACD bearish crossover';
  } else {
    reason = 'No strong signal detected';
  }

  if (patterns.includes('Hammer') || patterns.includes('Morning Star') || patterns.includes('Bull Engulf')) {
    if (signal === 'NEUTRAL') { signal = 'WEAK BUY'; reason = 'Bullish candle pattern detected'; }
    else if (signal === 'WEAK BUY') { signal = 'BUY'; reason += ' + Bullish pattern confirmed'; }
  }
  if (patterns.includes('Evening Star') || patterns.includes('Bear Engulf') || patterns.includes('Shooting Star')) {
    if (signal === 'NEUTRAL') { signal = 'WEAK SELL'; reason = 'Bearish candle pattern detected'; }
    else if (signal === 'WEAK SELL') { signal = 'SELL'; reason += ' + Bearish pattern confirmed'; }
  }

  const strength = calculateSignalStrength(rsi, macd, trend, patterns, signal);
  const risk = calculateRiskManagement(signal, currentPrice, support, resistance, pair);

  return {
    price: currentPrice.toFixed(5),
    rsi: rsi.toFixed(2),
    macd: macd.MACD.toFixed(5),
    signal,
    strength,
    trend,
    patterns: patterns.length > 0 ? patterns.join(', ') : 'None',
    reason,
    risk
  };
}

function colorSignal(signal) {
  if (signal === 'BUY') return colors.green.bold(signal);
  if (signal === 'SELL') return colors.red.bold(signal);
  if (signal === 'WEAK BUY') return colors.cyan(signal);
  if (signal === 'WEAK SELL') return colors.yellow(signal);
  return colors.grey(signal);
}

function colorStrength(strength) {
  if (strength >= 75) return colors.green.bold(`${strength}%`);
  if (strength >= 50) return colors.yellow(`${strength}%`);
  return colors.red(`${strength}%`);
}

function colorTrend(trend) {
  if (trend === 'UPTREND') return colors.green(trend);
  if (trend === 'DOWNTREND') return colors.red(trend);
  return colors.grey(trend);
}

async function runAnalyzer() {
  console.clear();
  const now = new Date().toLocaleTimeString();
  console.log(colors.bold.white(`\n====== FOREX SIGNAL ANALYZER + RISK MANAGER ====== [${now}]`));
  console.log(colors.grey(`Account: $${ACCOUNT_SIZE} | Risk per trade: ${RISK_PERCENT}% ($${RISK_AMOUNT.toFixed(2)}) | Next refresh: ${REFRESH_INTERVAL} mins\n`));

  for (const pair of PAIRS) {
    try {
      console.log(`Fetching data for ${pair}...`);
      const candles = await fetchForexData(pair);
      const result = analyzeSignal(candles, pair);

      console.log(colors.bold.yellow(`\n┌─── ${pair} ───────────────────────────────────────`));
      console.log(`│ Price:     ${result.price}    RSI: ${result.rsi}    MACD: ${result.macd}`);
      console.log(`│ Trend:     ${colorTrend(result.trend)}`);
      console.log(`│ Patterns:  ${result.patterns}`);
      console.log(`│ Signal:    ${colorSignal(result.signal)}  (${colorStrength(result.strength)} confidence)`);
      console.log(`│ Reason:    ${result.reason}`);
      console.log(colors.bold.white(`│ ── Risk Management ──────────────────────────────`));
      console.log(`│ Entry:        ${result.risk.entry}`);
      console.log(`│ Stop Loss:    ${result.risk.stopLoss}  (${result.risk.stopPips} pips)`);
      console.log(`│ Take Profit:  ${result.risk.takeProfit}  (${result.risk.takePips} pips)`);
      console.log(`│ R/R Ratio:    ${result.risk.ratio}`);
      console.log(`│ Position:     ${result.risk.positionSize} micro lots`);
      console.log(`│ Decision:     ${result.risk.recommendation}`);
      console.log(colors.bold.yellow(`└─────────────────────────────────────────────────\n`));

      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log(colors.red(`\n${pair} ERROR: ${err.message}\n`));
    }
  }

  console.log(colors.grey('⚠️  For educational purposes only. Not financial advice.\n'));
}

async function startAutoRefresh() {
  await runAnalyzer();
  setInterval(async () => {
    await runAnalyzer();
  }, REFRESH_INTERVAL * 60 * 1000);
}

startAutoRefresh();