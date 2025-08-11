import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Timeout fetch med abort
async function fetchWithTimeout(url, options = {}, timeout = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return res;
  } catch (e) {
    clearTimeout(id);
    return null;
  }
}

// Hjelpefunksjon for å tegne tabeller i pdf-lib
function drawTable(page, font, headers, rows, startX, startY, colWidths, rowHeight, fontSize) {
  let y = startY;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.85, 0.85, 0.85);
  const lightGray = rgb(0.95, 0.95, 0.95);

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

// Hjelpefunksjon for prosentendring (hvis data mangler returnerer N/A)
function formatChange(value) {
  if (typeof value === 'number' && !isNaN(value)) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }
  return 'N/A';
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

    // Hent priser + 1d + 7d endringer
    let cryptoPrices = {};
    const priceRes = await fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    if (priceRes) {
      cryptoPrices = await priceRes.json();
    }

    // 7d endringer
    async function fetch7dChange(id) {
      const res = await fetchWithTimeout(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7`);
      if (!res) return null;
      const data = await res.json();
      if (!data.prices || data.prices.length < 2) return null;
      const first = data.prices[0][1];
      const last = data.prices[data.prices.length - 1][1];
      return ((last - first) / first) * 100;
    }
    const changes7dPromises = coins.map((id) => fetch7dChange(id));
    const changes7dResults = await Promise.allSettled(changes7dPromises);

    // Fear & Greed Index (8 dager)
    let fngToday = null, fng1dChange = null, fng7dChange = null;
    try {
      const fngRes = await fetchWithTimeout('https://api.alternative.me/fng/?limit=8&format=json');
      if (fngRes) {
        const fngData = await fngRes.json();
        if (fngData?.data?.length >= 1) {
          fngToday = parseFloat(fngData.data[0].value);
          if (fngData.data.length > 1) fng1dChange = fngToday - parseFloat(fngData.data[1].value);
          if (fngData.data.length > 7) fng7dChange = fngToday - parseFloat(fngData.data[7].value);
        }
      }
    } catch {}

    // BTC Dominance (fra global endpoint)
    let btcDominance = null, btcDom1dChange = null, btcDom7dChange = null;
    try {
      const globalRes = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
      if (globalRes) {
        const globalData = await globalRes.json();
        btcDominance = globalData.data?.market_cap_percentage?.btc ?? null;
        // Merk: ingen offisiell 7d data i API, så vi dropper endringer her for stabilitet
      }
    } catch {}

    // VIX indeks
    let vixValue = null, vix1dChange = null, vix7dChange = null;
    try {
      const vixRes = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX?range=7d&interval=1d');
      if (vixRes) {
        const vixData = await vixRes.json();
        const prices = vixData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        if (prices && prices.length >= 2) {
          vixValue = prices[prices.length - 1];
          vix1dChange = vixValue - prices[prices.length - 2];
          vix7dChange = vixValue - prices[0];
        }
      }
    } catch {}

    // Dummy analytikeranbefalinger
    const analystTable = {
      BTC: { Buy: 3, Hold: 3, Sell: 1 },
      ETH: { Buy: 4, Hold: 2, Sell: 1 },
      INJ: { Buy: 5, Hold: 1, Sell: 1 },
      FET: { Buy: 2, Hold: 4, Sell: 1 },
      DOGE: { Buy: 1, Hold: 3, Sell: 3 },
      XRP: { Buy: 2, Hold: 4, Sell: 1 },
      SOL: { Buy: 4, Hold: 2, Sell: 1 },
    };

    // Lag PDF
    const pdfDoc = await PDFDocument.create();

    const page1 = pdfDoc.addPage([595, 842]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 820;
    const marginX = 40;

    page1.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().slice(0, 10)}`, {
      x: marginX,
      y,
      size: 20,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 40;

    page1.drawText('Kryptopriser og utvikling:', {
      x: marginX,
      y,
      size: 14,
      font: helveticaBold,
    });
    y -= 22;

    const priceRows = coins.map((id, i) => {
      const symbol = coinSymbols[id];
      const price = cryptoPrices[id]?.usd ? `$${cryptoPrices[id].usd.toLocaleString()}` : 'N/A';
      const change1d = cryptoPrices[id]?.usd_24h_change ?? null;
      const change7d = changes7dResults[i].status === 'fulfilled' && typeof changes7dResults[i].value === 'number' ? changes7dResults[i].value : null;

      return [
        symbol,
        price,
        formatChange(change1d),
        formatChange(change7d),
      ];
    });

    y = drawTable(
      page1,
      helvetica,
      ['Symbol', 'Pris (USD)', 'Endring 1d', 'Endring 7d'],
      priceRows,
      marginX,
      y,
      [50, 100, 100, 100],
      20,
      12
    );

    y -= 30;

    page1.drawText('Markedsindikatorer:', {
      x: marginX,
      y,
      size: 14,
      font: helveticaBold,
    });
    y -= 22;

    const marketRows = [
      [
        'Fear & Greed Index',
        fngToday !== null ? fngToday.toFixed(2) : 'N/A',
        fng1dChange !== null ? (fng1dChange >= 0 ? '+' : '') + fng1dChange.toFixed(2) : 'N/A',
        fng7dChange !== null ? (fng7dChange >= 0 ? '+' : '') + fng7dChange.toFixed(2) : 'N/A',
      ],
      [
        'BTC Dominance %',
        btcDominance !== null ? btcDominance.toFixed(2) : 'N/A',
        btcDom1dChange !== null ? (btcDom1dChange >= 0 ? '+' : '') + btcDom1dChange.toFixed(2) : 'N/A',
        btcDom7dChange !== null ? (btcDom7dChange >= 0 ? '+' : '') + btcDom7dChange.toFixed(2) : 'N/A',
      ],
      [
        'VIX (volatilitet)',
        vixValue !== null ? vixValue.toFixed(2) : 'N/A',
        vix1dChange !== null ? (vix1dChange >= 0 ? '+' : '') + vix1dChange.toFixed(2) : 'N/A',
        vix7dChange !== null ? (vix7dChange >= 0 ? '+' : '') + vix7dChange.toFixed(2) : 'N/A',
      ],
    ];

    y = drawTable(
      page1,
      helvetica,
      ['Indikator', 'Verdi', 'Endring 1d', 'Endring 7d'],
      marketRows,
      marginX,
      y,
      [140, 80, 80, 80],
      20,
      12
    );

    // --- Side 2 ---
    const page2 = pdfDoc.addPage([595, 842]);
    y = 820;

    page2.drawText('Analytikeranbefalinger:', {
      x: marginX,
      y,
      size: 14,
      font: helveticaBold,
    });
    y -= 22;

    const analystRows = Object.entries(analystTable).map(([symbol, recs]) => [
      symbol,
      recs.Buy.toString(),
      recs.Hold.toString(),
      recs.Sell.toString(),
    ]);

    y = drawTable(
      page2,
      helvetica,
      ['Symbol', 'Kjøp', 'Hold', 'Selg'],
      analystRows,
      marginX,
      y,
      [50, 60, 60, 60],
      20,
      12
    );
    y -= 30;

    // Tekst for tolkning og makroøkonomi
    const analysisText = `Tolkning av markedsindikatorer:
- Fear & Greed Index viser nå et nivå på ${fngToday !== null ? fngToday : 'N/A'}, noe som indikerer ${(fngToday !== null && fngToday > 50) ? 'optimisme' : 'bekymring'} i markedet.
- BTC Dominance ligger på ${btcDominance !== null ? btcDominance.toFixed(2) + '%' : 'N/A'}, og en økning kan tyde på at BTC tar markedsandeler fra altcoins.
- VIX-verdien på ${vixValue !== null ? vixValue.toFixed(2) : 'N/A'} reflekterer markedsvolatilitet, hvor høyere verdi kan gi økt usikkerhet.

Makroøkonomi og kryptomarked:
- Globale rentebeslutninger og inflasjonsdata påvirker investorers risikovillighet.
- Forventede sentralbankmøter i kommende uker kan skape volatilitet.

Generell fremtidsanalyse og viktige datoer:
- 15. september: Fed-møte – kan gi signaler om renteendringer. En strammere pengepolitikk kan presse kryptomarkedet ned.
- 30. september: Utløp av viktige opsjoner – kan føre til kortsiktig volatilitet.
- 10. oktober: Lansering av større oppgraderinger i Ethereum-nettverket – kan styrke ETH.

Mulige utfall:
- Hvis Fed signaliserer ytterligere rentehevinger, forventes økt salgspress på kryptovalutaer.
- Positive oppgraderinger kan øke investoroptimisme og prisene.
`;

    // Wrap og tegn tekst linje for linje (unngå \n)
    const fontSize = 12;
    const marginBottom = 40;
    const maxWidth = 595 - 2 * marginX;
    const lineHeight = fontSize + 4;

    function wrapText(text, maxWidth, font, fontSize) {
      const words = text.split(' ');
      let lines = [];
      let currentLine = '';

      words.forEach((word) => {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const width = font.widthOfTextAtSize(testLine, fontSize);
        if (width > maxWidth) {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });
      if (currentLine) lines.push(currentLine);
      return lines;
    }

    let lines = wrapText(analysisText.trim(), maxWidth, helvetica, fontSize);

    for (const line of lines) {
      if (y < marginBottom) {
        y = 820;
        pdfDoc.addPage([595, 842]);
      }
      page2.drawText(line, { x: marginX, y, size: fontSize, font: helvetica });
      y -= lineHeight;
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=kryptorapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    res.status(500).json({ error: 'Rapportgenerering feilet: ' + e.message });
  }
}
