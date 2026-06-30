import pool from './src/db/index';

async function seedPrices() {
  console.log('🌱 Seeding Price List into Database...');
  
  const client = await pool.connect();
  try {
    // 1. Create the table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_list (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        stone_type VARCHAR(100) NOT NULL,
        rate_per_sqft DECIMAL(12, 2) NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, stone_type)
      );
    `);
    console.log('✅ Created price_list table.');

    // 2. Insert default prices
    const DEFAULT_ORG = '00000000-0000-0000-0000-000000000000';
    
    const prices = [
      { stone_type: '2x1½', rate: 31.50 },
      { stone_type: '23"x17"', rate: 31.50 },
      { stone_type: '2½x2', rate: 33.00 },
      { stone_type: '3x2', rate: 37.00 },
      { stone_type: '4x2', rate: 40.00 },
      { stone_type: '5x2', rate: 47.00 },
      { stone_type: '6x2', rate: 48.00 },
      { stone_type: '22"x16"', rate: 27.00 },
      { stone_type: '22"x22"', rate: 29.00 },
      { stone_type: '3½x2', rate: 40.00 },
      { stone_type: '4½x2', rate: 40.00 },
      { stone_type: '6½x2', rate: 56.50 },
      { stone_type: '4x2½', rate: 56.00 },
      { stone_type: '5x2½', rate: 59.00 },
      { stone_type: '6x2½', rate: 62.00 }
    ];

    for (const p of prices) {
      await client.query(`
        INSERT INTO price_list (organization_id, stone_type, rate_per_sqft)
        VALUES ($1, $2, $3)
        ON CONFLICT (organization_id, stone_type) 
        DO UPDATE SET rate_per_sqft = EXCLUDED.rate_per_sqft, updated_at = CURRENT_TIMESTAMP
      `, [DEFAULT_ORG, p.stone_type, p.rate]);
    }
    
    console.log(`✅ Seeded ${prices.length} prices successfully.`);
  } catch (error) {
    console.error('❌ Failed to seed prices:', error);
  } finally {
    client.release();
    pool.end();
  }
}

seedPrices();
