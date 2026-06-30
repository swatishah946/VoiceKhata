import fetch from 'node-fetch';

const PROMPT_INSTRUCTIONS = `
    You are an intelligent AI billing and ledger assistant for a Kota stone business.
    
    TASK: Extract structured transaction details from the following Hinglish text or voice transcription.
    
    CRITICAL RULES:
    1. Determine the TRANSACTION TYPE. It can be:
       - "dispatch": Selling stone to a customer/party.
       - "payment": Receiving money from a customer or paying a supplier.
       - "worker_advance": Giving an advance payment to a laborer/worker (e.g., cutter, loader).
       - "freight_payment": Paying a transporter/truck driver for freight.
    2. Based on the type, extract the relevant names: party_name, worker_name, or transporter_name.
    3. For "dispatch", extract: stone_type, pieces_count, sqft_quantity, unit_rate.
    4. Also extract these charges if mentioned: freight_charge (bhada), loading_charge (loading), packing_charge (packing), and tax_percentage (e.g., 5 for 5% tax or GST).
    5. For payments/advances, extract the "amount".
    6. ALWAYS include a confidence_level (0 to 1) for your overall extraction.
    7. Return ONLY valid JSON.
    
    RESPONSE FORMAT:
    {
      "transaction_type": "dispatch | payment | worker_advance | freight_payment",
      "party_name": "...",
      "worker_name": "...",
      "transporter_name": "...",
      "stone_type": "...",
      "pieces_count": 0,
      "sqft_quantity": 0,
      "unit_rate": 0,
      "amount": 0,
      "freight_charge": 0,
      "loading_charge": 0,
      "packing_charge": 0,
      "tax_percentage": 0,
      "confidence_level": 0.95
    }
`;

export async function extractTransactionDetails(transcribedText: string) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
  const apiKey = process.env.GEMINI_API_KEY || '';

  const headers: any = { 
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey
  };

  const payload = {
    contents: [
      {
        parts: [
          { text: PROMPT_INSTRUCTIONS },
          { text: `INPUT TEXT: "${transcribedText}"` }
        ]
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Gemini API Error [${response.status}]: ${await response.text()}`);
    }

    const data: any = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    
    // Clean up any potential markdown block backticks that Gemini might add
    const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonString);
  } catch (error) {
    console.error('Error in Gemini extraction:', error);
    throw error;
  }
}

export async function extractTransactionDetailsFromImage(base64Image: string, mimeType: string) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
  const apiKey = process.env.GEMINI_API_KEY || '';

  const headers: any = { 
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey
  };

  const payload = {
    contents: [
      {
        parts: [
          { text: PROMPT_INSTRUCTIONS },
          { text: `Please extract the billing details from the attached handwritten/printed bill.` },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Gemini Vision API Error [${response.status}]: ${await response.text()}`);
    }

    const data: any = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    
    const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonString);
  } catch (error) {
    console.error('Error in Gemini Vision extraction:', error);
    throw error;
  }
}

