import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export default async function handler(req, res) {
  let cryptoPrices = {};
  let fearGreedIndex = "N/A";
  let btcDominance = "N/A";
  let vixValue = "N/A";

  try {
    // CoinGecko priser
    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];
    const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`);
    if (cgRes.ok) cryptoPrices = await cgRes.json();

    // Fear & Greed
    const fgRes = await fetch('https://api.alternative.me/fng/');
    if (fgRes.ok) {
      const fgData = await fgRes.json();
      if (fgData?.data?.[0]?.value && fgData?.data?.[0]?.value_classification) {
        fearGreedIndex = `${fgData.data[0].value} (${fgData.data[0].value_classification})`;
      }
    }

    // BTC-dominans
    const domRes = await fetch(`https://api.coingecko.com/api/v3/global`);
    if (domRes.ok) {
      const domData = await domRes.json();
      const domValue = domData?.data?.market_cap_percentage?.btc;
      btcDominance = domValue != null ? `${Number(domValue).toFixed(2)}%` : "N/A";
    }

    // VIX
    try {
      const vixRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/^VIX`);
      if (vixRes.ok) {
        const vixJson = await vixRes.json();
        const priceVal = vixJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
        vixValue = priceVal != null ? Number(priceVal).toFixed(2) : "N/A";
      }
    } catch {}
  } catch (err) {
    console.error("Feil under datainnhenting:", err);
  }

  // Dummy analytikertall per coin
  const analystStats = {
    BTC: { total: 7, buy: 3, hold: 3, sell: 1 },
    ETH: { total: 6, buy: 4, hold: 1, sell: 1 },
    INJ: { total: 5, buy: 3, hold: 2, sell: 0 },
    FET: { total: 4, buy: 1, hold: 3, sell: 0 },
    DOGE: { total: 6, buy: 1, hold: 2, sell: 3 },
    XRP: { total: 5, buy: 2, hold: 3, sell: 0 },
    SOL: { total: 6, buy: 4, hold: 1, sell: 1 }
  };

  const findMajority = (stats) => {
    const entries = [
      { type: "BUY", value: stats.buy },
      { type: "HOLD", value: stats.hold },
      { type: "SELL", value: stats.sell }
    ];
