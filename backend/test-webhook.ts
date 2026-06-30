import fetch from 'node-fetch';

async function testWebhook() {
  console.log('🚀 Simulating Incoming WhatsApp Webhook Request...\n');

  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "919999999999" }],
              messages: [
                {
                  id: `wamid.mock.${Date.now()}`,
                  type: "text",
                  text: {
                    body: "Sidhhi Stone ko 5000 sqft 2x1½ Polish bhej diya hai, rate 25 rupaye, loading 1500 laga, packing 500, tax 5, freight 2000 laga."
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch('http://localhost:3000/webhook/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log(`✅ Webhook Response Status: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.log(`✅ Webhook Response Body: ${text}`);

    console.log('\n⏳ Check the main server terminal now. The Queue should pick it up, extract via Gemini, run the Ledger Math (including the 5% Tax and Loading), and save it to the DB!');
    
  } catch (err: any) {
    console.error(`❌ Webhook Request Failed. Is the Express server running on port 3000? Error: ${err.message}`);
  }
}

testWebhook();
