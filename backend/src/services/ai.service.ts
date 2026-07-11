import fetch from 'node-fetch';

const PROMPT_INSTRUCTIONS = `
    You are an intelligent AI billing and ledger assistant for a Kota stone business.
    
    TASK: Determine the INTENT of the message and extract structured details from the following Hinglish text or voice transcription.
    
    CRITICAL RULES:
    1. First, determine the INTENT. It must be one of:
       - "TRANSACTION": The user is recording a sale, dispatch, payment, or advance.
       - "UPDATE_PRICE": The user wants to change the price of a stone (e.g. "2x1.5 ka rate 32 kar do").
       - "GET_PDF": The user is asking to send the general price list or PDF (e.g. "price list bhej do").
       - "GET_KHATA": The user is asking to see the ledger/account statement for a specific person (e.g. "Ramesh ka khata bhejo", "Ambika textile ka hisab bhejo").
       
    2. For "TRANSACTION" intent:
       - Determine transaction_type: "dispatch", "payment", "worker_advance", or "freight_payment".
       - Extract party_name, worker_name, transporter_name as appropriate.
       - For "dispatch": extract stone_type, pieces_count, sqft_quantity, unit_rate, freight_charge, loading_charge, packing_charge, tax_percentage.
       - For payments: extract amount.

    3. For "UPDATE_PRICE" intent:
       - Extract updated_stone_type (e.g. "2x1½" or "3x2") and updated_rate (the new numeric price).

    4. For "GET_KHATA" intent:
       - Extract the person_name (the name of the party or worker they are asking about).

    5. ALWAYS include a confidence_level (0 to 1) for your overall extraction.
    6. Return ONLY valid JSON.
    
    RESPONSE FORMAT:
    {
      "intent": "TRANSACTION | UPDATE_PRICE | GET_PDF | GET_KHATA",
      "transaction_type": "dispatch | payment | worker_advance | freight_payment | null",
      "party_name": "...",
      "worker_name": "...",
      "transporter_name": "...",
      "person_name": "...",
      "stone_type": "...",
      "pieces_count": 0,
      "sqft_quantity": 0,
      "unit_rate": 0,
      "amount": 0,
      "freight_charge": 0,
      "loading_charge": 0,
      "packing_charge": 0,
      "tax_percentage": 0,
      "updated_stone_type": "...",
      "updated_rate": 0,
      "confidence_level": 0.95
    }
`;

export async function extractTransactionDetails(transcribedText: string) {
  const primaryUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
  const fallbackUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
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

  async function tryExtract(url: string, modelName: string) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      const err = new Error(`Gemini API Error [${response.status}]: ${errText}`);
      (err as any).status = response.status;
      throw err;
    }

    const data: any = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonString);
  }

  try {
    console.log(`🤖 Calling Gemini 3.5 Flash...`);
    return await tryExtract(primaryUrl, 'gemini-3.5-flash');
  } catch (error: any) {
    const status = error.status || (error.message && error.message.match(/\[(\d+)\]/)?.[1]);
    
    if (status == 503 || status == 429) {
      console.log(`⚠️ Gemini rate limited (${status}), will retry with backoff...`);
      throw error; // Throw to trigger BullMQ retry
    }

    console.log(`🔄 Gemini 3.5 Flash had error, trying Gemini 1.5 Flash...`);
    try {
      return await tryExtract(fallbackUrl, 'gemini-1.5-flash-latest');
    } catch (fallbackError: any) {
      const fallbackStatus = fallbackError.status || (fallbackError.message && fallbackError.message.match(/\[(\d+)\]/)?.[1]);
      if (fallbackStatus == 503 || fallbackStatus == 429) {
        throw fallbackError; // Throw to trigger BullMQ retry
      }
      throw new Error(`Both models failed: ${fallbackError.message}`);
    }
  }
}

export async function extractTransactionDetailsFromImage(base64Image: string, mimeType: string) {
  const primaryUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
  const fallbackUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
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

  async function tryExtract(url: string, modelName: string) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      const err = new Error(`Gemini Vision API Error [${response.status}]: ${errText}`);
      (err as any).status = response.status;
      throw err;
    }

    const data: any = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonString);
  }

  try {
    console.log(`📸 Calling Gemini Vision 3.5 Flash...`);
    return await tryExtract(primaryUrl, 'gemini-3.5-flash');
  } catch (error: any) {
    const status = error.status || (error.message && error.message.match(/\[(\d+)\]/)?.[1]);
    
    if (status == 503 || status == 429) {
      console.log(`⚠️ Gemini Vision rate limited (${status}), will retry with backoff...`);
      throw error; // Throw to trigger BullMQ retry
    }

    console.log(`🔄 Gemini Vision 3.5 Flash had error, trying Gemini 1.5 Flash...`);
    try {
      return await tryExtract(fallbackUrl, 'gemini-1.5-flash-latest');
    } catch (fallbackError: any) {
      const fallbackStatus = fallbackError.status || (fallbackError.message && fallbackError.message.match(/\[(\d+)\]/)?.[1]);
      if (fallbackStatus == 503 || fallbackStatus == 429) {
        throw fallbackError; // Throw to trigger BullMQ retry
      }
      throw new Error(`Both Vision models failed: ${fallbackError.message}`);
    }
  }
}
