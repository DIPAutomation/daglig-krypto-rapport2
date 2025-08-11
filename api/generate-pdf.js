import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Hjelpefunksjon med timeout
async function fetchWithTimeout(url, options = {}, timeout = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export default async function handler(req, res) {
  try {
    const errors = [];

    // Dummydata
    let cryptoPrices = {};
    let fearGreedIndex = "N/A";
    let btcDominance = "N/A";
    let vixValue = "N/A";

    // Analytiker-tabell (dummy)
    const analystTable = {
      BTC: { Buy: 3, Hold: 3, Sell: 1 },
      ETH: { Buy: 4, Hold: 2, Sell: 1 },
      INJ: { Buy: 5, Hold: 1, Sell: 1 },
      FET: { Buy: 2, Hold: 4, Sell: 1 },
      DOGE: { Buy: 1, Hold: 3, Sell: 3 },
      XRP: { Buy: 2, Hold: 4, Sell: 1 },
      SOL: { Buy: 4, Hold: 2, Sell: 1 }
    };

    // API-kall parallelt med fallback
    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];

    await Promise.allSettled([
      (async () => {
        try {
          const r = await fetchWithTimeout(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`
          );
          cryptoPrices = await r.json();
        } catch (err) {
          errors.push(`CoinGecko-feil: ${err.message}`);
        }
      })(),
      (async () => {
        try {
          const r = await fetchWithTimeout('https://api.alternative.me/fng/');
          const d = await r.json();
          if (d?.data?.[0]) {
            fearGreedIndex = `${d.data[0].value} (${d.data[0].value_classification})`;
          }
        } catch (err) {
          errors.push(`Fear & Greed-feil: ${err.message}`);
        }
      })(),
      (async () => {
        try {
          const r = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
          const d = await r.json();
          if (d?.data?.market_cap_percentage?.btc != null) {
            btcDominance = `${d.data.market_cap_percentage.btc.toFixed(2)}%`;
          }
        } catch (err) {
          errors.push(`BTC Dominance-feil: ${err.message}`);
        }
      })(),
      (async () => {
        try {
          const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX');
          const d = await r.json();
          const val = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (val != null) vixValue = val.toFixed(2);
        } catch (err) {
          errors.push(`VIX-feil: ${err.message}`);
        }
      })()
    ]);

    // Bygg PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let y = 780;

    const drawLine = (text, size = 12, color = rgb(0, 0, 0)) => {
      page.drawText(text, { x: 50, y, size, font, color });
      y -= 18;
    };

    drawLine(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, 14);
    drawLine('');

    // Kryptopriser
    drawLine('Kryptopriser og Analyse:');
    coins.forEach((id) => {
      const symbol = id === 'bitcoin' ? 'BTC' :
                     id === 'ethereum' ? 'ETH' :
                     id === 'injective-protocol' ? 'INJ' :
                     id === 'fetch-ai' ? 'FET' :
                     id === 'dogecoin' ? 'DOGE' :
                     id === 'ripple' ? 'XRP' :
                     id === 'solana' ? 'SOL' : id;
      const price = cryptoPrices[id]?.usd != null
        ? `$${cryptoPrices[id].usd.toLocaleString()}`
        : "N/A";
      const change = cryptoPrices[id]?.usd_24h_change != null
        ? `${cryptoPrices[id].usd_24h_change.toFixed(2)}%`
        : "N/A";
      drawLine(`${symbol}: Pris ${price} | 24t Endring: ${change}`);
    });

    drawLine('');
    drawLine('Markedsindikatorer:');
    drawLine(`Fear & Greed Index: ${fearGreedIndex}`);
    drawLine(`VIX Index: ${vixValue}`);
    drawLine(`BTC Dominance: ${btcDominance}`);

    // Analytikertabell
    drawLine('');
    drawLine('Analytikeranbefalinger pr. valuta:');
    Object.entries(analystTable).forEach(([symbol, counts]) => {
      const total = counts.Buy + counts.Hold + counts.Sell;
      const maxType = Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a)[0];
      const maxPercent = ((counts[maxType] / total) * 100).toFixed(1);
      drawLine(`${symbol}: analyserte ${total}; Kjøp ${counts.Buy}; Hold ${counts.Hold}; Selg ${counts.Sell}; Flest anbefaler ${maxType.toUpperCase()} (${maxPercent}%)`);
    });

    // Fremtidsanalyse
    drawLine('');
    drawLine('Generell Fremtidsanalyse:');
    drawLine('ETF-godkjenninger gir økt institusjonell interesse.');
    drawLine('Lovforslag om kryptoregulering kan gi store markedsbevegelser.');
    drawLine('Altcoins viser styrke, men avhenger av makroøkonomi og likviditet.');
    drawLine('Vær obs på volatilitet rundt store hendelser og nyhetsutslipp.');

    // API-feil
    if (errors.length > 0) {
      drawLine('');
      drawLine('Feil ved datainnhenting:', 12, rgb(1, 0, 0));
      errors.forEach(err => drawLine(`- ${err}`, 10, rgb(1, 0, 0)));
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (err) {
    // Siste failsafe
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText(`Rapportgenerering feilet: ${err.message}`, { x: 50, y: 800, size: 12, font, color: rgb(1, 0, 0) });
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=Feilrapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));
  }
}
