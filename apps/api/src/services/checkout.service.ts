/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/checkout.service.ts
 * Role    : Checkout flow: stock check → address collection → location → shipping calc → payment method.
 * Imports : @lynkbot/shared, @lynkbot/db, @lynkbot/meta
 * Exports : CheckoutService class
 * DO NOT  : Handle payment invoice creation (that's PaymentService).
 */
import { db, conversations, products, tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import type { MetaClient } from '@lynkbot/meta';
import { getTenantMetaClient } from './_meta.helper';
import { InventoryService } from './inventory.service';
import { ShippingService } from './shipping.service';
import type { CourierOption } from '@lynkbot/shared';

// Normalized inbound message shape (from Meta webhook parser)
type InboundPayload = { text?: string; caption?: string };

type ConvRow = typeof conversations.$inferSelect;
type BuyerRow = { id: string; tenantId: string; waPhone: string; displayName: string | null };

const ADDRESS_STEPS = [
  { field: 'streetAddress', prompt: 'Nama jalan & nomor rumah (contoh: Jl. Merdeka No. 10):' },
  { field: 'kelurahan', prompt: 'Kelurahan / Desa:' },
  { field: 'kecamatan', prompt: 'Kecamatan:' },
  { field: 'city', prompt: 'Kota / Kabupaten:' },
  { field: 'province', prompt: 'Provinsi & Kode Pos (contoh: Jawa Barat 40111):' },
] as const;

function extractText(payload: InboundPayload): string {
  return (payload.text ?? payload.caption ?? '').trim();
}

export class CheckoutService {
  private inventoryService = new InventoryService();
  private shippingService = new ShippingService();

  private getMetaClient(tenantId: string): Promise<MetaClient> {
    return getTenantMetaClient(tenantId);
  }

  async beginCheckout(conv: ConvRow, buyer: BuyerRow): Promise<void> {
    const { tenantId } = conv;
    if (!conv.productId) {
      const meta = await this.getMetaClient(conv.tenantId);
      await meta.sendText({
        to: buyer.waPhone,
        message: 'Produk mana yang ingin kamu beli? Ketik nama produknya ya 😊',
        isWithin24hrWindow: true,
      });
      return;
    }

    const stock = await this.inventoryService.checkStock(conv.productId);

    if (stock === 0) {
      await db.update(conversations)
        .set({ state: 'OUT_OF_STOCK', lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));

      const meta = await this.getMetaClient(conv.tenantId);
      await meta.sendText({
        to: buyer.waPhone,
        message:
          'Maaf kak, stok produk ini sedang habis 😔\n\n' +
          'Mau aku masukkan ke waitlist dan kasih tahu kalau sudah tersedia? Ketik *YA* untuk daftar.',
        isWithin24hrWindow: true,
      });
      return;
    }

    // Reserve stock
    await this.inventoryService.reserveStock(conv.productId, tenantId);

    await db.update(conversations)
      .set({ state: 'ADDRESS_COLLECTION', lastMessageAt: new Date() })
      .where(eq(conversations.id, conv.id));

    const meta = await this.getMetaClient(conv.tenantId);
    await meta.sendText({
      to: buyer.waPhone,
      message:
        'Untuk menghitung ongkir, kamu bisa share lokasi (tekan 📎 → Lokasi) ' +
        'atau ketik alamat lengkap.\n\n' +
        'Kalau mau ketik, mulai dari *nama jalan dan nomor rumah* ya:',
      isWithin24hrWindow: true,
    });
  }

  async collectAddress(conv: ConvRow, buyer: BuyerRow, payload: InboundPayload): Promise<void> {
    // Location share is handled upstream by ConversationService.handleLocationShare
    const text = extractText(payload);
    const draft = (conv.addressDraft ?? { step: 0 }) as Record<string, unknown> & { step?: number };
    const step = draft.step ?? 0;

    if (step >= ADDRESS_STEPS.length) {
      await this.presentShippingOptions(conv, buyer);
      return;
    }

    const currentStep = ADDRESS_STEPS[step];
    let updatedDraft: Record<string, unknown> = { ...draft };

    if (step === ADDRESS_STEPS.length - 1) {
      const postalMatch = text.match(/\b\d{5}\b/);
      const postalCode = postalMatch ? postalMatch[0] : '';
      const province = text.replace(/\b\d{5}\b/, '').trim();
      updatedDraft['province'] = province;
      updatedDraft['postalCode'] = postalCode;
    } else {
      updatedDraft[currentStep.field] = text;
    }

    updatedDraft['step'] = step + 1;
    updatedDraft['source'] = 'text_input';

    await db.update(conversations)
      .set({ addressDraft: updatedDraft as any, lastMessageAt: new Date() })
      .where(eq(conversations.id, conv.id));

    const meta = await this.getMetaClient(conv.tenantId);

    if (step + 1 >= ADDRESS_STEPS.length) {
      const city = (updatedDraft['city'] as string) ?? '';
      const roCity = await this.shippingService.mapCityToRajaOngkir(city);

      if (roCity) {
        updatedDraft['rajaongkirCityId'] = roCity.city_id;
        await db.update(conversations)
          .set({ addressDraft: updatedDraft as any, state: 'SHIPPING_CALC', lastMessageAt: new Date() })
          .where(eq(conversations.id, conv.id));

        const refreshed = await db.query.conversations.findFirst({ where: eq(conversations.id, conv.id) });
        if (refreshed) {
          await this.presentShippingOptions(refreshed, buyer);
        }
      } else {
        await meta.sendText({
          to: buyer.waPhone,
          message:
            `Kota *${city}* tidak ditemukan di database pengiriman. ` +
            'Bisa ketik nama kota yang lebih umum? (contoh: Jakarta, Bandung, Surabaya)',
          isWithin24hrWindow: true,
        });
      }
    } else {
      const nextStep = ADDRESS_STEPS[step + 1];
      await meta.sendText({
        to: buyer.waPhone,
        message: nextStep.prompt,
        isWithin24hrWindow: true,
      });
    }
  }

  async presentShippingOptions(conv: ConvRow, buyer: BuyerRow): Promise<void> {
    const draft = conv.addressDraft as Record<string, unknown> | null;
    const meta = await this.getMetaClient(conv.tenantId);
    if (!draft?.rajaongkirCityId) {
      await meta.sendText({
        to: buyer.waPhone,
        message: 'Belum bisa hitung ongkir — alamat belum lengkap. Ketik alamat lengkap atau share lokasi ya.',
        isWithin24hrWindow: true,
      });
      return;
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, conv.tenantId),
    }).catch(() => null);

    const originCityId = (tenant as any)?.originCityId ?? '501';
    const destinationCityId = draft.rajaongkirCityId as string;

    let weightGrams = 300;
    if (conv.productId) {
      const product = await db.query.products.findFirst({ where: eq(products.id, conv.productId) });
      if (product?.weightGrams) weightGrams = product.weightGrams;
    }

    const options = await this.shippingService.calculateShippingRates(
      originCityId,
      destinationCityId,
      weightGrams,
    );

    if (options.length === 0) {
      await meta.sendText({
        to: buyer.waPhone,
        message: 'Maaf, tidak bisa mendapatkan data ongkir saat ini. Coba lagi sebentar ya 🙏',
        isWithin24hrWindow: true,
      });
      return;
    }

    const lines = options.map((opt, i) => {
      const days = opt.etaDays === 0 ? 'same day' : `${opt.etaDays} hari`;
      return `*${i + 1}. ${opt.name} ${opt.service}*\nRp ${opt.cost.toLocaleString('id-ID')} · Est. ${days}`;
    });

    const message =
      'Pilih kurir pengiriman:\n\n' +
      lines.join('\n\n') +
      '\n\nBalas dengan angka *1*, *2*, atau *3* ya 😊';

    await db.update(conversations)
      .set({ state: 'PAYMENT_METHOD_SELECT', lastMessageAt: new Date() })
      .where(eq(conversations.id, conv.id));

    await meta.sendText({ to: buyer.waPhone, message, isWithin24hrWindow: true });
  }

  async selectPaymentMethod(conv: ConvRow, buyer: BuyerRow, payload: InboundPayload): Promise<string | null> {
    const text = extractText(payload).toLowerCase().trim();

    const draft = conv.addressDraft as Record<string, unknown> | null;
    if (!draft?.rajaongkirCityId) return null;

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, conv.tenantId),
    }).catch(() => null);

    const originCityId = (tenant as any)?.originCityId ?? '501';
    let weightGrams = 300;
    if (conv.productId) {
      const product = await db.query.products.findFirst({ where: eq(products.id, conv.productId) });
      if (product?.weightGrams) weightGrams = product.weightGrams;
    }

    const options = await this.shippingService.calculateShippingRates(
      originCityId,
      draft.rajaongkirCityId as string,
      weightGrams,
    );

    let selectedOption: CourierOption | undefined;

    const numMatch = text.match(/^[123]/);
    if (numMatch) {
      selectedOption = options[parseInt(numMatch[0], 10) - 1];
    }

    if (!selectedOption) {
      selectedOption = options.find(
        o =>
          text.includes(o.code.toLowerCase()) ||
          text.includes(o.name.toLowerCase()) ||
          text.includes(o.service.toLowerCase()),
      );
    }

    const meta = await this.getMetaClient(conv.tenantId);

    if (!selectedOption) {
      await meta.sendText({
        to: buyer.waPhone,
        message: 'Maaf, belum ngerti. Balas dengan *1*, *2*, atau *3* ya untuk pilih kurir.',
        isWithin24hrWindow: true,
      });
      return null;
    }

    await db.update(conversations)
      .set({
        selectedCourier: {
          code: selectedOption.code,
          service: selectedOption.service,
          cost: selectedOption.cost,
          etaDays: selectedOption.etaDays,
          name: selectedOption.name,
        },
        state: 'INVOICE_GENERATION',
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conv.id));

    await meta.sendText({
      to: buyer.waPhone,
      message: `Oke! Kamu pilih *${selectedOption.name} ${selectedOption.service}* (Rp ${selectedOption.cost.toLocaleString('id-ID')}). Sebentar ya, lagi buat invoice... ⏳`,
      isWithin24hrWindow: true,
    });

    return selectedOption.code;
  }
}
