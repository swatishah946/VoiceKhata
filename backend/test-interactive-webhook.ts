import fetch from 'node-fetch';
import pool from './src/db/index';

async function testInteractiveWebhook() {
  console.log('🔍 Finding a pending transaction in the database...');
  
  const client = await pool.connect();
  let pendingTx;
  try {
    const res = await client.query(`SELECT id FROM transactions WHERE status = 'pending_confirmation' LIMIT 1`);
    if (res.rows.length === 0) {
      console.log('❌ No pending transactions found. Run test-webhook.ts first!');
      return;
    }
    pendingTx = res.rows[0];
  } finally {
    client.release();
  }

  const transactionId = pendingTx.id;
  console.log(`✅ Found pending transaction: ${transactionId}`);
  console.log('🚀 Simulating User Clicking the "✅ Sahi Hai" Button on WhatsApp...\n');

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
                  id: `wamid.interactive.${Date.now()}`,
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: {
                      id: `CONFIRM_${transactionId}`,
                      title: "✅ Sahi Hai"
                    }
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
    console.log('\n⏳ Check the main server terminal now. The Worker should run the SQL transaction to update the Party Balances!');
    
  } catch (err: any) {
    console.error(`❌ Request Failed: ${err.message}`);
  }
}

testInteractiveWebhook();
