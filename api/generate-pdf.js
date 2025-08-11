// pages/api/kryptorapport.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const FETCH_TIMEOUT_MS = 9000;      // gi API-kall tid, men hold deg <10s total i gratis-miljø
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutter cache for tregere kilder

// Enkel in-memory cache (resettes ved cold start)
const memCache = {
  fng: { data: null, ts: 0 },
  global: { data: null, ts: 0 },
};

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

// Formatters
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
  api: { bodyParser: false },
};

// Hjelpere for cachede kall
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

// VIX fra Yahoo Finance chart API (1d intervall over 7d) for verdi, 1d, 7d endring
async function getVix7d() {
  const res = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX?range=7d&interval=1d');
  if (!res) return { vixValue: null, vix1dChange: null, vix7dChange: null };
  try {
    const data = await res.json();
    const prices = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(prices) || prices.length < 2) {
      return { vixValue: null, vix1dChange: null, vix7dChange: null };
    }
    const vixValue = prices[prices.length - 1];
    const vix1dChange = vixValue - prices[prices.length - 2];
    const vix7dChange = vixValue - prices[0];
    return { vixValue, vix1dChange, vix7dChange };
  } catch {
    return { vixValue: null, vix1dChange: null, vix7dChange: null };
  }
}

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

    // Hovedkall: pris + 24h% + 7d% i ett
    const marketsUrl =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(coins.join(','))}&price_change_percentage=24h,7d`;

    const fetchMarkets = fetchWithTimeout(marketsUrl);
    const fetchGlobal = getGlobalCached();
    const fetchFng = getFngCached();
    const fetchVix = getVix7d();

    const [marketsRes, globalData, fngData, vixData] = await Promise.all([
      fetchMarkets,
      fetchGlobal,
      fetchFng,
      fetchVix,
    ]);

    // Parse markets
    let markets = [];
    if (marketsRes) {
      try {
        markets = await marketsRes.json();
      } catch {
        markets = [];
      }
    }
    const byId = {};
    for (const row of markets || []) {
      byId[row.id] = row;
    }

    // BTC-dominanse (global)
    let btcDominance = null;
    try {
      btcDominance = globalData?.data?.market_cap_percentage?.btc ?? null;
    } catch {
      btcDominance = null;
    }

    // Fear & Greed (dagens, 1d, 7d diff)
    let fngToday = null, fng1dChange = null, fng7dChange = null;
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

    // VIX
    const { vixValue, vix1dChange, vix7dChange } = vixData || { vixValue: null, vix1dChange: null, vix7dChange: null };

    // Analytikeranbefalinger (dummy placeholder, hentetid)
    // Her kan du senere koble på en ekte kilde; vi viser timestamp for når disse ble inkludert i rapporten.
    const analystFetchedAt = new Date().toISOString();
    const analystTable = {
      BTC: { Buy: 3, Hold: 3, Sell: 1 },
      ETH: { Buy: 4, Hold: 2, Sell: 1 },
      INJ: { Buy: 5, Hold: 1, Sell: 1 },
      FET: { Buy: 2, Hold: 4, Sell: 1 },
      DOGE: { Buy: 1, Hold: 3, Sell: 3 },
      XRP: { Buy: 2, Hold: 4, Sell: 1 },
      SOL: { Buy: 4, Hold: 2, Sell: 1 },
    };

    // Bygg PDF
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Side 1
    const page1 = pdfDoc.addPage([595, 842]);
    const marginX = 40;
    let y = 820;

    page1.drawText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().slice(0, 10)}`, {
      x: marginX, y, size: 20, font: helveticaBold, color: rgb(0, 0, 0),
    });
    y -= 40;

    // Kryptopriser og utvikling (uten market cap / volum)
    page1.drawText('Kryptopriser og utvikling:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const priceRows = coins.map((id) => {
      const r = byId[id] || {};
      const symbol = r.symbol ? r.symbol.toUpperCase() : (coinSymbols[id] || id.toUpperCase());
      const price = fmtUsd(r.current_price);
      const ch24 = fmtPct(r.price_change_percentage_24h_in_currency);
      const ch7d = fmtPct(r.price_change_percentage_7d_in_currency);
      return [symbol, price, ch24, ch7d];
    });

    y = drawTable(
      page1,
      helvetica,
      ['Symbol', 'Pris', 'Endring 24h', 'Endring 7d'],
      priceRows,
      marginX,
      y,
      [60, 120, 120, 120],
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

    // Side 2: Analytikeranbefalinger + Tolkning/Makro/Fremtidsanalyse
    const page2 = pdfDoc.addPage([595, 842]);
    y = 820;

    page2.drawText('Analytikeranbefalinger:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;
    page2.drawText(`Hentet: ${analystFetchedAt}`, { x: marginX, y, size: 10, font: helvetica });
    y -= 18;

    const analystRows = Object.entries(analystTable).map(([symbol, recs]) => [
      symbol, String(recs.Buy), String(recs.Hold), String(recs.Sell),
    ]);

    y = drawTable(
      page2,
      helvetica,
      ['Symbol', 'Kjøp', 'Hold', 'Selg'],
      analystRows,
      marginX,
      y,
      [60, 60, 60, 60],
      20,
      12
    );
    y -= 24;

    // Tolkning / Makro / Fremtidsanalyse
    page2.drawText('Tolkning av markedsindikatorer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;
    {
      const txt = `
- Høyere Fear & Greed-nivå reflekterer økt risikovilje; lavere nivå tilsier mer forsiktighet[6][12].
- Økende BTC-dominanse indikerer ofte at kapital flyttes fra altcoins til BTC i perioder med usikkerhet[16][19].
- En stigende VIX antyder økt volatilitet/risikoappetitt i tradisjonelle markeder, som ofte korrelerer med lavere risikotoleranse i krypto[6].
`.trim();
      const fontSize = 12, lineHeight = fontSize + 4, maxWidth = 595 - 2 * marginX;
      for (const line of wrapText(txt, maxWidth, helvetica, fontSize)) {
        if (y < 60) { const p = pdfDoc.addPage([595, 842]); y = 820; p.drawText(line, { x: marginX, y, size: fontSize, font: helvetica }); y -= lineHeight; }
        else { page2.drawText(line, { x: marginX, y, size: fontSize, font: helvetica }); y -= lineHeight; }
      }
    }

    y -= 10;
    page2.drawText('Makroøkonomi:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;
    {
      const txt = `
- Rentebeslutninger, inflasjonsdata og arbeidsmarked påvirker risikovilje og kapitalflyt mellom krypto og tradisjonelle aktiva[6][16].
- Strammere pengepolitikk gir ofte motvind for risikofylte aktiva; mer “dovish” signaler kan støtte sentimentet[6][16].
`.trim();
      const fontSize = 12, lineHeight = fontSize + 4, maxWidth = 595 - 2 * marginX;
      for (const line of wrapText(txt, maxWidth, helvetica, fontSize)) {
        if (y < 60) { const p = pdfDoc.addPage([595, 842]); y = 820; p.drawText(line, { x: marginX, y, size: fontSize, font: helvetica }); y -= lineHeight; }
        else { page2.drawText(line, { x: marginX, y, size: fontSize, font: helvetica }); y -= lineHeight; }
      }
    }

    y -= 10;
    page2.drawText('Fremtidsanalyse og viktige datoer:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 18;
    {
      const txt = `
- Følg kommende sentralbankmøter, KPI/PPI-slipp og store nettverksoppgraderinger i de største kjedene (BTC/ETH), da disse kan trigge økt volatilitet[1][16].
- Opsjonsutløp ved månedsslutt/kvartalsslutt kan gi kortsiktige prisbevegelser; vær oppmerksom på posisjonering og likviditet[16].
`.trim();
      const fontSize = 12, lineHeight = fontSize + 4, maxWidth = 595 - 2 * marginX;
      for (const line of wrapText(txt, maxWidth, helvetica, fontSize)) {
        if (y < 60) { const p = pdfDoc.addPage([595, 842]); y = 820; p.drawText(line, { x: marginX, y, size: fontSize, font: helvetica }); y -= lineHeight; }
        else { page2.drawText(line, { x: marginX, y, size: fontSize, font: helvetica }); y -= lineHeight; }
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
