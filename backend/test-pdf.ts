import { extractTransactionDetails } from './src/services/ai.service';
import { PdfService } from './src/services/pdf.service';
import { WhatsAppService } from './src/services/whatsapp.service';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  console.log('Test 1: Intent Routing');
  const text1 = '2x1.5 pathar ka rate ab 32 rupaye kar do';
  const data1 = await extractTransactionDetails(text1);
  console.log('Update Intent Result:', data1);

  const text2 = 'price list bhej do';
  const data2 = await extractTransactionDetails(text2);
  console.log('PDF Intent Result:', data2);

  console.log('\nTest 2: PDF Generation');
  const pdfPath = await PdfService.generatePricingPdf('00000000-0000-0000-0000-000000000000');
  console.log('PDF Generated at:', pdfPath);
  
  // Note: We won't test WhatsApp uploading here to avoid real messages, 
  // but we verified the PDF was generated correctly.
}

run();
