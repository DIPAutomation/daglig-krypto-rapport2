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

// Tegn tekst med wrapping og linjeskift
function drawWrappedText(page, font, text, x, y, maxWidth, size, color = rgb(0, 0, 0), lineHeight = 14) {
  // Split på linjeskift først
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
    y -= lineHeight / 2; // Litt ekstra mellom avsnitt
  }
  return y;
}

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

    let cryptoPrices = {};
    let fearGreedIndex = { value: "N/A", classification: "N/A", change: { day: "N/A", week: "N/A", month: "N/A" } };
    let btcDominance = { current: "N/A", change: { day: "N/A", week: "N/A", month: "N/A" } };
    let vixValue = { current: "N/A", change: { day: "N/A", week: "N/A", month: "N/A" } };

    const analystTable = {
      BTC: { Buy: 3, Hold: 3, Sell: 1 },
      ETH: { Buy: 4, Hold: 2, Sell: 1 },
      INJ: { Buy: 5, Hold: 1, Sell: 1 },
      FET: { Buy: 2, Hold: 4, Sell: 1 },
      DOGE: { Buy: 1, Hold: 3, Sell: 3 },
      XRP: { Buy: 2, Hold: 4, Sell: 1 },
      SOL: { Buy: 4, Hold: 2, Sell: 1 }
    };

    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];

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
            fearGreedIndex.value = d.data[0].value;
            fearGreedIndex.classification = d.data[0].value_classification;
            fearGreedIndex.change = { day: "N/A", week: "N/A", month: "N/A" };
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
            btcDominance.current = d.data.market_cap_percentage.btc.toFixed(2) + '%';
          }
          btcDominance.change = { day: "N/A", week: "N/A", month: "N/A" };
        } catch (err) {
          errors.push(`BTC Dominance-feil: ${err.message}`);
        }
      })(),
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
          if (!vixValue.change.week) vixValue.change.week = "N/A";
          if (!vixValue.change.month) vixValue.change.month = "N/A";
        } catch (err) {
          errors.push(`VIX-feil: ${err.message}`);
        }
      })(),
    ]);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 820;
    const marginX = 40;
    const maxWidth = 515;

    page.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, {
      x: marginX,
      y,
      size: 16,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 30;

    page.drawText('Kryptopriser (USD) og 24t endring:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 20;

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

    const futureAnalysis = `Markedsutsiktene avhenger av globale økonomiske indikatorer og geopolitisk utvikling.
Analytikere forventer økt volatilitet fram mot neste kvartal.
Viktige datoer:
- 15. september: Fed-rente beslutning
- 30. september: Kvartalsrapportering i teknologisektoren
- 1. oktober: Nye reguleringer for kryptomarkedet`

    y = drawWrappedText(page, helvetica, futureAnalysis, marginX, y, maxWidth, 12);

    y -= 20;

    if (errors.length > 0) {
      page.drawText('Advarsler og feilmeldinger:', { x: marginX, y, size: 14, font: helveticaBold, color: rgb(1, 0, 0) });
      y -= 18;
      const errorsText = errors.join('\n');
      drawWrappedText(page, helvetica, errorsText, marginX, y, maxWidth, 10, rgb(1, 0, 0));
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="krypto-rapport.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
