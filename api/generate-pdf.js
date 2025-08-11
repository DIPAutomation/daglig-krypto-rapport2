import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function fetchWithTimeout(url, options = {}, timeout = 3000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
  ]);
}

export default async function handler(req, res) {
  // Fallback-data
  let cryptoPrices = {
    bitcoin: { usd: 0, usd_24h_change: 0 },
    ethereum: { usd: 0, usd_24h_change: 0 },
    'injective-protocol': { usd: 0, usd_24h_change: 0 },
    'fetch-ai': { usd: 0, usd_24h_change: 0 },
    dogecoin: { usd: 0, usd_24h_change: 0 },
    ripple: { usd: 0, usd_24h_change: 0 },
    solana: { usd: 0, usd_24h_change: 0 }
  };
  let fearGreedIndex = "N/A";
  let btcDominance = "N/A";
  let vixValue = "N/A";
  let errors = [];

  const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];

  // Alle API-kall i parallell
  const [cgRes, fgRes, domRes, vixRes] = await Promise.allSettled([
    fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true`),
    fetchWithTimeout('https://api.alternative.me/fng/'),
    fetchWithTimeout(`https://api.coingecko.com/api/v3/global`),
    fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/^VIX`)
  ]);

  // CoinGecko priser
  if (cgRes.status === 'fulfilled' && cgRes.value.ok) {
    try {
      cryptoPrices = await cgRes.value.json();
    } catch {
      errors.push('CoinGecko (prisdata) - JSON parse-feil');
    }
  } else {
    errors.push('CoinGecko (prisdata)');
  }

  // Fear & Greed
  if (fgRes.status === 'fulfilled' && fgRes.value.ok) {
    try {
      const fgData = await fgRes.value.json();
      if (fgData?.data?.[0]) {
        fearGreedIndex = `${fgData.data[0].value} (${fgData.data[0].value_classification})`;
      }
    } catch {
      errors.push('Alternative.me (Fear & Greed) - JSON parse-feil');
    }
  } else {
    errors.push('Alternative.me (Fear & Greed)');
  }

  // BTC Dominance
  if (domRes.status === 'fulfilled' && domRes.value.ok) {
    try {
      const domData = await domRes.value.json();
      const domValue = domData?.data?.market_cap_percentage?.btc;
      btcDominance = domValue != null ? `${Number(domValue).toFixed(2)}%` : "N/A";
    } catch {
      errors.push('CoinGecko (global data) - JSON parse-feil');
    }
  } else {
    errors.push('CoinGecko (global data)');
  }

  // VIX
  if (vixRes.status === 'fulfilled' && vixRes.value.ok) {
    try {
      const vixJson = await vixRes.value.json();
      const priceVal = vixJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
      vixValue = priceVal != null ? Number(priceVal).toFixed(2) : "N/A";
    } catch {
      errors.push('Yahoo Finance (VIX) - JSON parse-feil');
    }
  } else {
    errors.push('Yahoo Finance (VIX)');
  }

  // Dummy analytikerdata
  const analystStats = {
    BTC: { total: 7, buy: 3, hold: 3, sell: 1 },
    ETH: { total: 6, buy: 4, hold: 1, sell: 1 },
    INJ: { total: 5, buy: 3, hold: 2, sell: 0 },
    FET: { total: 4, buy: 1, hold: 3, sell: 0 },
    DOGE: { total: 6, bu
