import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // Hent kryptodata fra CoinGecko
  const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];
  const coingeckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true&include_last_updated_at=true`;
  const cryptoRes = await fetch(coingeckoUrl);
  const cryptoPrices = await cryptoRes.json();

  // Hent Fear & Greed Index fra alternative.me
  const fgRes = await fetch('https://api.alternative.me/fng/');
  const fgData = await fgRes.json();
  const fearGreedIndex = `${fgData.data[0].value} (${fgData.data[0].value_classification})`;

  // Hent BTC-dominans
  const dominanceUrl = `https://api.coingecko.com/api/v3/global`;
  const dominanceRes = await fetch(dominanceUrl);
  const dominanceData = await dominanceRes.json();
  const btcDominance = `${dominanceData.data.market_cap_percentage.btc.toFixed(2)}%`;

  // Hent VIX fra Yahoo Finance (proxy via rapidapi eller lignende)
  let vixValue = "N/A";
  try {
    const vixRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/^VIX`);
    const vixJson = await vixRes.json();
    vixValue = vixJson.chart.result[0].meta.regularMarketPrice.toFixed(2);
  } catch (err) {
    console.error("Kunne ikke hente VIX", err);
  }

  // Analytikervurderinger (kan utvides med dynamiske data fra API)
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
  const { width, height } = page.getSize();
  let y = height - 50;

  const drawLine = (text, size = 12) => {
    page.drawText(text, { x: 50, y, size, font, color: rgb(0, 0, 0) });
    y -= 18;
  };

  drawLine(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, 14);
  drawLine('');
  drawLine('Kryptopriser og Analyse:');

  coins.forEach((coinId) => {
    const coinSymbol = coinId.toUpperCase().replace(/-/g, ' ');
    const price = cryptoPrices[coinId]?.usd ? `$${cryptoPrices[coinId].usd.toLocaleString()}` : "N/A";
    const change = cryptoPrices[coinId]?.usd_24h_change ? `${cryptoPrices[coinId].usd_24h_change.toFixed(2)}%` : "N/A";
    const recommendation = analystTable[coinSymbol.split(' ')[0]] || "N/A";
    drawLine(`${coinSymbol}: Pris ${price} | 24t Endring: ${change} | Anbefaling: ${recommendation}`);
  });

  drawLine('');
  drawLine('Markedsindikatorer:');
  drawLine(`Fear & Greed Index: ${fearGreedIndex}`);
  drawLine(`VIX Index: ${vixValue}`);
  drawLine(`BTC Dominance: ${btcDominance}`);

  drawLine('');
  drawLine('Generell Fremtidsanalyse:');
  drawLine('Markedet viser tegn til positivt momentum i flere altcoins.');
  drawLine('Institusjonell interesse øker, spesielt etter ETF-godkjenninger.');
  drawLine('Regulatoriske nyheter kan skape volatilitet de neste ukene.');

  const pdfBytes = await pdfDoc.save();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.pdf');
  res.status(200).send(Buffer.from(pdfBytes));
}
