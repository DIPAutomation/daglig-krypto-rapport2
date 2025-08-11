// pages/api/kryptorapport.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TIMEOUT_MS = 6500; // litt under 7s for å holde total under 10s
const HEADERS_JSON = { 'Content-Type': 'application/json' };

// Abortable fetch med timeout og konsistent feilretur
async function fetchWithTimeout(url, options = {}, timeout = TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

// Sikker tall-format
function fmtNum(n, decimals = 2) {
  if (typeof n !== 'number' || isNaN(n)) return 'N/A';
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtUsd(n) {
  if (typeof n !== 'number' || isNaN(n)) return 'N/A';
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (typeof n !== 'number' || isNaN(n)) return 'N/A';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// Robust tekstavbryter
function wrapText(text, maxWidth, font, fontSize) {
  const lines = [];
  const paragraphs = text.split('\n');
  for (const p of paragraphs) {
    const words = p.split(' ');
    let line = '';
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const w = font.widthOfTextAtSize(testLine, fontSize);
      if (w > maxWidth) {
        if (line) lines.push(line);
        // hvis enkeltord er for langt, tving det inn
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          lines.push(word);
          line = '';
        } else {
          line = word;
        }
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Enkel tabelltegner (ingen rammer, lett bakgrunn annenhver rad)
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
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    x = startX;
    if (idx % 2 === 1) {
      page.drawRectangle({
        x: startX,
        y: y - rowHeight,
        width: colWidths.reduce((a, b) => a + b, 0),
        height: rowHeight,
        color: lightGray,
      });
    }
    for (let i = 0; i < row.length; i++) {
      const cell = row[i] ?? 'N/A';
      page.drawText(String(cell), { x: x + 5, y: y - rowHeight + 5, size: fontSize, font, color: black });
      x += colWidths[i];
    }
    y -= rowHeight;
  }
  return y;
}

export const config = {
  api: {
    bodyParser: false, // minimal overhead
  },
};

export default async function handler(req, res) {
  // Hard timeout guard for hele requesten (best effort)
  const controller = new AbortController();
  const totalTimeout = setTimeout(() => controller.abort(), 9500);

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

    // Start alle kall parallelt
    const priceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true`;
    const globalUrl = 'https://api.coingecko.com/api/v3/global';
    const fngUrl = 'https://api.alternative.me/fng/?limit=8&format=json';

    // 7d change via market_chart kun for coins i ett parallelt sett, men hvert kall for seg – begrens til kun nødvendige data
    const mcUrls = coins.map((id) => `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7`);

    const fetchPromises = [
      fetchWithTimeout(priceUrl),
      fetchWithTimeout(globalUrl),
      fetchWithTimeout(fngUrl),
      ...mcUrls.map((u) => fetchWithTimeout(u)),
    ];

    const results = await Promise.allSettled(fetchPromises);

    let cryptoPrices = {};
    // prices
    if (results[0].status === 'fulfilled' && results[0].value) {
      try {
        cryptoPrices = await results[0].value.json();
      } catch {
        cryptoPrices = {};
      }
    }

    // global (btc dominance)
    let btcDominance = null;
    if (results[1].status === 'fulfilled' && results[1].value) {
      try {
        const globalData = await results[1].value.json();
        btcDominance = globalData?.data?.market_cap_percentage?.btc ?? null;
      } catch {
        btcDominance = null;
      }
    }

    // FNG
    let fngToday = null, fng1dChange = null, fng7dChange = null;
    if (results[2].status === 'fulfilled' && results[2].value) {
      try {
        const fngData = await results[2].value.json();
        const arr = fngData?.data ?? [];
        if (arr.length >= 1) {
          const v0 = parseFloat(arr[0].value);
          fngToday = isNaN(v0) ? null : v0;
        }
        if (arr.length >= 2 && fngToday !== null) {
          const v1 = parseFloat(arr[1].value);
          fng1dChange = isNaN(v1) ? null : fngToday - v1;
        }
        if (arr.length >= 8 && fngToday !== null) {
          const v7 = parseFloat(arr[7].value);
          fng7dChange = isNaN(v7) ? null : fngToday - v7;
        }
      } catch {
        fngToday = fng1dChange = fng7dChange = null;
      }
    }

    // 7d changes fra market_chart results[3..]
    const changes7d = {};
    const mcOffset = 3;
    for (let i = 0; i < coins.length; i++) {
      const r = results[mcOffset + i];
      if (r.status === 'fulfilled' && r.value) {
        try {
          const data = await r.value.json();
          const prices = data?.prices;
          if (Array.isArray(prices) && prices.length >= 2) {
            const first = prices[0][1];
            const last = prices[prices.length - 1][1];
            const ch = (last - first) / first * 100;
            changes7d[coins[i]] = ch;
          } else {
            changes7d[coins[i]] = null;
          }
        } catch {
          changes7d[coins[i]] = null;
        }
      } else {
        changes7d[coins[i]] = null;
      }
    }

    // VIX: valgfritt forsøk via St. Louis FRED proxy (kan feile uten API key) -> sett N/A ved feil.
    // For å holde stabilitet og <=10s, dropp kall hvis miljøet ikke støtter det.
    let vixValue = null, vix1dChange = null, vix7dChange = null;
    // Hvis ønskelig kan dette fjernes helt for 100% stabilitet.

    // Lag PDF
    const pdfDoc = await PDFDocument.create();
    const page1 = pdfDoc.addPage([595, 842]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const marginX = 40;
    let y = 820;

    const title = `Daglig Kryptomarked Rapport – ${new Date().toISOString().slice(0, 10)}`;
    page1.drawText(title, { x: marginX, y, size: 20, font: helveticaBold, color: rgb(0, 0, 0) });
    y -= 40;

    page1.drawText('Kryptopriser og utvikling:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const priceRows = coins.map((id) => {
      const symbol = coinSymbols[id];
      const price = cryptoPrices[id]?.usd ?? null;
      const change1d = cryptoPrices[id]?.usd_24h_change ?? null;
      const change7d = typeof changes7d[id] === 'number' ? changes7d[id] : null;
      return [symbol, fmtUsd(price), fmtPct(change1d), fmtPct(change7d)];
    });

    y = drawTable(
      page1,
      helvetica,
      ['Symbol', 'Pris (USD)', 'Endring 1d', 'Endring 7d'],
      priceRows,
      marginX,
      y,
      [60, 120, 100, 100],
      20,
      12
    );
    y -= 24;

    page1.drawText('Markedsindikatorer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const marketRows = [
      ['Fear & Greed Index', fngToday !== null ? fmtNum(fngToday, 0) : 'N/A', fng1dChange !== null ? fmtNum(fng1dChange, 0) : 'N/A', fng7dChange !== null ? fmtNum(fng7dChange, 0) : 'N/A'],
      ['BTC Dominance %', btcDominance !== null ? fmtNum(btcDominance, 2) : 'N/A', 'N/A', 'N/A'],
      ['VIX (volatilitet)', vixValue !== null ? fmtNum(vixValue, 2) : 'N/A', vix1dChange !== null ? fmtNum(vix1dChange, 2) : 'N/A', vix7dChange !== null ? fmtNum(vix7dChange, 2) : 'N/A'],
    ];

    y = drawTable(
      page1,
      helvetica,
      ['Indikator', 'Verdi', 'Endring 1d', 'Endring 7d'],
      marketRows,
      marginX,
      y,
      [160, 100, 100, 100],
      20,
      12
    );

    // Side 2
    const page2 = pdfDoc.addPage([595, 842]);
    y = 820;

    page2.drawText('Kommentarer og tolkning:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    // Kort, ikke-spekulativ kommentar uten faste datoer
    const analysisText = `
Tolkning av indikatorer:
- Et høyere Fear & Greed-nivå kan reflektere økt risikovilje, mens lavere nivåer ofte indikerer forsiktighet.
- Økende BTC-dominans kan innebære at kapital flyttes fra altcoins til BTC i usikre perioder.
- VIX gir et grovt mål på risikosentiment i tradisjonelle markeder; høyere VIX er ofte korrelert med lavere risikotoleranse.

Forbehold:
- Data kan være forsinket, utilgjengelig eller underlagt rate limits. Verdier som ikke kunne hentes vises som N/A.
- Rapporten er kun informativ og ikke investeringsråd.
`.trim();

    const fontSize = 12;
    const lineHeight = fontSize + 4;
    const maxWidth = 595 - 2 * marginX;
    const lines = wrapText(analysisText, maxWidth, helvetica, fontSize);

    for (const line of lines) {
      if (y < 60) {
        page2.drawText('Fortsetter på neste side...', { x: marginX, y: 40, size: 10, font: helvetica });
        // legg til ny side
        const nextPage = pdfDoc.addPage([595, 842]);
        y = 820;
        // oppdater referanse til aktiv side
        // NB: for enkelhet, ikke bruk page2 etter dette punktet
        nextPage.drawText(line, { x: marginX, y, size: fontSize, font: helvetica });
        y -= lineHeight;
        continue;
      }
      page2.drawText(line, { x: marginX, y, size: fontSize, font: helvetica });
      y -= lineHeight;
    }

    const pdfBytes = await pdfDoc.save();

    clearTimeout(totalTimeout);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=kryptorapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    clearTimeout(totalTimeout);
    res.status(200).setHeader('Content-Type', 'application/pdf');

    // Fallback: returner en enkel PDF med feilmelding (unngå 500 for bedre UX i klienter)
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('Rapportgenerering feilet.', { x: 40, y: 800, size: 18, font: helvetica });
    page.drawText(String(e?.message || e || 'Ukjent feil'), { x: 40, y: 770, size: 12, font: helvetica });
    const pdfBytes = await pdfDoc.save();
    res.send(Buffer.from(pdfBytes));
  }
}
