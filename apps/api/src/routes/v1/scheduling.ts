/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/scheduling.ts
 * Role    : REST API for the Scheduling / Booking module.
 *
 *   Staff management  (CRUD + availability)
 *   Service management (CRUD + staff assignment)
 *   Appointment management (list, detail, status update)
 *
 * All routes are tenant-scoped via fastify.authenticate.
 * Feature-gated with requireFeature('scheduling').
 *
 * Exports : schedulingRoutes (Fastify plugin)
 * DO NOT  : Add business logic here — delegate to SchedulingService
 */
import type { FastifyPluginAsync } from 'fastify';
import { SchedulingService } from '../../services/scheduling.service';
import { requireFeature } from '../../middleware/featureGate';

const svc = new SchedulingService();

const authAndFeature = (fastify: Parameters<FastifyPluginAsync>[0]) => [
  fastify.authenticate,
  requireFeature('scheduling'),
];

export const schedulingRoutes: FastifyPluginAsync = async (fastify) => {

  // ──────────────────────────────────────────────────────────────────────────
  // Staff
  // ──────────────────────────────────────────────────────────────────────────

  /** GET /v1/scheduling/staff — list all staff for tenant */
  fastify.get('/v1/scheduling/staff', { preHandler: authAndFeature(fastify) }, async (request, reply) => {
    const { tenantId } = request.user;
    const staff = await svc.listStaff(tenantId);
    return reply.send({ staff });
  });

  /** POST /v1/scheduling/staff — create new staff member */
  fastify.post<{ Body: Record<string, unknown> }>(
    '/v1/scheduling/staff',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { name, phoneNumber, role, isActive } = request.body;

      if (!name || !phoneNumber) {
        return reply.status(400).send({ error: 'name and phoneNumber are required' });
      }

      try {
        const member = await svc.createStaff(tenantId, {
          name: name as string,
          phoneNumber: phoneNumber as string,
          role: role as string | undefined,
          isActive: isActive !== false,
        });
        return reply.status(201).send({ staff: member });
      } catch (err: unknown) {
        // Postgres unique violation — duplicate phone number for this tenant
        const pg = err as { code?: string };
        if (pg?.code === '23505') {
          return reply.status(409).send({ error: 'A staff member with this WhatsApp number already exists.' });
        }
        throw err;
      }
    },
  );

  /** PUT /v1/scheduling/staff/:id — update staff member */
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/v1/scheduling/staff/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { name, phoneNumber, role, isActive } = request.body;

      const member = await svc.updateStaff(id, tenantId, {
        name: name as string | undefined,
        phoneNumber: phoneNumber as string | undefined,
        role: role as string | undefined,
        isActive: isActive as boolean | undefined,
      });

      if (!member) return reply.status(404).send({ error: 'Staff not found' });
      return reply.send({ staff: member });
    },
  );

  /** PUT /v1/scheduling/staff/:id/availability — set weekly availability */
  fastify.put<{
    Params: { id: string };
    Body: { slots: { dayOfWeek: number; startTime: string; endTime: string }[] };
  }>(
    '/v1/scheduling/staff/:id/availability',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { slots } = request.body;

      if (!Array.isArray(slots)) {
        return reply.status(400).send({ error: 'slots must be an array' });
      }

      await svc.setStaffAvailability(id, tenantId, slots);
      return reply.send({ ok: true });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Services
  // ──────────────────────────────────────────────────────────────────────────

  /** GET /v1/scheduling/services — list all services for tenant */
  fastify.get('/v1/scheduling/services', { preHandler: authAndFeature(fastify) }, async (request, reply) => {
    const { tenantId } = request.user;
    const services = await svc.listServices(tenantId);
    return reply.send({ services });
  });

  /** POST /v1/scheduling/services — create new service */
  fastify.post<{ Body: Record<string, unknown> }>(
    '/v1/scheduling/services',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { name, durationMinutes, staffIds, isActive } = request.body;

      if (!name) {
        return reply.status(400).send({ error: 'name is required' });
      }

      const service = await svc.createService(tenantId, {
        name: name as string,
        durationMinutes: durationMinutes as number | undefined,
        staffIds: staffIds as string[] | undefined,
        isActive: isActive !== false,
      });

      return reply.status(201).send({ service });
    },
  );

  /** PUT /v1/scheduling/services/:id — update service */
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/v1/scheduling/services/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { name, durationMinutes, staffIds, isActive } = request.body;

      const service = await svc.updateService(id, tenantId, {
        name: name as string | undefined,
        durationMinutes: durationMinutes as number | undefined,
        staffIds: staffIds as string[] | undefined,
        isActive: isActive as boolean | undefined,
      });

      if (!service) return reply.status(404).send({ error: 'Service not found' });
      return reply.send({ service });
    },
  );

  /** GET /v1/scheduling/services/:id — get service with assigned staff */
  fastify.get<{ Params: { id: string } }>(
    '/v1/scheduling/services/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const service = await svc.getServiceWithStaff(id, tenantId);
      if (!service) return reply.status(404).send({ error: 'Service not found' });
      return reply.send({ service });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Appointments
  // ──────────────────────────────────────────────────────────────────────────

  /** GET /v1/scheduling/appointments — list appointments with optional filters */
  fastify.get<{
    Querystring: {
      status?: string;
      staffId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      limit?: string;
    };
  }>(
    '/v1/scheduling/appointments',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { status, staffId, dateFrom, dateTo, page, limit } = request.query;

      const appointments = await svc.listAppointments(tenantId, {
        status,
        staffId,
        dateFrom,
        dateTo,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });

      return reply.send({ appointments });
    },
  );

  /** GET /v1/scheduling/appointments/:id — get single appointment */
  fastify.get<{ Params: { id: string } }>(
    '/v1/scheduling/appointments/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const appointment = await svc.getAppointment(id, tenantId);
      if (!appointment) return reply.status(404).send({ error: 'Appointment not found' });
      return reply.send({ appointment });
    },
  );

  /** PATCH /v1/scheduling/appointments/:id/status — update appointment status */
  fastify.patch<{
    Params: { id: string };
    Body: { status: 'confirmed' | 'cancelled' };
  }>(
    '/v1/scheduling/appointments/:id/status',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { status } = request.body;

      if (!['confirmed', 'cancelled'].includes(status)) {
        return reply.status(400).send({ error: 'status must be confirmed or cancelled' });
      }

      const appt = await svc.getAppointment(id, tenantId);
      if (!appt) return reply.status(404).send({ error: 'Appointment not found' });

      await svc.updateAppointmentStatus(id, tenantId, status);
      return reply.send({ ok: true });
    },
  );

  /** GET /v1/scheduling/availability — check available slots for a service */
  fastify.get<{
    Querystring: { serviceName: string; requestedDatetime?: string; count?: string };
  }>(
    '/v1/scheduling/availability',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { serviceName, requestedDatetime, count } = request.query;

      if (!serviceName) {
        return reply.status(400).send({ error: 'serviceName is required' });
      }

      const slots = await svc.getAvailableSlots(
        tenantId,
        serviceName,
        requestedDatetime,
        count ? parseInt(count, 10) : 3,
      );

      return reply.send({ slots });
    },
  );
};
