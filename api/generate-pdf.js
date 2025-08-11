import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export default async function handler(req, res) {
  let cryptoPrices = {};
  let fearGreedIndex = "N/A";
  let btcDominance = "N/A";
  let vixValue = "N/A";

  // Hjelpefunksjon for trygg formatering
  const safeFormat = (val, opts = {}) => {
    if (val == null || isNaN(val)) return "N/A";
    try {
      return opts.percent
        ? `${Number(val).toFixed(opts.decimals ?? 1)}%`
        : `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: opts.decimals ?? 2, maximumFractionDigits: opts.decimals ?? 2 })}`;
    } catch {
      return "N/A";
    }
  };

  try {
    // Hent data fra CoinGecko
    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];
    try {
      const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`);
      if (cgRes.ok) cryptoPrices = await cgRes.json();
    } catch {}

    // Fear & Greed Index
    try {
      const fgRes = await fetch('https://api.alternative.me/fng/');
      if (fgRes.ok) {
        const fgData = await fgRes.json();
        if (fgData?.data?.[0]?.value && fgData?.data?.[0]?.value_classification) {
          fearGreedIndex = `${fgData.data[0].value} (${fgData.data[0].value_classification})`;
        }
      }
    } catch {}

    // BTC-dominans
    try {
      const domRes = await fetch(`https://api.coingecko.com/api/v3/global`);
      if (domRes.ok) {
        const domData = await domRes.json();
        const domValue = domData?.data?.market_cap_percentage?.btc;
        btcDominance = domValue != null && !isNaN(domValue) ? `${Number(domValue).toFixed(2)}%` : "N/A";
      }
    } catch {}

    // VIX Index
    try {
      const vixRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/^VIX`);
      if (vixRes.ok) {
        const vixJson = await vixRes.json();
        const priceVal = vixJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
        vixValue = priceVal != null && !isNaN(priceVal) ? Number(priceVal).toFixed(2) : "N/A";
      }
    } catch {}
  } catch (err) {
    console.error("Generell feil under datainnhenting:", err);
  }

  // Dummy analytikertall
