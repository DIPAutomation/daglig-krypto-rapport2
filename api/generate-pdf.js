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
    cryptoPrices = await cgRes.json();

    // Fear & Greed
    const fgRes = await fetch('https://api.alternative.me/fng/');
    const fgData = await fgRes.json();
    if (fgData?.data?.[0]) {
      fearGreedIndex = `${fgData.data[0].value} (${fgData.data[0].value_classification})`;
    }

    // BTC-dominans
    const domRes = await fetch(`https://api.coingecko.com/api/v3/global`);
    const domData = await domRes.json();
    if (domData?.data?.market_cap_percentage?.btc != null) {
      btcDominance = `${domData.data.market_cap_percentage.btc.toFixed(2)}%`;
    }

    // VIX
    try {
      const vixRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/^VIX`);
      const vixJson = await vixRes.json();
      if (vixJson?.chart?.result?.[0]?.meta?.regularMarketPrice) {
        vixValue = vixJson.chart.result[0].meta.regularMarketPrice.toFixed(2);
      }
    } catch {}
  } catch (err) {
    console.error("Feil under datainnhenting:", err);
  }

  // Analytikervurderinger
  const analystTable = {
    BTC: "Hold",
    ETH: "Buy",
    INJ: "Buy",
    FET: "Hold",
    DOGE: "Sell",
    XRP: "Hold",
    SOL: "Buy"
  };

  // Lag PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let y = 780;
  const drawLine = (text, size = 12) => {
    page.drawText(text, { x: 50, y, size, font, color: rgb(0, 0, 0) });
    y -= 18;
  };

  drawLine(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, 14);
  drawLine('');
  drawLine('Kryptopriser og Analyse:');

  Object.entries(analystTable).forEach(([symbol, recommendation]) => {
    const coinId = symbol.toLowerCase() === 'btc' ? 'bitcoin' :
                   symbol.toLowerCase() === 'eth' ? 'ethereum' :
                   symbol.toLowerCase() === 'inj' ? 'injective-protocol' :
                   symbol.toLowerCase() === 'fet' ? 'fetch-ai' :
                   symbol.toLowerCase() === 'doge' ? 'dogecoin' :
                   symbol.toLowerCase() === 'xrp' ? 'ripple' :
                   symbol.toLowerCase() === 'sol' ? 'solana' : '';
    const price = cryptoPrices[coinId]?.usd != null ? `$${cryptoPrices[coinId].usd.toLocaleString()}` : "N/A";
    const change = cryptoPrices[coinId]?.usd_24h_change != null ? `${cryptoPrices[coinId].usd_24h_change.toFixed(2)}%` : "N/A";
    drawLine(`${symbol}: Pris ${price} | 24t Endring: ${change} | Anbefaling: ${recommendation}`);
  });

  drawLine('');
  drawLine('Markedsindikatorer:');
  drawLine(`Fear & Greed Index: ${fearGreedIndex}`);
  drawLine(`VIX Index: ${vixValue}`);
  drawLine(`BTC Dominance: ${btcDominance}`);

  drawLine('');
  drawLine('Generell Fremtidsanalyse:');
  drawLine('Altcoins viser styrke, spesielt etter ETF-godkjenninger.');
  drawLine('Institusjonell interesse er stigende.');
  drawLine('Regulatoriske nyheter kan utløse volatilitet.');

  const pdfBytes = await pdfDoc.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.pdf');
  res.status(200).send(Buffer.from(pdfBytes));
}
