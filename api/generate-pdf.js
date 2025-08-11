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

// Hjelpefunksjon for tekst med wrapping innenfor maks bredde
function drawWrappedText(page, font, text, x, y, maxWidth, size, color = rgb(0, 0, 0), lineHeight = 14) {
  const words = text.split(' ');
  let line = '';
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const testWidth = font.widthOfTextAtSize(testLine, size);
    if (testWidth > maxWidth && n > 0) {
      page.drawText(line, { x, y, size, font, color });
      line = words[n] + ' ';
      y -= lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineHeight;
  }
  return y;
}

// Hjelpefunksjon for å tegne tabell
function drawTable(page, font, headers, rows, startX, startY, colWidths, rowHeight, fontSize) {
  let y = startY;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.8, 0.8, 0.8);

  // Tegn header
  let x = startX;
  headers.forEach((h, i) => {
    page.drawRectangle({ x, y: y - rowHeight, width: colWidths[i], height: rowHeight, color: gray });
    page.drawText(h, { x: x + 5, y: y - rowHeight + 5, size: fontSize, font, color: black });
    x += colWidths[i];
  });

  y -= rowHeight;

  // Tegn rader
  rows.forEach((row, idx) => {
    x = startX;
    row.forEach((cell, i) => {
      if (idx % 2 === 1) {
        page.drawRectangle({ x, y: y - rowHeight, width: colWidths[i], height: rowHeight, color: rgb(0.95, 0.95, 0.95) });
      }
      page.drawText(cell, { x: x + 5, y: y - rowHeight + 5, size: fontSize, font, color: black });
      x += colWidths[i];
    });
    y -= rowHeight;
  });

  return y;
}

