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

// Bryter tekst i linjer basert på max bredde (px)
function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const testLineWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testLineWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
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

    // PDF setup
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const marginX = 50;
    const marginY = 50;
    const pageWidth = 595;
    const pageHeight = 842;
    const maxWidth = pageWidth - marginX * 2;
    let y = pageHeight - marginY;
    const lineHeight = 16;

    // Funksjon for sidebrytning
    function checkPageSpace(linesNeeded) {
      if (y - linesNeeded * lineHeight < marginY) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - marginY;
      }
    }

    // Tegn tekst med wrapping og fet som valg
    function drawText(text, options = {}) {
      const { size = 12, color = rgb(0,0,0), bold = false } = options;
      const usedFont = bold ? fontBold : font;
      const lines = wrapText(text, usedFont, size, maxWidth);
      checkPageSpace(lines.length);
      for (const line of lines) {
        page.drawText(line, { x: marginX, y, size, font: usedFont, color });
        y -= lineHeight;
      }
    }

    // Tegn en "tabellrad" med 3 kolonner, bredde etter gitt
    // colWidths er array med px bredder, texts er array med strings
    function drawTableRow(texts, colWidths, options = {}) {
      const { size = 12, color = rgb(0,0,0), bold = false } = options;
      const usedFont = bold ? fontBold : font;
      const maxHeightLines = texts.reduce((max, t, i) => {
        const lines = wrapText(t, usedFont, size, colWidths[i]);
        return Math.max(max, lines.length);
      }, 0);

      checkPageSpace(maxHeightLines);

      for (let lineIdx = 0; lineIdx < maxHeightLines; lineIdx++) {
        let x = marginX;
        for (let i = 0; i < texts.length; i++) {
          const lines = wrapText(texts[i], usedFont, size, colWidths[i]);
          const line = lines[lineIdx] || '';
          page.drawText(line, { x, y, size, font: usedFont, color });
          x += colWidths[i];
        }
        y -= lineHeight;
      }
    }

    // --- START RAPPORT ---

    // Overskrift
    drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, { size: 16, bold: true });
    y -= lineHeight;

    // Kryptopriser seksjon
    drawText('Kryptopriser og 24t endring:', { size: 14, bold: true });
    y -= 6;

    // Tegn tabell header
    drawTableRow(['Valuta', 'Pris (USD)', '24t Endring'], [150, 150, 150], { bold: true });
    // Tegn linje under header
    drawTableRow(['---------', '----------', '------------'], [150, 150, 150]);

    coins.forEach(id => {
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

      drawTableRow([symbol, price, change], [150, 150, 150]);
    });

    y -= lineHeight;

    // Markedsindikatorer seksjon
    drawText('Markedsindikatorer:', { size: 14, bold: true });
    y -= 6;

    drawTableRow(['Fear & Greed Index', fearGreedIndex], [200, maxWidth - 200]);
    drawTableRow(['VIX Index', vixValue], [200, maxWidth - 200]);
    drawTableRow(['BTC Dominance', btcDominance], [200, maxWidth - 200]);

    y -= lineHeight;

    // Forklaring av indikatorer
    drawText('Tolkning av Markedsindikatorer:', { size: 14, bold: true });
    y -= 4;
    drawText('• Fear & Greed Index reflekterer markedssentiment. Høye verdier (70+) tyder på grådighet og mulig topp før korreksjon.');
    drawText('• Lave verdier (30-) signaliserer frykt og mulige kjøpsmuligheter.');
    drawText('• VIX måler volatilitet i aksjemarkedet. Høy VIX kan gi økt usikkerhet og indirekte påvirke krypto.');
    drawText('• BTC Dominance viser hvor stor del av total kryptomarkedskapitalisering Bitcoin har.');
    drawText('  Økning i dominans kan indikere usikkerhet i altcoins, mens fall kan signalisere styrke i altcoins.');

    y -= lineHeight;

    // Analytikeranbefalinger
    drawText('Analytikeranbefalinger:', { size: 14, bold: true });
    y -= 6;

    drawTableRow(['Valuta', 'Kjøp', 'Hold', 'Selg', 'Flest anbefaler'], [80, 60, 60, 60, 140], { bold: true });
    drawTableRow(['------', '----', '----', '----', '--------------'], [80, 60, 60, 60, 140]);

    Object.entries(analystTable).forEach(([symbol, counts]) => {
      const total = counts.Buy + counts.Hold + counts.Sell;
      const maxType = Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a)[0];
      const maxPercent = ((counts[maxType] / total) * 100).toFixed(1);
      drawTableRow([
        symbol,
        counts.Buy.toString(),
        counts.Hold.toString(),
        counts.Sell.toString(),
        `${maxType.toUpperCase()} (${maxPercent}%)`
      ], [80, 60, 60, 60, 140]);
    });

    y -= lineHeight;

    // Makroøkonomi og fremtidsanalyse
    drawText('Makroøkonomi og Kryptomarkedet:', { size: 14, bold: true });
    y -= 4;
    drawText('Globale renteendringer, inflasjon og regulatoriske nyheter påvirker kryptomarkedet sterkt.');
    drawText('Stigende renter øker alternativkostnaden ved å holde krypto, og kan føre til kapitalflukt til sikrere aktiva.');
    drawText('Regulatorisk usikkerhet og lovendringer kan skape volatilitet og raske markedsreaksjoner.');
    drawText('Institusjonell interesse, som ETF-godkjenninger, støtter langsiktig vekst i kryptoindustrien.');
    drawText('Investorer bør følge med på makrotrender for å justere risikoprofilen i porteføljen.');

    y -= lineHeight;

    drawText('Generell Fremtidsanalyse:', { size: 14, bold: true });
    drawText('ETF-godkjenninger gir økt institusjonell interesse.');
    drawText('Lovforslag om kryptoregulering kan gi store markedsbevegelser.');
    drawText('Altcoins viser styrke, men avhenger av makroøkonomi og likviditet.');
    drawText('Vær obs på volatilitet rundt store hendelser og nyhetsutslipp.');

    y -= lineHeight;

    // Feilmeldinger
    if (errors.length > 0) {
      drawText('Feil ved datainnhenting:', { size: 12, color: rgb(1, 0, 0), bold: true });
      errors.forEach(err => drawText(`- ${err}`, { size: 10, color: rgb(1, 0, 0) }));
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
    res.status(500).send(Buffer.from(pdfBytes));
  }
}
