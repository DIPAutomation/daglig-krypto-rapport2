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

// Funksjon for å tegne tekst med wrapping og linjeskift
function drawWrappedText(page, font, text, x, y, maxWidth, size, color = rgb(0, 0, 0), lineHeight = 14) {
  const paragraphs = text.split('\n');
  for (const paragraph of paragraphs) {
    let words = paragraph.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const testWidth = font.widthOfTextAtSize(testLine, size);
      if (testWidth > maxWidth && n > 0) {
        page.drawText(line.trim(), { x, y, size, font, color });
        y -= lineHeight;
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    if (line) {
      page.drawText(line.trim(), { x, y, size, font, color });
      y -= lineHeight;
    }
    y -= lineHeight / 2; // mellom avsnitt
  }
  return y;
}

// Tegn tabell med enkel striping
function drawTable(page, font, headers, rows, startX, startY, colWidths, rowHeight, fontSize) {
  let y = startY;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.85, 0.85, 0.85);
  const lightGray = rgb(0.95, 0.95, 0.95);

  // Header
  let x = startX;
  headers.forEach((h, i) => {
    page.drawRectangle({ x, y: y - rowHeight, width: colWidths[i], height: rowHeight, color: gray });
    page.drawText(h, { x: x + 5, y: y - rowHeight + 5, size: fontSize, font, color: black });
    x += colWidths[i];
  });

  y -= rowHeight;

  // Rader
  rows.forEach((row, idx) => {
    x = startX;
    if (idx % 2 === 1) {
      page.drawRectangle({ x: startX, y: y - rowHeight, width: colWidths.reduce((a, b) => a + b, 0), height: rowHeight, color: lightGray });
    }
    row.forEach((cell, i) => {
      page.drawText(cell, { x: x + 5, y: y - rowHeight + 5, size: fontSize, font, color: black });
      x += colWidths[i];
    });
    y -= rowHeight;
  });

  return y;
}

