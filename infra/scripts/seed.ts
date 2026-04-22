/**
 * @CLAUDE_CONTEXT
 * Package : infra
 * File    : scripts/seed.ts
 * Role    : Seeds development database with sample data for local testing.
 *           DO NOT run against production database.
 *           Creates: 1 tenant, 1 product, inventory, 1 buyer.
 */
import { db, pgClient, tenants, products, inventory, buyers } from '@lynkbot/db';

async function main() {
  console.log('🌱 Seeding development database...');

  // Tenant
  const [tenant] = await db.insert(tenants).values({
    lynkUserId: 'dev-user-001',
    storeName: 'Toko Buku Dev',
    watiAccountStatus: 'active',
    originCityId: '501',
    originCityName: 'Jakarta Pusat',
    subscriptionTier: 'growth',
    displayPhoneNumber: '+6281234500000',
    metaBusinessId: '123456789012345',
  }).returning();
  console.log('✅ Tenant created:', tenant.id);

  // Product
  const [product] = await db.insert(products).values({
    tenantId: tenant.id,
    name: 'Atomic Habits — Edisi Bahasa Indonesia',
    sku: 'BOOK-001',
    description: 'Buku panduan perubahan kebiasaan kecil untuk hasil luar biasa.',
    tagline: 'Perubahan kecil, hasil luar biasa.',
    priceIdr: 150000,
    weightGrams: 250,
    dimensionsCm: { l: 21, w: 14, h: 2 },
    knowledgeStatus: 'pending',
    isActive: true,
  }).returning();
  console.log('✅ Product created:', product.id);

  // Inventory
  await db.insert(inventory).values({
    productId: product.id,
    tenantId: tenant.id,
    quantityAvailable: 100,
    quantityReserved: 0,
    quantitySold: 0,
    lowStockThreshold: 10,
  });
  console.log('✅ Inventory created: 100 units');

  // Buyer
  const [buyer] = await db.insert(buyers).values({
    tenantId: tenant.id,
    waId: '6281234567890',
    name: 'Test Buyer',
    language: 'id',
  }).returning();
  console.log('✅ Buyer created:', buyer.id);

  console.log('\n🎉 Seed complete!');
  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`Product ID: ${product.id}`);
  console.log('Webhook test URL: POST /webhooks/wati/' + tenant.id);

  await pgClient.end();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
