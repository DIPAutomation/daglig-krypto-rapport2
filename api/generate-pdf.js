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

    // Kun hent dagens pris og 24h endring
    const priceRes = await fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true`, {}, 6000);
    const cryptoPrices = priceRes ? await priceRes.json() : {};

    const pdfDoc = await PDFDocument.create();
    const page1 = pdfDoc.addPage([595, 842]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const marginX = 40;
    let y = 820;

    page1.drawText(`Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, {
      x: marginX,
      y,
      size: 18,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 35;

    page1.drawText('Kryptopriser (USD) og 24h endring:', { x: marginX, y, size: 14, font: helveticaBold });
    y -= 22;

    const cryptoRows = coins.map((id) => {
      const price = cryptoPrices[id]?.usd != null ? `$${cryptoPrices[id].usd.toLocaleString()}` : 'N/A';
      const change = cryptoPrices[id]?.usd_24h_change != null ? `${cryptoPrices[id].usd_24h_change.toFixed(2)}%` : 'N/A';
      return [coinSymbols[id], price, change];
    });

    y = drawTable(
      page1,
      helvetica,
      ['Symbol', 'Pris', 'Endring 24 timer'],
      cryptoRows,
      marginX,
      y,
      [60, 120, 120],
      20,
      12
    );

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=kryptorapport.pdf`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Noe gikk galt' });
  }
}
