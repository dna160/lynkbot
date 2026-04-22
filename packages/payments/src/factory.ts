/**
 * @CLAUDE_CONTEXT
 * Package : packages/payments
 * File    : src/factory.ts
 * Role    : Returns IPaymentProvider instance based on PAYMENT_PROVIDER env var. Singleton.
 * Exports : getPaymentProvider(), resetPaymentProvider()
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/wati, apps/*
 */
import type { IPaymentProvider } from './IPaymentProvider';
import { MidtransProvider } from './MidtransProvider';
import { XenditProvider } from './XenditProvider';

let instance: IPaymentProvider | null = null;

export function getPaymentProvider(): IPaymentProvider {
  if (!instance) {
    const provider = process.env.PAYMENT_PROVIDER ?? 'midtrans';
    switch (provider) {
      case 'midtrans':
        instance = new MidtransProvider();
        break;
      case 'xendit':
        instance = new XenditProvider();
        break;
      default:
        throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}. Valid values: midtrans, xendit`);
    }
  }
  return instance;
}

export function resetPaymentProvider(): void {
  instance = null;
}
