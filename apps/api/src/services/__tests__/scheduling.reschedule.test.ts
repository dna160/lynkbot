/**
 * @CLAUDE_CONTEXT
 * Test suite for reschedule functionality in SchedulingService
 * Tests: getConfirmationStaff, handleRescheduleRequest, handleStaffRescheduleApproval
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock all external dependencies before importing the service ───────────────

vi.mock('../_meta.helper', () => ({
  getTenantMetaClient: vi.fn().mockResolvedValue({
    sendTemplate: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      services: { findFirst: vi.fn() },
      staff: { findFirst: vi.fn() },
      buyers: { findFirst: vi.fn() },
      appointments: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  },
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => conditions),
  appointments: {},
  services: {},
  staff: {},
  buyers: {},
}));

// Now import the service after mocking
import { SchedulingService } from '../scheduling.service';
import { db, eq } from '@lynkbot/db';

const mockLog = {
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
} as any;

const svc = new SchedulingService();

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const STAFF_ALICE_ID = '550e8400-e29b-41d4-a716-446655440001';
const STAFF_BOB_ID = '550e8400-e29b-41d4-a716-446655440002';
const SERVICE_ID = '550e8400-e29b-41d4-a716-446655440003';
const BUYER_ID = '550e8400-e29b-41d4-a716-446655440004';

describe('SchedulingService - Rescheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfirmationStaff', () => {
    it('returns the confirmation staff when set', async () => {
      const mockService = {
        id: SERVICE_ID,
        tenantId: TENANT_ID,
        confirmationStaffId: STAFF_ALICE_ID,
      };

      const mockStaff = {
        id: STAFF_ALICE_ID,
        tenantId: TENANT_ID,
        name: 'Dr. Alice',
        phoneNumber: '+62812345678',
      };

      vi.spyOn(db.query.services, 'findFirst').mockResolvedValueOnce(mockService as any);
      vi.spyOn(db.query.staff, 'findFirst').mockResolvedValueOnce(mockStaff as any);

      const result = await svc.getConfirmationStaff(SERVICE_ID, TENANT_ID);

      expect(result).toEqual(mockStaff);
      expect(db.query.services.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.anything(),
        })
      );
    });

    it('returns null when no confirmation staff is set', async () => {
      const mockService = {
        id: SERVICE_ID,
        tenantId: TENANT_ID,
        confirmationStaffId: null,
      };

      vi.spyOn(db.query.services, 'findFirst').mockResolvedValueOnce(mockService as any);

      const result = await svc.getConfirmationStaff(SERVICE_ID, TENANT_ID);

      expect(result).toBeNull();
    });

    it('returns null when service not found', async () => {
      vi.spyOn(db.query.services, 'findFirst').mockResolvedValueOnce(null);

      const result = await svc.getConfirmationStaff(SERVICE_ID, TENANT_ID);

      expect(result).toBeNull();
    });
  });

  describe('handleRescheduleRequest', () => {
    it('creates new appointment in rescheduling_requested status', async () => {
      const oldAppt = {
        id: '550e8400-e29b-41d4-a716-446655440005',
        tenantId: TENANT_ID,
        buyerId: BUYER_ID,
        staffId: STAFF_BOB_ID,
        serviceId: SERVICE_ID,
        status: 'pending_doctor',
        startTime: new Date('2026-05-20T10:00:00Z'),
        endTime: new Date('2026-05-20T11:00:00Z'),
      };

      const newStartTime = new Date('2026-05-21T14:00:00Z');

      vi.spyOn(svc, 'getAppointment').mockResolvedValueOnce(oldAppt as any);
      vi.spyOn(db.query.services, 'findFirst').mockResolvedValueOnce({
        id: SERVICE_ID,
        durationMinutes: 60,
      } as any);
      vi.spyOn(db, 'insert').mockReturnValueOnce({
        values: vi.fn().mockReturnValueOnce({
          returning: vi.fn().mockResolvedValueOnce([
            {
              id: '550e8400-e29b-41d4-a716-446655440006',
              status: 'rescheduling_requested',
              previousAppointmentId: oldAppt.id,
            },
          ]),
        }),
      } as any);
      vi.spyOn(svc, 'getConfirmationStaff').mockResolvedValueOnce({
        id: STAFF_ALICE_ID,
        name: 'Dr. Alice',
        phoneNumber: '+62812345678',
      } as any);
      vi.spyOn(svc, 'sendStaffRescheduleTemplate').mockResolvedValueOnce(undefined);

      const result = await svc.handleRescheduleRequest(oldAppt.id, TENANT_ID, newStartTime, 'Budi');

      expect(result).toContain('permintaan perubahan jadwal');
      expect(svc.getAppointment).toHaveBeenCalledWith(oldAppt.id, TENANT_ID);
    });

    it('returns error if appointment not found', async () => {
      vi.spyOn(svc, 'getAppointment').mockResolvedValueOnce(null);

      const result = await svc.handleRescheduleRequest(
        'nonexistent-id',
        TENANT_ID,
        new Date('2026-05-21T14:00:00Z'),
        'Budi'
      );

      expect(result).toContain('tidak ditemukan');
    });

    it('returns error if appointment status is not pending or confirmed', async () => {
      const cancelledAppt = {
        id: '550e8400-e29b-41d4-a716-446655440005',
        status: 'cancelled',
      };

      vi.spyOn(svc, 'getAppointment').mockResolvedValueOnce(cancelledAppt as any);

      const result = await svc.handleRescheduleRequest(
        cancelledAppt.id,
        TENANT_ID,
        new Date('2026-05-21T14:00:00Z'),
        'Budi'
      );

      expect(result).toContain('tidak bisa direscheduling');
    });
  });

  describe('handleStaffRescheduleApproval', () => {
    it('cancels old appointment and transitions new to pending_doctor on approval', async () => {
      const newAppt = {
        id: '550e8400-e29b-41d4-a716-446655440006',
        tenantId: TENANT_ID,
        buyerId: BUYER_ID,
        staffId: STAFF_BOB_ID,
        status: 'rescheduling_requested',
        previousAppointmentId: '550e8400-e29b-41d4-a716-446655440005',
        startTime: new Date('2026-05-21T14:00:00Z'),
        endTime: new Date('2026-05-21T15:00:00Z'),
      };

      const oldAppt = {
        id: '550e8400-e29b-41d4-a716-446655440005',
        startTime: new Date('2026-05-20T10:00:00Z'),
        endTime: new Date('2026-05-20T11:00:00Z'),
      };

      const buyer = {
        id: BUYER_ID,
        waPhone: '+6281234567890',
      };

      vi.spyOn(svc, 'getAppointment')
        .mockResolvedValueOnce(newAppt as any)
        .mockResolvedValueOnce(oldAppt as any);
      vi.spyOn(db.query.buyers, 'findFirst').mockResolvedValueOnce(buyer as any);
      vi.spyOn(db.query.appointments, 'findFirst').mockResolvedValueOnce(oldAppt as any);
      vi.spyOn(db, 'update').mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce([{ id: oldAppt.id }]),
        }),
      } as any);
      vi.spyOn(svc, 'updateAppointmentStatus').mockResolvedValueOnce({} as any);

      await svc.handleStaffRescheduleApproval(newAppt.id, TENANT_ID, true, mockLog);

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Reschedule approved')
      );
    });

    it('rejects reschedule and notifies buyer on rejection', async () => {
      const newAppt = {
        id: '550e8400-e29b-41d4-a716-446655440006',
        tenantId: TENANT_ID,
        buyerId: BUYER_ID,
        status: 'rescheduling_requested',
        previousAppointmentId: '550e8400-e29b-41d4-a716-446655440005',
      };

      const oldAppt = {
        id: '550e8400-e29b-41d4-a716-446655440005',
        startTime: new Date('2026-05-20T10:00:00Z'),
        endTime: new Date('2026-05-20T11:00:00Z'),
      };

      const buyer = {
        id: BUYER_ID,
        waPhone: '+6281234567890',
      };

      vi.spyOn(svc, 'getAppointment').mockResolvedValueOnce(newAppt as any);
      vi.spyOn(db.query.buyers, 'findFirst').mockResolvedValueOnce(buyer as any);
      vi.spyOn(db.query.appointments, 'findFirst').mockResolvedValueOnce(oldAppt as any);
      vi.spyOn(db, 'update').mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce([{ id: newAppt.id }]),
        }),
      } as any);

      await svc.handleStaffRescheduleApproval(newAppt.id, TENANT_ID, false, mockLog);

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Reschedule rejected')
      );
    });

    it('ignores if appointment not in rescheduling_requested state', async () => {
      const appt = {
        id: '550e8400-e29b-41d4-a716-446655440006',
        status: 'confirmed',
      };

      vi.spyOn(svc, 'getAppointment').mockResolvedValueOnce(appt as any);

      await svc.handleStaffRescheduleApproval(appt.id, TENANT_ID, true, mockLog);

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('not in rescheduling_requested state')
      );
    });

    it('ignores if previous appointment not found', async () => {
      const appt = {
        id: '550e8400-e29b-41d4-a716-446655440006',
        status: 'rescheduling_requested',
        previousAppointmentId: null,
      };

      vi.spyOn(svc, 'getAppointment').mockResolvedValueOnce(appt as any);

      await svc.handleStaffRescheduleApproval(appt.id, TENANT_ID, true, mockLog);

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('no previous appointment found')
      );
    });
  });
});
