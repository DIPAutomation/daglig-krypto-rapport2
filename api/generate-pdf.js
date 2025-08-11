import { createServer } from 'http';
import { writeFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const content = `
Daglig Kryptomarked Rapport – ${today}

Kryptopriser og Analyse:
BTC: Pris $118,450 | Support $114,000 | Resistance $122,000 | Anbefaling: Hold
ETH: Pris $4,320 | Support $4,000 | Resistance $4,600 | Anbefaling: Buy
INJ: Pris $38.20 | Support $34.00 | Resistance $42.00 | Anbefaling: Buy
FET: Pris $2.14 | Support $1.90 | Resistance $2.40 | Anbefaling: Hold
DOGE: Pris $0.18 | Support $0.16 | Resistance $0.21 | Anbefaling: Sell
XRP: Pris $0.62 | Support $0.58 | Resistance $0.70 | Anbefaling: Hold
SOL: Pris $146.80 | Support $138.00 | Resistance $155.00 | Anbefaling: Buy

Markedsindikatorer:
Fear & Greed Index: 61 (Greed)
VIX Index: 16.39 (Low volatility)
BTC Dominance: 59.8%
Market Outlook: Positive momentum in altcoins. Institutional interest rising post ETF approvals. Watch for regulatory updates.
`;

  const filePath = join('/tmp', 'DagligKryptoRapport.txt');
  writeFileSync(filePath, content);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.txt');
  res.status(200).send(content);
}