export default async function handler(req, res) {
  try {
    const errors = [];

    // Dummydata initialiseres
    let cryptoPrices = {};
    let fearGreedIndex = { value: "N/A", classification: "N/A", change: { day: "N/A", week: "N/A", month: "N/A" } };
    let btcDominance = { current: "N/A", change: { day: "N/A", week: "N/A", month: "N/A" } };
    let vixValue = { current: "N/A", change: { day: "N/A", week: "N/A", month: "N/A" } };

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

    // Coins å hente info for
    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];

    // Funksjon for å hente historikk for endringer (1d, 7d, 30d)
    async function fetchHistoricalChange(id, days) {
      try {
        const res = await fetchWithTimeout(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
        const data = await res.json();
        if (data?.prices && data.prices.length > 1) {
          const startPrice = data.prices[0][1];
          const endPrice = data.prices[data.prices.length - 1][1];
          const change = ((endPrice - startPrice) / startPrice) * 100;
          return change.toFixed(2);
        }
      } catch {
        return "N/A";
      }
      return "N/A";
    }

    // Hent data parallelt
    await Promise.allSettled([
      // Kryptopriser + 24t endring
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
      // Fear & Greed index nå og historikk for endringer siste dag, uke, måned
      (async () => {
        try {
          const r = await fetchWithTimeout('https://api.alternative.me/fng/');
          const d = await r.json();
          if (d?.data?.[0]) {
            fearGreedIndex.value = d.data[0].value;
            fearGreedIndex.classification = d.data[0].value_classification;

            // Ingen direkte historikk API tilgjengelig - for demo setter vi N/A
            fearGreedIndex.change = { day: "N/A", week: "N/A", month: "N/A" };
          }
        } catch (err) {
          errors.push(`Fear & Greed-feil: ${err.message}`);
        }
      })(),
      // BTC Dominance nå og historikk (1d,7d,30d)
      (async () => {
        try {
          const r = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
          const d = await r.json();
          if (d?.data?.market_cap_percentage?.btc != null) {
            btcDominance.current = d.data.market_cap_percentage.btc.toFixed(2) + '%';
          }
          // Historikk for BTC dominance er ikke direkte tilgjengelig i CoinGecko, setter N/A
          btcDominance.change = { day: "N/A", week: "N/A", month: "N/A" };
        } catch (err) {
          errors.push(`BTC Dominance-feil: ${err.message}`);
        }
      })(),
      // VIX verdi nå og endring (vi henter daglig sluttkurs 1d, men 7d/30d ikke enkelt tilgjengelig - N/A)
      (async () => {
        try {
          const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX?range=1mo&interval=1d');
          const d = await r.json();
          const prices = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
          if (prices && prices.length > 0) {
            const today = prices[prices.length - 1];
            const dayBefore = prices[prices.length - 2];
            vixValue.current = today.toFixed(2);
            if (today != null && dayBefore != null) {
              const changeDay = ((today - dayBefore) / dayBefore) * 100;
              vixValue.change.day = changeDay.toFixed(2) + '%';
            }
          }
          // Ukentlig og månedlig endring vanskelig tilgjengelig uten mer data, setter N/A
          if (!vixValue.change.week) vixValue.change.week = "N/A";
          if (!vixValue.change.month) vixValue.change.month = "N/A";
        } catch (err) {
          errors.push(`VIX-feil: ${err.message}`);
        }
      })(),
    ]);

    // Bygg PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 820;
    const marginX = 40;
    const maxWidth = 515;

    // Tittel
    page.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, {
      x: marginX,
      y,
      size: 16,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 30;

    // Kryptopriser tabell header
    page.drawText('Kryptopriser (USD) og 24t endring:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 20;

    // Bygg kryptotabell
    const coinSymbols = {
      bitcoin: 'BTC',
      ethereum: 'ETH',
      'injective-protocol': 'INJ',
      'fetch-ai': 'FET',
      dogecoin: 'DOGE',
      ripple: 'XRP',
      solana: 'SOL',
    };

    const cryptoRows = coins.map((id) => {
      const price = cryptoPrices[id]?.usd != null ? `$${cryptoPrices[id].usd.toLocaleString()}` : "N/A";
      const change = cryptoPrices[id]?.usd_24h_change != null ? `${cryptoPrices[id].usd_24h_change.toFixed(2)}%` : "N/A";
      return [coinSymbols[id], price, change];
    });

    y = drawTable(
      page,
      helvetica,
      ['Symbol', 'Pris', '24t Endring'],
      cryptoRows,
      marginX,
      y,
      [60, 120, 100],
      20,
      12
    );

    y -= 10;
    page.drawText('Markedsindikatorer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 20;

    // Markedsindikatorer med utvikling siste dag/uke/mnd
    const marketRows = [
      ['Fear & Greed Index', `${fearGreedIndex.value} (${fearGreedIndex.classification})`, fearGreedIndex.change.day, fearGreedIndex.change.week, fearGreedIndex.change.month],
      ['VIX Index', vixValue.current, vixValue.change.day, vixValue.change.week, vixValue.change.month],
      ['BTC Dominance', btcDominance.current, btcDominance.change.day, btcDominance.change.week, btcDominance.change.month],
    ];

    y = drawTable(
      page,
      helvetica,
      ['Indikator', 'Nåværende', 'Siste dag', 'Siste uke', 'Siste måned'],
      marketRows,
      marginX,
      y,
      [160, 100, 70, 70, 70],
      20,
      12
    );

    y -= 15;
    page.drawText('Analytikeranbefalinger pr. valuta:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 20;

    // Anbefalingstabell
    const analystRows = Object.entries(analystTable).map(([symbol, counts]) => {
      const total = counts.Buy + counts.Hold + counts.Sell;
      const maxType = Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      const maxPercent = ((counts[maxType] / total) * 100).toFixed(1);
      return [
        symbol,
        total.toString(),
        counts.Buy.toString(),
        counts.Hold.toString(),
        counts.Sell.toString(),
        `${maxType.toUpperCase()} (${maxPercent}%)`,
      ];
    });

    y = drawTable(
      page,
      helvetica,
      ['Symbol', 'Antall analyser', 'Kjøp', 'Hold', 'Selg', 'Flest anbefaler'],
      analystRows,
      marginX,
      y,
      [50, 80, 50, 50, 50, 140],
      20,
      12
    );

    y -= 20;
    page.drawText('Generell Fremtidsanalyse og viktige datoer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;

    // Fremtidsanalyse tekst, bryt linjer
    const futureText = `- ETF-godkjenninger i USA forventes i Q3 2025. Positivt for institusjonell adopsjon og kan løfte markedet.  
- EU regulatoriske forslag (MiCA) trer i kraft 1. januar 2026. Strengere regulering kan føre til midlertidig volatilitet, men økt tillit på sikt.  
- Mulig renteheving fra FED 17. september 2025 kan påvirke likviditet i markedet negativt, hvilket kan gi kortsiktig nedgang i kryptomarkedet.  
- Bitcoin halvering forventes i april 2024. Historisk har dette initiert bullish trender for BTC og altcoins.  
- Geopolitiske spenninger og makroøkonomiske data bør overvåkes nøye da de kan øke volatilitet og påvirke risikoappetitt.  
- Dersom ETF-godkjenninger uteblir, eller regulatoriske tiltak blir strengere enn ventet, kan det føre til nedgang og økt usikkerhet.  
- Godkjenning av ETF og positive regulatoriske signaler kan føre til kraftig oppgang og økt kapitalinnstrømning.`;

    y = drawWrappedText(page, helvetica, futureText, marginX, y, maxWidth, 11, rgb(0, 0, 0), 14);

    // Feilmeldinger nederst (om noen)
    if (errors.length > 0) {
      y -= 20;
      page.drawText('Feil ved datainnhenting:', { x: marginX, y, size: 12, font: helveticaBold, color: rgb(1, 0, 0) });
      y -= 14;
      errors.forEach((err) => {
        y = drawWrappedText(page, helvetica, `- ${err}`, marginX, y, maxWidth, 10, rgb(1, 0, 0), 12);
      });
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (err) {
    // Siste failsafe: lag enkel PDF med feilmelding
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
