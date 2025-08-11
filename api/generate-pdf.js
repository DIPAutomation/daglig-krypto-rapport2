import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export default async function handler(req, res) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  let y = height - 50;
  const drawLine = (text) => {
    page.drawText(text, { x: 50, y, size: 12, font, color: rgb(0, 0, 0) });
    y -= 18;
  };

  drawLine(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`);
  drawLine('');
  drawLine('Kryptopriser og Analyse:');
  const cryptoData = {
    BTC: { price: '$118,450', support: '$114,000', resistance: '$122,000', analyst: 'Hold' },
    ETH: { price: '$4,320', support: '$4,000', resistance: '$4,600', analyst: 'Buy' },
    INJ: { price: '$38.20', support: '$34.00', resistance: '$42.00', analyst: 'Buy' },
    FET: { price: '$2.14', support: '$1.90', resistance: '$2.40', analyst: 'Hold' },
    DOGE: { price: '$0.18', support: '$0.16', resistance: '$0.21', analyst: 'Sell' },
    XRP: { price: '$0.62', support: '$0.58', resistance: '$0.70', analyst: 'Hold' },
    SOL: { price: '$146.80', support: '$138.00', resistance: '$155.00', analyst: 'Buy' }
  };
  for (const [coin, data] of Object.entries(cryptoData)) {
    drawLine(`${coin}: Pris ${data.price} | Support ${data.support} | Resistance ${data.resistance} | Anbefaling: ${data.analyst}`);
  }

  drawLine('');
  drawLine('Markedsindikatorer:');
  const sentiment = {
    'Fear & Greed Index': '61 (Greed)',
    'VIX Index': '16.39 (Low volatility)',
    'BTC Dominance': '59.8%',
    'Market Outlook': 'Positive momentum in altcoins. Institutional interest rising post ETF approvals. Watch for regulatory updates.'
  };
  for (const [key, value] of Object.entries(sentiment)) {
    drawLine(`${key}: ${value}`);
  }

  const pdfBytes = await pdfDoc.save();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.pdf');
  res.status(200).send(Buffer.from(pdfBytes));
}
