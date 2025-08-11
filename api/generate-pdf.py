import io
from datetime import datetime
import fitz  # PyMuPDF
from flask import Flask, Response

app = Flask(__name__)

@app.route("/api/generate-pdf", methods=["GET"])
def generate_pdf():
    # Simulerte kryptodata
    crypto_data = {
        "BTC": {"price": "$118,450", "support": "$114,000", "resistance": "$122,000", "analyst": "Hold"},
        "ETH": {"price": "$4,320", "support": "$4,000", "resistance": "$4,600", "analyst": "Buy"},
        "INJ": {"price": "$38.20", "support": "$34.00", "resistance": "$42.00", "analyst": "Buy"},
        "FET": {"price": "$2.14", "support": "$1.90", "resistance": "$2.40", "analyst": "Hold"},
        "DOGE": {"price": "$0.18", "support": "$0.16", "resistance": "$0.21", "analyst": "Sell"},
        "XRP": {"price": "$0.62", "support": "$0.58", "resistance": "$0.70", "analyst": "Hold"},
        "SOL": {"price": "$146.80", "support": "$138.00", "resistance": "$155.00", "analyst": "Buy"}
    }

    # Sentimentdata
    sentiment = {
        "Fear & Greed Index": "61 (Greed)",
        "VIX Index": "16.39 (Low volatility)",
        "BTC Dominance": "59.8%",
        "Market Outlook": "Positive momentum in altcoins. Institutional interest rising post ETF approvals. Watch for regulatory updates."
    }

    # Lag PDF
    buffer = io.BytesIO()
    doc = fitz.open()

    page = doc.new_page()
    title = f"Daglig Kryptomarked Rapport – {datetime.utcnow().strftime('%Y-%m-%d')}"
    page.insert_text((50, 50), title, fontsize=16, fontname="helv", fill=(0, 0, 0))

    y = 100
    page.insert_text((50, y), "Kryptopriser og Analyse:", fontsize=12)
    y += 20
    for coin, data in crypto_data.items():
        line = f"{coin}: Pris {data['price']} | Support {data['support']} | Resistance {data['resistance']} | Anbefaling: {data['analyst']}"
        page.insert_text((50, y), line, fontsize=10)
        y += 15

    y += 20
    page.insert_text((50, y), "Markedsindikatorer:", fontsize=12)
    y += 20
    for key, value in sentiment.items():
        page.insert_text((50, y), f"{key}: {value}", fontsize=10)
        y += 15

    doc.save(buffer)
    buffer.seek(0)

    return Response(buffer.read(), mimetype="application/pdf", headers={"Content-Disposition": "inline; filename=DagligKryptoRapport.pdf"})
