/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/hooks/useScheduling.ts
 * Role    : React Query hooks for Scheduling module CRUD.
 *           Wraps /v1/scheduling/* API endpoints.
 * Exports : useStaff, useCreateStaff, useUpdateStaff, useSetAvailability,
 *           useServices, useCreateService, useUpdateService,
 *           useAppointments, useAppointment, useUpdateAppointmentStatus,
 *           StaffRow, ServiceRow, AppointmentRow, AvailabilitySlot
 * DO NOT  : Import from apps/api or packages/db directly
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AvailabilitySlot {
  dayOfWeek: number; // 0=Sun … 6=Sat
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
}

export interface StaffRow {
  id: string;
  tenantId: string;
  name: string;
  phoneNumber: string;
  role: string | null;
  isActive: boolean;
  availability?: AvailabilitySlot[];
  createdAt: string;
  updatedAt: string;
}

export interface ServiceRow {
  id: string;
  tenantId: string;
  name: string;
  durationMinutes: number;
  isActive: boolean;
  staff?: StaffRow[];
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatus = 'negotiating' | 'pending_doctor' | 'confirmed' | 'cancelled';

export interface AppointmentRow {
  id: string;
  tenantId: string;
  buyerId: string;
  staffId: string;
  serviceId: string;
  startTime: string;  // UTC ISO8601
  endTime: string;    // UTC ISO8601
  status: AppointmentStatus;
  notes: string | null;
  bullmqJobId: string | null;
  // Joined fields (when loaded with detail)
  staffName?: string;
  serviceName?: string;
  buyerPhone?: string;
  buyerName?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Query Keys ───────────────────────────────────────────────────────────────

const KEYS = {
  staff: ['scheduling', 'staff'] as const,
  staffDetail: (id: string) => ['scheduling', 'staff', id] as const,
  services: ['scheduling', 'services'] as const,
  serviceDetail: (id: string) => ['scheduling', 'services', id] as const,
  appointments: (filters?: Record<string, string>) => ['scheduling', 'appointments', filters ?? {}] as const,
  appointment: (id: string) => ['scheduling', 'appointments', id] as const,
};

// ── Staff Hooks ───────────────────────────────────────────────────────────────

export function useStaff() {
  return useQuery<StaffRow[]>({
    queryKey: KEYS.staff,
    queryFn: async () => {
      const data = await api.get('/v1/scheduling/staff');
      return data.staff;
    },
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation<StaffRow, Error, Omit<StaffRow, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'availability'>>({
    mutationFn: (body) => api.post('/v1/scheduling/staff', body).then((d) => d.staff),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.staff }),
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation<StaffRow, Error, { id: string } & Partial<StaffRow>>({
    mutationFn: ({ id, ...body }) => api.put(`/v1/scheduling/staff/${id}`, body).then((d) => d.staff),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.staff }),
  });
}

export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation<void, Error, { staffId: string; slots: AvailabilitySlot[] }>({
    mutationFn: ({ staffId, slots }) => api.put(`/v1/scheduling/staff/${staffId}/availability`, { slots }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.staff }),
  });
}

// ── Service Hooks ─────────────────────────────────────────────────────────────

export function useServices() {
  return useQuery<ServiceRow[]>({
    queryKey: KEYS.services,
    queryFn: async () => {
      const data = await api.get('/v1/scheduling/services');
      return data.services;
    },
  });
}

export function useService(id: string | undefined) {
  return useQuery<ServiceRow>({
    queryKey: KEYS.serviceDetail(id ?? ''),
    queryFn: async () => {
      const data = await api.get(`/v1/scheduling/services/${id}`);
      return data.service;
    },
    enabled: !!id,
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation<ServiceRow, Error, { name: string; durationMinutes?: number; staffIds?: string[]; isActive?: boolean }>({
    mutationFn: (body) => api.post('/v1/scheduling/services', body).then((d) => d.service),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.services }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation<ServiceRow, Error, { id: string; name?: string; durationMinutes?: number; staffIds?: string[]; isActive?: boolean }>({
    mutationFn: ({ id, ...body }) => api.put(`/v1/scheduling/services/${id}`, body).then((d) => d.service),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.services });
    },
  });
}

// ── Appointment Hooks ─────────────────────────────────────────────────────────

export interface AppointmentFilters {
  status?: AppointmentStatus;
  staffId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export function useAppointments(filters?: AppointmentFilters) {
  const params = filters
    ? Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)) as Record<string, string>
    : {};

  return useQuery<AppointmentRow[]>({
    queryKey: KEYS.appointments(params),
    queryFn: async () => {
      const qs = new URLSearchParams(params).toString();
      const data = await api.get(`/v1/scheduling/appointments${qs ? `?${qs}` : ''}`);
      return data.appointments;
    },
  });
}

export function useAppointment(id: string | undefined) {
  return useQuery<AppointmentRow>({
    queryKey: KEYS.appointment(id ?? ''),
    queryFn: async () => {
      const data = await api.get(`/v1/scheduling/appointments/${id}`);
      return data.appointment;
    },
    enabled: !!id,
  });
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; status: 'confirmed' | 'cancelled' }>({
    mutationFn: ({ id, status }) => api.patch(`/v1/scheduling/appointments/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'appointments'] });
    },
  });
}
