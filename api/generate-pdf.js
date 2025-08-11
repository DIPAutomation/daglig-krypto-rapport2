import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

function formatPercentChange(newVal, oldVal) {
  if (oldVal == null || newVal == null) return 'N/A';
  const change = ((newVal - oldVal) / oldVal) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

export default async function handler(req, res) {
  try {
    const errors = [];

    // Cryptovaluta
    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];

    // Dummy analyst table
    const analystTable = {
      BTC: { Buy: 3, Hold: 3, Sell: 1 },
      ETH: { Buy: 4, Hold: 2, Sell: 1 },
      INJ: { Buy: 5, Hold: 1, Sell: 1 },
      FET: { Buy: 2, Hold: 4, Sell: 1 },
      DOGE: { Buy: 1, Hold: 3, Sell: 3 },
      XRP: { Buy: 2, Hold: 4, Sell: 1 },
      SOL: { Buy: 4, Hold: 2, Sell: 1 }
    };

    // Data-objekter
    let cryptoPrices = {};
    let fearGreedIndex = { current: null, history: [] };
    let btcDominance = { current: null, history: [] };
    let vixValue = { current: null, history: [] };

    // Hent dagens data parallelt
    await Promise.allSettled([
      // CoinGecko prisdata
      (async () => {
        try {
          const r = await fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`);
          cryptoPrices = await r.json();
        } catch (err) {
          errors.push(`CoinGecko-feil: ${err.message}`);
        }
      })(),
      // Fear & Greed index nå
      (async () => {
        try {
          const r = await fetchWithTimeout('https://api.alternative.me/fng/');
          const d = await r.json();
          if (d?.data?.[0]) {
            fearGreedIndex.current = {
              value: Number(d.data[0].value),
              classification: d.data[0].value_classification
            };
          }
          // *** Historikk: alternativt kall til fng/api/v1/fear-and-greed-index/history/ eller cache ***
          // For demo: dummy uke/mnd historikk:
          fearGreedIndex.history = [
            { period: '1 Day Ago', value: 45 },
            { period: '7 Days Ago', value: 38 },
            { period: '30 Days Ago', value: 50 },
          ];
        } catch (err) {
          errors.push(`Fear & Greed-feil: ${err.message}`);
        }
      })(),
      // BTC Dominance nå og dummy historie
      (async () => {
        try {
          const r = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
          const d = await r.json();
          if (d?.data?.market_cap_percentage?.btc != null) {
            btcDominance.current = d.data.market_cap_percentage.btc;
          }
          // Dummy historie:
          btcDominance.history = [
            { period: '1 Day Ago', value: btcDominance.current ? btcDominance.current - 0.5 : null },
            { period: '7 Days Ago', value: btcDominance.current ? btcDominance.current - 1.2 : null },
            { period: '30 Days Ago', value: btcDominance.current ? btcDominance.current - 3.4 : null },
          ];
        } catch (err) {
          errors.push(`BTC Dominance-feil: ${err.message}`);
        }
      })(),
      // VIX nå og dummy historie (ekte historie krever tidsserie-API)
      (async () => {
        try {
          const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX');
          const d = await r.json();
          const val = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (val != null) vixValue.current = val;
          // Dummy historie:
          vixValue.history = [
            { period: '1 Day Ago', value: val ? val * 0.95 : null },
            { period: '7 Days Ago', value: val ? val * 1.05 : null },
            { period: '30 Days Ago', value: val ? val * 0.9 : null },
          ];
        } catch (err) {
          errors.push(`VIX-feil: ${err.message}`);
        }
      })(),
    ]);

    // Lag PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let y = 800;

    const lineHeight = 18;
    const marginLeft = 50;
    const marginRight = 545;

    // Tekst med wrapping innenfor marg
    function drawText(text, options = {}) {
      const {
        x = marginLeft,
        y: startY = y,
        size = 12,
        color = rgb(0, 0, 0),
        bold = false,
      } = options;

      const fontToUse = bold ? pdfDoc.embedFont(StandardFonts.HelveticaBold) : font;

      // pdf-lib async, så vi cacher font uten await
      const drawPageText = (textToDraw, posX, posY, fontObj) => {
        page.drawText(textToDraw, { x: posX, y: posY, size, font: fontObj, color });
      };

      // Wrap tekst manuelt (ca 75 tegn per linje ved size 12 og margin 495px)
      const maxWidth = marginRight - x;
      const approxCharPerLine = Math.floor(maxWidth / (size * 0.6));
      const words = text.split(' ');
      let line = '';
      let currentY = startY;

      (async () => {
        const embeddedBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const embeddedReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (const word of words) {
          const testLine = line + word + ' ';
          // Mål bredde:
          // pdf-lib har font.widthOfTextAtSize(font, text, size), men ikke font yet
          // Vi estimerer:
          if (testLine.length > approxCharPerLine) {
            drawPageText(line.trim(), x, currentY, bold ? embeddedBold : embeddedReg);
            line = word + ' ';
            currentY -= lineHeight;
          } else {
            line = testLine;
          }
        }
        if (line) {
          drawPageText(line.trim(), x, currentY, bold ? embeddedBold : embeddedReg);
          currentY -= lineHeight;
        }
      })();

      y = currentY;
    }

    // For enklere synkron tekst tegning - enklere for nå:
    function drawTextSync(text, options = {}) {
      const {
        x = marginLeft,
        size = 12,
        color = rgb(0, 0, 0),
        bold = false,
      } = options;

      const fontToUse = bold ? pdfDoc.embedFont(StandardFonts.HelveticaBold) : font;

      // Wrap tekst manuelt (ca 75 tegn per linje ved size 12 og margin 495px)
      const maxWidth = marginRight - x;
      const approxCharPerLine = Math.floor(maxWidth / (size * 0.6));
      const words = text.split(' ');
      let line = '';
      for (const word of words) {
        const testLine = line + word + ' ';
        if (testLine.length > approxCharPerLine) {
          page.drawText(line.trim(), { x, y, size, font: fontToUse, color });
          y -= lineHeight;
          line = word + ' ';
        } else {
          line = testLine;
        }
      }
      if (line) {
        page.drawText(line.trim(), { x, y, size, font: fontToUse, color });
        y -= lineHeight;
      }
    }

    // Tegn overskrift
    page.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, { x: marginLeft, y, size: 16, font, color: rgb(0, 0, 0) });
    y -= lineHeight * 2;

    // Kryptopriser tabell header
    drawTextSync('Kryptopriser og 24t endring:', { size: 14, bold: true });
    y -= 4;

    function drawTableRow(cols, widths, opts = {}) {
      let x = marginLeft;
      for (let i = 0; i < cols.length; i++) {
        page.drawText(cols[i], { x, y, size: opts.size || 12, font: opts.bold ? pdfDoc.embedFont(StandardFonts.HelveticaBold) : font, color: opts.color || rgb(0,0,0) });
        x += widths[i];
      }
      y -= lineHeight;
    }

    drawTableRow(['Valuta', 'Pris USD', '24t Endring'], [80, 120, 120], { bold: true });

    coins.forEach(id => {
      const symbol = id === 'bitcoin' ? 'BTC' :
                     id === 'ethereum' ? 'ETH' :
                     id === 'injective-protocol' ? 'INJ' :
                     id === 'fetch-ai' ? 'FET' :
                     id === 'dogecoin' ? 'DOGE' :
                     id === 'ripple' ? 'XRP' :
                     id === 'solana' ? 'SOL' : id.toUpperCase();
      const price = cryptoPrices[id]?.usd != null
        ? `$${cryptoPrices[id].usd.toLocaleString()}`
        : "N/A";
      const change = cryptoPrices[id]?.usd_24h_change != null
        ? `${cryptoPrices[id].usd_24h_change.toFixed(2)}%`
        : "N/A";
      drawTableRow([symbol, price, change], [80, 120, 120]);
    });

    y -= lineHeight;

    // Markedsindikatorer - nåværende verdier
    drawTextSync('Markedsindikatorer (nåværende verdier):', { size: 14, bold: true });
    y -= 4;

    drawTableRow(['Indikator', 'Verdi'], [200, 100], { bold: true });
    drawTableRow(['Fear & Greed Index', fearGreedIndex.current ? `${fearGreedIndex.current.value} (${fearGreedIndex.current.classification})` : 'N/A'], [200, 100]);
    drawTableRow(['VIX Index', vixValue.current != null ? vixValue.current.toFixed(2) : 'N/A'], [200, 100]);
    drawTableRow(['BTC Dominance', btcDominance.current != null ? `${btcDominance.current.toFixed(2)}%` : 'N/A'], [200, 100]);

    y -= lineHeight;

    // Markedsindikatorer - utviklingstabell
    drawTextSync('Utvikling i Markedsindikatorer:', { size: 14, bold: true });
    y -= 4;

    drawTableRow(['Indikator', '1 Dag', '7 Dager', '30 Dager'], [150, 100, 100, 100], { bold: true });

    // Fear & Greed change %
    const fngChanges = fearGreedIndex.history.map(h => h.value);
    const fngCurrent = fearGreedIndex.current ? fearGreedIndex.current.value : null;
    const fngDayChange = formatPercentChange(fngCurrent, fngChanges[0]);
    const fngWeekChange = formatPercentChange(fngCurrent, fngChanges[1]);
    const fngMonthChange = formatPercentChange(fngCurrent, fngChanges[2]);
    drawTableRow(['Fear & Greed Index', fngDayChange, fngWeekChange, fngMonthChange], [150, 100, 100, 100]);

    // VIX changes
    const vixChanges = vixValue.history.map(h => h.value);
    const vixCurrent = vixValue.current;
    const vixDayChange = formatPercentChange(vixCurrent, vixChanges[0]);
    const vixWeekChange = formatPercentChange(vixCurrent, vixChanges[1]);
    const vixMonthChange = formatPercentChange(vixCurrent, vixChanges[2]);
    drawTableRow(['VIX Index', vixDayChange, vixWeekChange, vixMonthChange], [150, 100, 100, 100]);

    // BTC Dominance changes
    const btcDomChanges = btcDominance.history.map(h => h.value);
    const btcDomCurrent = btcDominance.current;
    const btcDomDayChange = formatPercentChange(btcDomCurrent, btcDomChanges[0]);
    const btcDomWeekChange = formatPercentChange(btcDomCurrent, btcDomChanges[1]);
    const btcDomMonthChange = formatPercentChange(btcDomCurrent, btcDomChanges[2]);
    drawTableRow(['BTC Dominance', btcDomDayChange, btcDomWeekChange, btcDomMonthChange], [150, 100, 100, 100]);

    y -= lineHeight;

    // Analytikeranbefalinger
    drawTextSync('Analytikeranbefalinger:', { size: 14, bold: true });
    y -= 4;

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
    drawTextSync('Makroøkonomi og Kryptomarkedet:', { size: 14, bold: true });
    y -= 4;
    drawTextSync('Globale renteendringer, inflasjon og regulatoriske nyheter påvirker kryptomarkedet sterkt.');
    drawTextSync('Stigende renter øker alternativkostnaden ved å holde krypto, og kan føre til kapitalflukt til sikrere aktiva.');
    drawTextSync('Regulatorisk usikkerhet og lovendringer kan skape volatilitet og raske markedsreaksjoner.');
    drawTextSync('Institusjonell interesse, som ETF-godkjenninger, støtter langsiktig vekst i kryptoindustrien.');
    drawTextSync('Investorer bør følge med på makrotrender for å justere risikoprofilen i porteføljen.');

    y -= lineHeight;

    drawTextSync('Generell Fremtidsanalyse:', { size: 14, bold: true });
    drawTextSync('ETF-godkjenninger gir økt institusjonell interesse.');
    drawTextSync('Lovforslag om kryptoregulering kan gi store markedsbevegelser.');
    drawTextSync('Altcoins viser styrke, men avhenger av makroøkonomi og likviditet.');
    drawTextSync('Vær obs på volatilitet rundt store hendelser og nyhetsutslipp.');

    y -= lineHeight;

    // Feilmeldinger
    if (errors.length) {
      drawTextSync('Advarsler / Feilmeldinger:', { size: 12, bold: true, color: rgb(1, 0, 0) });
      errors.forEach(errMsg => {
        drawTextSync(errMsg, { size: 10, color: rgb(1, 0, 0) });
      });
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=crypto_report.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Ukjent feil' });
  }
}
