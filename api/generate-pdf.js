export default function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];
  const content = `Daglig Kryptomarked Rapport – ${today}\n\nBTC: $118,450\nETH: $4,320\nINJ: $38.20\nFET: $2.14\nDOGE: $0.18\nXRP: $0.62\nSOL: $146.80\n\nFear & Greed Index: 61 (Greed)\nVIX Index: 16.39\nBTC Dominance: 59.8%\nMarket Outlook: Positive momentum in altcoins. Institutional interest rising post ETF approvals. Watch for regulatory updates.`;

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.txt');
  res.status(200).send(content);
}
