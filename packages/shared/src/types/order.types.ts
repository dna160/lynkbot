/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/types/order.types.ts
 * Role    : Order and shipment TypeScript types and enums
 * Imports : nothing (zero deps)
 * Exports : OrderStatus, Order, Shipment, ShipmentStatus
 * DO NOT  : Import from @lynkbot/* or apps/*
 */

export enum OrderStatus {
  PENDING_PAYMENT = 'pending_payment',
  PAYMENT_CONFIRMED = 'payment_confirmed',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum ShipmentStatus {
  PENDING = 'pending',
  IN_TRANSIT = 'in_transit',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  EXCEPTION = 'exception',
  RETURNED = 'returned',
}

export interface Order {
  id: string;
  orderCode: string;
  tenantId: string;
  buyerId: string;
  conversationId: string | null;
  productId: string;
  quantity: number;
  unitPriceIdr: number;
  shippingCostIdr: number;
  totalAmountIdr: number;
  status: OrderStatus;
  shippingAddress: ShippingAddress;
  courierCode: string | null;
  courierService: string | null;
  paymentId: string | null;
  paymentMethod: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShippingAddress {
  streetAddress: string;
  kelurahan: string;
  kecamatan: string;
  city: string;
  province: string;
  postalCode: string;
  rajaongkirCityId: string;
  source: 'location_share' | 'text_input';
}

export interface Shipment {
  id: string;
  orderId: string;
  tenantId: string;
  resiNumber: string;
  courierCode: string;
  courierName: string | null;
  currentStatus: ShipmentStatus;
  estimatedDelivery: Date | null;
  deliveredAt: Date | null;
  lastPolledAt: Date | null;
  trackingHistory: TrackingEvent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TrackingEvent {
  status: string;
  description: string;
  timestamp: string;
}
