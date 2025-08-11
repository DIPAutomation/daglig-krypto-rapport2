import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Hjelpefunksjon med timeout
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

// Funksjon for å bryte tekst i flere linjer basert på maks bredde (pixels)
function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const testLineWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testLineWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

export default async function handler(req, res) {
  try {
    const errors = [];

    // Dummydata
    let cryptoPrices = {};
    let fearGreedIndex = "N/A";
    let btcDominance = "N/A";
    let vixValue = "N/A";

    // Analytiker-tabell (dummy)
    const analystTable = {
      BTC: { Buy: 3, Hold: 3, Sell: 1 },
      ETH: { Buy: 4, Hold: 2, Sell: 1 },
      INJ: { Buy: 5, Hold: 1, Sell: 1 },
      FET: { Buy: 2, Hold: 4, Sell: 1 },
      DOGE: { Buy: 1, Hold: 3, Sell: 3 },
      XRP: { Buy: 2, Hold: 4, Sell: 1 },
      SOL: { Buy: 4, Hold: 2, Sell: 1 }
    };

    // API-kall parallelt med fallback
    const coins = ['bitcoin', 'ethereum', 'injective-protocol', 'fetch-ai', 'dogecoin', 'ripple', 'solana'];

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
            fearGreedIndex = `${d.data[0].value} (${d.data[0].value_classification})`;
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
            btcDominance = `${d.data.market_cap_percentage.btc.toFixed(2)}%`;
          }
        } catch (err) {
          errors.push(`BTC Dominance-feil: ${err.message}`);
        }
      })(),
      (async () => {
        try {
          const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/^VIX');
          const d = await r.json();
          const val = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (val != null) vixValue = val.toFixed(2);
        } catch (err) {
          errors.push(`VIX-feil: ${err.message}`);
        }
      })()
    ]);

    // Bygg PDF
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 12;
    const marginX = 50;
    const maxWidth = 595 - marginX * 2; // maks bredde innenfor marger
    let y = 780;
    const lineHeight = 18;

    // Tegn tekst med wrapping og paginering
    function drawWrappedText(text, size = fontSize, color = rgb(0, 0, 0)) {
      const lines = wrapText(text, font, size, maxWidth);
      for (const line of lines) {
        if (y < 40) { // ny side
          page = pdfDoc.addPage([595, 842]);
          y = 800;
        }
        page.drawText(line, { x: marginX, y, size, font, color });
        y -= lineHeight;
      }
    }

    drawWrappedText(`Daglig Kryptomarked Rapport – ${new Date().toISOString().split('T')[0]}`, 14);
    drawWrappedText('');

    // Kryptopriser
    drawWrappedText('Kryptopriser og Analyse:');
    coins.forEach((id) => {
      const symbol = id === 'bitcoin' ? 'BTC' :
                     id === 'ethereum' ? 'ETH' :
                     id === 'injective-protocol' ? 'INJ' :
                     id === 'fetch-ai' ? 'FET' :
                     id === 'dogecoin' ? 'DOGE' :
                     id === 'ripple' ? 'XRP' :
                     id === 'solana' ? 'SOL' : id;
      const price = cryptoPrices[id]?.usd != null
        ? `$${cryptoPrices[id].usd.toLocaleString()}`
        : "N/A";
      const change = cryptoPrices[id]?.usd_24h_change != null
        ? `${cryptoPrices[id].usd_24h_change.toFixed(2)}%`
        : "N/A";
      drawWrappedText(`${symbol}: Pris ${price} | 24t Endring: ${change}`);
    });

    drawWrappedText('');
    drawWrappedText('Markedsindikatorer:');
    drawWrappedText(`Fear & Greed Index: ${fearGreedIndex}`);
    drawWrappedText(`VIX Index: ${vixValue}`);
    drawWrappedText(`BTC Dominance: ${btcDominance}`);

    // Tillegg: Forklaring og tolkning av indikatorer
    drawWrappedText('');
    drawWrappedText('Tolkning av Markedsindikatorer:');
    drawWrappedText('Fear & Greed Index reflekterer markedssentiment. Høye verdier (70+) tyder på grådighet og mulig topp før korreksjon.');
    drawWrappedText('Lave verdier (30-) signaliserer frykt og kan være gode kjøpsmuligheter i kryptomarkedet.');
    drawWrappedText('VIX, også kalt "fryktindeksen" for aksjemarkedet, måler forventet volatilitet. Høy VIX kan trekke kapital ut av risikofylte aktiva som krypto.');
    drawWrappedText('Når VIX stiger, øker risikoaversjonen, noe som ofte gir lavere kryptopriser på kort sikt.');
    drawWrappedText('');
    drawWrappedText('BTC Dominans beskriver hvor stor andel av total kryptomarkedsverdi Bitcoin utgjør.');
    drawWrappedText('Økende dominans kan tyde på at kapital trekkes ut av altcoins og samles i Bitcoin, ofte i usikre tider.');
    drawWrappedText('Synkende dominans indikerer økt interesse for altcoins, typisk i bull-markeder når risikoappetitten øker.');
    drawWrappedText('Dette gir investorer hint om når man bør justere allokering mellom BTC og altcoins.');

    // Analytikertabell
    drawWrappedText('');
    drawWrappedText('Analytikeranbefalinger pr. valuta:');
    Object.entries(analystTable).forEach(([symbol, counts]) => {
      const total = counts.Buy + counts.Hold + counts.Sell;
      const maxType = Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a)[0];
      const maxPercent = ((counts[maxType] / total) * 100).toFixed(1);
      drawWrappedText(`${symbol}: analyserte ${total}; Kjøp ${counts.Buy}; Hold ${counts.Hold}; Selg ${counts.Sell}; Flest anbefaler ${maxType.toUpperCase()} (${maxPercent}%)`);
    });

    // Makroøkonomisk analyse
    drawWrappedText('');
    drawWrappedText('Makroøkonomisk Situasjon og Kryptomarkedet:');
    drawWrappedText('Globale renteendringer, inflasjon og regulatoriske nyheter påvirker kryptomarkedet sterkt.');
    drawWrappedText('Stigende renter øker alternativkostnaden ved å holde krypto, og kan føre til kapitalflukt til sikrere aktiva.');
    drawWrappedText('Regulatorisk usikkerhet og lovendringer kan skape volatilitet og raske markedsreaksjoner.');
    drawWrappedText('Institusjonell interesse, som ETF-godkjenninger, støtter langsiktig vekst i kryptoindustrien.');
    drawWrappedText('Investorer bør følge med på makrotrender for å justere risikoprofilen i porteføljen.');

    // Fremtidsanalyse
    drawWrappedText('');
    drawWrappedText('Generell Fremtidsanalyse:');
    drawWrappedText('ETF-godkjenninger gir økt institusjonell interesse.');
    drawWrappedText('Lovforslag om kryptoregulering kan gi store markedsbevegelser.');
    drawWrappedText('Altcoins viser styrke, men avhenger av makroøkonomi og likviditet.');
    drawWrappedText('Vær obs på volatilitet rundt store hendelser og nyhetsutslipp.');

    // API-feil
    if (errors.length > 0) {
      drawWrappedText('');
      drawWrappedText('Feil ved datainnhenting:', 12, rgb(1, 0, 0));
      errors.forEach(err => drawWrappedText(`- ${err}`, 10, rgb(1, 0, 0)));
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=DagligKryptoRapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (err) {
    // Siste failsafe
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText(`Rapportgenerering feilet: ${err.message}`, { x: 50, y: 800, size: 12, font, color: rgb(1, 0, 0) });
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=Feilrapport.pdf');
    res.status(200).send(Buffer.from(pdfBytes));
  }
}
