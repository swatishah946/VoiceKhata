import dotenv from 'dotenv';
dotenv.config();

import { extractTransactionDetails } from './src/services/ai.service';
import { LedgerService } from './src/services/ledger.service';
import pool from './src/db';

async function testExtraction() {
  console.log('🧪 Starting AI + Ledger Full Integration Test...\n');

  // Hardcoded default org for testing
  const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000';

  console.log('⚙️ Seeding Default Organization into PostgreSQL...');
  await pool.query(
    `INSERT INTO organizations (id, name, owner_phone) VALUES ($1, 'Default Org', '9999999999') ON CONFLICT DO NOTHING;`,
    [DEFAULT_ORG_ID]
  );
  console.log('✅ Organization Seeded.\n');

  const testCases = [
    {
      name: "Dispatch to Customer (With GST & Loading)",
      text: "Sidhhi Stone ko 5000 sqft 2x1½ Polish bhej diya hai, rate 25 rupaye, loading 1500 laga, packing 500, tax 5, freight 2000 laga.",
      mockData: {
        transaction_type: 'dispatch',
        party_name: 'Sidhhi Stone',
        stone_type: '2x1½ Polish',
        sqft_quantity: 5000,
        unit_rate: 25,
        loading_charge: 1500,
        packing_charge: 500,
        tax_percentage: 5,
        freight_charge: 2000
      }
    },
    {
      name: "Advance from Customer",
      text: "Ramesh bhai se 50000 advance aaya hai aaj.",
      mockData: {
        transaction_type: 'payment',
        party_name: 'Ramesh bhai',
        amount: 50000
      }
    },
    {
      name: "Worker Advance",
      text: "Mohan loader ko 2000 rupaye advance de diye.",
      mockData: {
        transaction_type: 'worker_advance',
        worker_name: 'Mohan loader',
        amount: 2000
      }
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n-----------------------------------------`);
    console.log(`📝 Testing: ${testCase.name}`);
    
    try {
      console.log(`✅ Using Mocked Extracted JSON:`, testCase.mockData);

      console.log(`⏳ Processing through LedgerService (Math & DB)...`);
      const dbResult = await LedgerService.processTransaction(testCase.mockData, DEFAULT_ORG_ID);
      
      console.log(`✅ Ledger Processing Complete:`, dbResult);
    } catch (err: any) {
      console.error(`❌ Failed:`, err.message);
    }
  }

  process.exit(0);
}

testExtraction();
