import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function fetchWithTimeout(url, options = {}, timeout = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error('Fetch error');
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

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
    y -= lineHeight / 2;
  }
  return y;
}

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

  // Rows
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
    if (!res) return 'N/A';
    const data = await res.json();
    if (data?.prices && data.prices.length > 1) {
      const startPrice = data.prices[0][1];
      const endPrice = data.prices[data.prices.length - 1][1];
      const change = ((endPrice - startPrice) / startPrice) * 100;
      return (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
    }
  } catch {
    return 'N/A';
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

    // Hent data parallelt med timeout og fallback
    const [
      priceRes,
      fngRes,
      globalRes,
      vixRes,
    ] = await Promise.all([
      fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`),
      fetchWithTimeout('https://api.alternative.me/fng/'),
      fetchWithTimeout('https://api.coingecko.com/api/v3/global'),
      fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX?range=1mo&interval=1d'),
    ]);

    const cryptoPrices = priceRes ? await priceRes.json() : {};
    const fngData = fngRes ? await fngRes.json() : null;
    const globalData = globalRes ? await globalRes.json() : null;
    const vixData = vixRes ? await vixRes.json() : null;

    // Hent historisk endring for kryptovalutaer, parallelt og raskt
    const cryptoChangesPromises = coins.map((coin) => {
      return Promise.all([
        fetchHistoricalChange(coin, 1),
        fetchHistoricalChange(coin, 7),
        fetchHistoricalChange(coin, 30),
      ]);
    });

    const cryptoChangesArr = await Promise.all(cryptoChangesPromises);

    const cryptoChanges = {};
    coins.forEach((coin, i) => {
      cryptoChanges[coin] = {
        day: cryptoChangesArr[i][0],
        week: cryptoChangesArr[i][1],
        month: cryptoChangesArr[i][2],
      };
    });

    // Markedsindikatorer nåverdi
    const fearGreedIndex = {
      current: fngData?.data?.[0]?.value ?? 'N/A',
      classification: fngData?.data?.[0]?.value_classification ?? 'N/A',
    };

    const btcDominance = globalData?.data?.market_cap_percentage?.btc ? globalData.data.market_cap_percentage.btc.toFixed(2) + '%' : 'N/A';

    const vixPrices = vixData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const vixCurrent = vixPrices.length ? vixPrices[vixPrices.length - 1].toFixed(2) : 'N/A';

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

    // Lag PDF
    const pdfDoc = await PDFDocument.create();
    const page1 = pdfDoc.addPage([595, 842]); // A4
    const page2 = pdfDoc.addPage([595, 842]); // A4

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const marginX = 40;
    let y = 820;
    const maxWidth = 515;

    // --- SIDE 1 ---
    page1.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, {
      x: marginX,
      y,
      size: 18,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 35;

    // Kryptopriser og utvikling
    page1.drawText('Kryptopriser (USD) og utvikling:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const cryptoRows = coins.map((id) => {
      const price = cryptoPrices[id]?.usd != null ? `$${cryptoPrices[id].usd.toLocaleString()}` : 'N/A';
      const dayCh = cryptoChanges[id]?.day ?? 'N/A';
      const weekCh = cryptoChanges[id]?.week ?? 'N/A';
      const monthCh = cryptoChanges[id]?.month ?? 'N/A';
      return [coinSymbols[id], price, dayCh, weekCh, monthCh];
    });

    y = drawTable(
      page1,
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

    // Markedsindikatorer
    page1.drawText('Markedsindikatorer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const marketRows = [
      ['Fear & Greed Index', `${fearGreedIndex.current} (${fearGreedIndex.classification})`, 'N/A', 'N/A', 'N/A'],
      ['BTC Dominance', btcDominance, 'N/A', 'N/A', 'N/A'],
      ['VIX Index', vixCurrent, 'N/A', 'N/A', 'N/A'],
    ];

    y = drawTable(
      page1,
      helvetica,
      ['Indikator', 'Nåverdi', 'Endring 1 dag', 'Endring 1 uke', 'Endring 1 måned'],
      marketRows,
      marginX,
      y,
      [200, 120, 65, 65, 65],
      20,
      12
    );

    // --- SIDE 2 ---
    let y2 = 820;
    page2.drawText('Analytikeranbefalinger pr. valuta:', { x: marginX, y: y2, size: 14, font: helveticaBold });
    y2 -= 22;

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

    y2 = drawTable(
      page2,
      helvetica,
      ['Symbol', 'Antall analyser', 'Buy', 'Hold', 'Sell', 'Største konsensus'],
      analystRows,
      marginX,
      y2,
      [50, 90, 50, 50, 50, 120],
      20,
      12
    );

    y2 -= 20;

    // Markedsanalyse tekst (forkortet, kan utvides)
    const analysisText = `Tolkning av markedsindikatorer og makroøkonomi:

Fear & Greed Index nærmer seg ekstrem frykt, noe som ofte kan indikere kjøpsmuligheter.
BTC Dominance viser fortsatt dominans i markedet.
VIX-indeksen indikerer økt volatilitet i aksjemarkedet, som ofte korrelerer med kryptomarkedet.

Generell fremtidsanalyse:
Viktige kommende hendelser som OMC rentemøte i USA kan gi signaler om pengepolitikk.
Q4 2025: Flere store blockchain-oppgraderinger forventes, som kan skape volatilitet.
2026: Mulig økt regulering i EU og USA.

Disse datoene kan ha stor betydning for markedets retning og bør følges nøye.`;

    y2 = drawWrappedText(page2, helvetica, analysisText, marginX, y2, maxWidth, 12);

    // Lag PDF-data
    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=kryptorapport.pdf`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Noe gikk galt' });
  }
}
