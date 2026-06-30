import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

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
    3. For "dispatch", extract: stone_type (e.g., "2x1½ Polish"), pieces_count, sqft_quantity, unit_rate, freight_charge (if mentioned), and advance_paid (if mentioned).
    4. For payments/advances, extract the "amount".
    5. ALWAYS include a confidence_level (0 to 1) for your overall extraction.
    6. Return ONLY valid JSON (no markdown formatting, no explanations).
    
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
      "confidence_level": 0.95
    }
`;

export async function extractTransactionDetails(transcribedText: string) {
  try {
    const result = await model.generateContent([PROMPT_INSTRUCTIONS, `INPUT TEXT: "${transcribedText}"`]);
    const responseText = result.response.text();

    // Clean up any potential markdown block backticks that Gemini might add
    const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonString);
  } catch (error) {
    console.error('Error in Gemini extraction:', error);
    throw error;
  }
}
