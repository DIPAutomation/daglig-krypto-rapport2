// pages/api/kryptorapport.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Tuning
const FETCH_TIMEOUT_MS = 9000; // gi APIene tid, men hold deg innen Vercel-rammer
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutter cache for tregere/sjeldnere kilder

// Enkelt in-memory cache (resettes ved cold start)
const memCache = {
  fng: { data: null, ts: 0 },
  global: { data: null, ts: 0 },
};

// Abortable fetch med timeout og robust N/A-håndtering
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Formattere
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

// Tekst-wrapping
function wrapText(text, maxWidth, font, fontSize) {
  const lines = [];
  const paragraphs = text.split('\n');
  for (const p of paragraphs) {
    const words = p.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, fontSize) > maxWidth) {
        if (line) lines.push(line);
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          lines.push(word);
          line = '';
        } else {
          line = word;
        }
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Enkel tabell
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
    bodyParser: false,
  },
};

// Hvis App Router: vurder å legge dette i /app-route-filen i stedet:
// export const maxDuration = 15; // hvis prosjektet tillater det [7][16]

export default async function handler(req, res) {
  const totalAbort = new AbortController();
  const totalTimer = setTimeout(() => totalAbort.abort(), 9800);

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

    // 1) Hovedkall: all coin data i ett kall (inkl. 24h% og 7d%)
    const marketsUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
      coins.join(',')
    )}&price_change_percentage=24h,7d`;

    // 2) BTC-dominanse (global) med cache
    async function getGlobalCached() {
      const now = Date.now();
      if (memCache.global.data && now - memCache.global.ts < CACHE_TTL_MS) {
        return memCache.global.data;
      }
      const res = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
      if (!res) return null;
      try {
        const json = await res.json();
        memCache.global = { data: json, ts: now };
        return json;
      } catch {
        return null;
      }
    }

    // 3) Fear & Greed (limit=8) med cache
    async function getFngCached() {
      const now = Date.now();
      if (memCache.fng.data && now - memCache.fng.ts < CACHE_TTL_MS) {
        return memCache.fng.data;
      }
      const res = await fetchWithTimeout('https://api.alternative.me/fng/?limit=8&format=json');
      if (!res) return null;
      try {
        const json = await res.json();
        memCache.fng = { data: json, ts: now };
        return json;
      } catch {
        return null;
      }
    }

    // Kjør hovedkall parallelt (3 kall totalt)
    const [marketsRes, globalData, fngData] = await Promise.all([
      fetchWithTimeout(marketsUrl),
      getGlobalCached(),
      getFngCached(),
    ]);

    // Parse coins/markets
    // Felter: id, symbol, name, current_price, market_cap, total_volume,
    // price_change_percentage_24h_in_currency, price_change_percentage_7d_in_currency [1][8][14]
    let markets = [];
    if (marketsRes) {
      try {
        markets = await marketsRes.json();
      } catch {
        markets = [];
      }
    }

    // Map for enkel lookup
    const byId = {};
    for (const row of markets || []) {
      byId[row.id] = row;
    }

    // Global -> BTC dominance
    let btcDominance = null;
    try {
      btcDominance = globalData?.data?.market_cap_percentage?.btc ?? null;
    } catch {
      btcDominance = null;
    }

    // FNG -> value, 1d/7d diff
    let fngToday = null;
    let fng1dChange = null;
    let fng7dChange = null;
    try {
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

    // Bygg PDF
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Side 1
    const page1 = pdfDoc.addPage([595, 842]);
    const marginX = 40;
    let y = 820;

    // Tittel
    page1.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().slice(0, 10)}`, {
      x: marginX,
      y,
      size: 20,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 40;

    // Pris-tabell (mer data: pris, 24h%, 7d%, market cap, volume)
    page1.drawText('Kryptopriser og utvikling:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const priceRows = coins.map((id) => {
      const r = byId[id] || {};
      const symbol = r.symbol ? r.symbol.toUpperCase() : (id in coinSymbols ? coinSymbols[id] : id.toUpperCase());
      const price = fmtUsd(r.current_price);
      const ch24 = fmtPct(r.price_change_percentage_24h_in_currency);
      const ch7d = fmtPct(r.price_change_percentage_7d_in_currency);
      const mcap = fmtUsd(r.market_cap);
      const vol = fmtUsd(r.total_volume);
      return [symbol, price, ch24, ch7d, mcap, vol];
    });

    y = drawTable(
      page1,
      helvetica,
      ['Symbol', 'Pris', 'Endring 24h', 'Endring 7d', 'Markedsverdi', 'Volum 24h'],
      priceRows,
      marginX,
      y,
      [60, 90, 95, 95, 120, 120],
      20,
      12
    );
    y -= 24;

    // Markedsindikatorer
    page1.drawText('Markedsindikatorer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const marketRows = [
      ['Fear & Greed Index', fngToday !== null ? fmtNum(fngToday, 0) : 'N/A', fng1dChange !== null ? fmtNum(fng1dChange, 0) : 'N/A', fng7dChange !== null ? fmtNum(fng7dChange, 0) : 'N/A'],
      ['BTC Dominance %', btcDominance !== null ? fmtNum(btcDominance, 2) : 'N/A', 'N/A', 'N/A'],
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

    page2.drawText('Kommentarer og forbehold:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const analysisText = `
- Verdier som ikke kunne hentes i tide eller feilet vises som N/A (fail-safe).
- 24h og 7d endring hentes direkte fra CoinGecko /coins/markets for bedre ytelse og færre timeouts.
- BTC-dominanse og Fear & Greed caches i 5 minutter for stabilitet.
- Rapporten er informativ og ikke investeringsråd.
`.trim();

    const fontSize = 12;
    const lineHeight = fontSize + 4;
    const maxWidth = 595 - 2 * marginX;
    const lines = wrapText(analysisText, maxWidth, helvetica, fontSize);

    for (const line of lines) {
      if (y < 60) {
        const next = pdfDoc.addPage([595, 842]);
        y = 820;
        next.drawText(line, { x: marginX, y, size: fontSize, font: helvetica });
        y -= lineHeight;
      } else {
        page2.drawText(line, { x: marginX, y, size: fontSize, font: helvetica });
        y -= lineHeight;
      }
    }

    const pdfBytes = await pdfDoc.save();

    clearTimeout(totalTimer);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=kryptorapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    clearTimeout(totalTimer);
    // Fail-safe PDF i stedet for 500
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('Rapportgenerering feilet.', { x: 40, y: 800, size: 18, font: helvetica });
    page.drawText(String(e?.message || e || 'Ukjent feil'), { x: 40, y: 770, size: 12, font: helvetica });
    const pdfBytes = await pdfDoc.save();
    res.status(200).setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));
  }
}