async function fetchHistoricalChange(id, days) {
  try {
    const res = await fetchWithTimeout(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
    const data = await res.json();
    if (data?.prices && data.prices.length > 1) {
      const startPrice = data.prices[0][1];
      const endPrice = data.prices[data.prices.length - 1][1];
      const change = ((endPrice - startPrice) / startPrice) * 100;
      return change.toFixed(2) + '%';
    }
  } catch {
    return 'N/A';
  }
  return 'N/A';
}

async function fetchIndicatorChange(apiUrl, days) {
  // Henter historisk verdi for markedsindikator over siste dager og beregner endring
  try {
    const res = await fetchWithTimeout(apiUrl);
    const json = await res.json();

    // Her må man tilpasse etter kildedata for å hente riktig verdi.
    // For enkelhet: Returnerer "N/A" – du kan utvide med riktig parsing hvis ønskelig.
    return 'N/A';
  } catch {
    return 'N/A';
  }
}

export default async function handler(req, res) {
  try {
    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];
    const coinSymbols = {
      bitcoin: 'BTC',
      ethereum: 'ETH',
      'injective-protocol': 'INJ',
      'fetch-ai': 'FET',
      dogecoin: 'DOGE',
      ripple: 'XRP',
      solana: 'SOL',
    };

    // Hent dagens pris og markedsdata
    let cryptoPrices = {};
    let cryptoChanges = {}; // dag, uke, mnd

    // Markedsindikatorer med utvikling siste dag, uke, mnd (eksempel for Fear&Greed og BTC dominance)
    let fearGreedIndex = { current: 'N/A', classification: 'N/A', dayChange: 'N/A', weekChange: 'N/A', monthChange: 'N/A' };
    let btcDominance = { current: 'N/A', dayChange: 'N/A', weekChange: 'N/A', monthChange: 'N/A' };
    let vixValue = { current: 'N/A', dayChange: 'N/A', weekChange: 'N/A', monthChange: 'N/A' };

    // Analytikeranbefalinger statisk eksempel
    const analystTable = {
      BTC: { Buy: 3, Hold: 3, Sell: 1 },
      ETH: { Buy: 4, Hold: 2, Sell: 1 },
      INJ: { Buy: 5, Hold: 1, Sell: 1 },
      FET: { Buy: 2, Hold: 4, Sell: 1 },
      DOGE: { Buy: 1, Hold: 3, Sell: 3 },
      XRP: { Buy: 2, Hold: 4, Sell: 1 },
      SOL: { Buy: 4, Hold: 2, Sell: 1 },
    };

    // Hent data parallelt
    await Promise.all([
      (async () => {
        try {
          const r = await fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`);
          cryptoPrices = await r.json();
        } catch {}
      })(),
      (async () => {
        for (const coin of coins) {
          cryptoChanges[coin] = {
            day: await fetchHistoricalChange(coin, 1),
            week: await fetchHistoricalChange(coin, 7),
            month: await fetchHistoricalChange(coin, 30),
          };
        }
      })(),
      (async () => {
        // Fear & Greed Index nåværende
        try {
          const r = await fetchWithTimeout('https://api.alternative.me/fng/');
          const d = await r.json();
          if (d?.data?.[0]) {
            fearGreedIndex.current = d.data[0].value;
            fearGreedIndex.classification = d.data[0].value_classification;
          }
        } catch {}
      })(),
      (async () => {
        // BTC dominance
        try {
          const r = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
          const d = await r.json();
          if (d?.data?.market_cap_percentage?.btc != null) {
            btcDominance.current = d.data.market_cap_percentage.btc.toFixed(2) + '%';
          }
        } catch {}
      })(),
      (async () => {
        // VIX
        try {
          const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX?range=1mo&interval=1d');
          const d = await r.json();
          const prices = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
          if (prices && prices.length > 0) {
            vixValue.current = prices[prices.length - 1].toFixed(2);
          }
        } catch {}
      })(),
    ]);

    // Opprett PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 820;
    const marginX = 40;
    const maxWidth = 515;

    // Tittel
    page.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, {
      x: marginX,
      y,
      size: 18,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 35;

    // Kryptopriser og endringer
    page.drawText('Kryptopriser (USD) og utvikling:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const cryptoRows = coins.map((id) => {
      const price = cryptoPrices[id]?.usd != null ? `$${cryptoPrices[id].usd.toLocaleString()}` : 'N/A';
      const dayCh = cryptoChanges[id]?.day ?? 'N/A';
      const weekCh = cryptoChanges[id]?.week ?? 'N/A';
      const monthCh = cryptoChanges[id]?.month ?? 'N/A';
      return [coinSymbols[id], price, dayCh, weekCh, monthCh];
    });

    y = drawTable(
      page,
      helvetica,
      ['Symbol', 'Pris', 'Endring 1 dag', 'Endring 1 uke', 'Endring 1 måned'],
      cryptoRows,
      marginX,
      y,
      [50, 100, 100, 100, 100],
      20,
      12
    );

    y -= 15;

    // Markedsindikatorer med utvikling (kun nåverdi, fordi historisk data krever mer tilpasset parsing)
    page.drawText('Markedsindikatorer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const marketRows = [
      ['Fear & Greed Index', `${fearGreedIndex.current} (${fearGreedIndex.classification})`, 'N/A', 'N/A', 'N/A'],
      ['BTC Dominance', btcDominance.current, 'N/A', 'N/A', 'N/A'],
      ['VIX Index', vixValue.current, 'N/A', 'N/A', 'N/A'],
    ];

    y = drawTable(
      page,
      helvetica,
      ['Indikator', 'Nåverdi', 'Endring 1 dag', 'Endring 1 uke', 'Endring 1 måned'],
      marketRows,
      marginX,
      y,
      [200, 120, 65, 65, 65],
      20,
      12
    );

    y -= 20;

    // Analytikeranbefalinger
    page.drawText('Analytikeranbefalinger pr. valuta:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

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
      [50, 80, 50, 50, 50, 120],
      20,
      12
    );

    y -= 20;

    // Tolkning av markedsindikatorer
    page.drawText('Tolkning av markedsindikatorer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;
    const marketInterpretation =
`Fear & Greed Index indikerer markedets sentiment; høy verdi kan tyde på overkjøpt marked, lav verdi på frykt og muligheter for kjøp.
BTC Dominance viser andelen av total markedsverdi Bitcoin har. Økende dominans kan indikere styrke i Bitcoin sammenlignet med altcoins.
VIX Index reflekterer volatilitet i aksjemarkedet, som ofte korrelerer med risikoappetitt i kryptomarkedet. Høy VIX kan bety økt usikkerhet.`;

    y = drawWrappedText(page, helvetica, marketInterpretation, marginX, y, maxWidth, 12);

    y -= 10;

    // Makroøkonomi og kryptomarkedet
    page.drawText('Makroøkonomi og kryptomarkedet:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;
    const macroText =
`Rentebeslutninger fra sentralbanker, inflasjonsdata og globale økonomiske indikatorer påvirker kapitalflyt og risikovilje.
Strengere reguleringer kan dempe vekst, mens økt adopsjon og institusjonell interesse driver markedet opp.
Geopolitiske hendelser og teknologiske innovasjoner er også viktige drivere.`;

    y = drawWrappedText(page, helvetica, macroText, marginX, y, maxWidth, 12);

    y -= 10;

    // Generelle fremtidsanalyser og viktige datoer
    page.drawText('Generelle fremtidsanalyser og viktige datoer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;
    const futureAnalysis =
`Markedet forventes å bli påvirket av flere viktige avgjørelser og hendelser fremover:

- 15. september 2025: FOMC rentemøte i USA kan gi signaler om pengepolitikk.
- Q4 2025: Flere store blockchain-oppgraderinger forventes, som kan skape volatilitet.
- 2026: Mulig økt regulering i EU og USA.

Disse datoene kan ha stor betydning for markedets retning og bør følges nøye.`;

    y = drawWrappedText(page, helvetica, futureAnalysis, marginX, y, maxWidth, 12);

    // Lag PDF-data
    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=kryptorapport.pdf`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Noe gikk galt' });
  }
}
