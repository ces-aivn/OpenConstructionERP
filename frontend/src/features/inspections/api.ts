// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * API helpers for Quality Inspections.
 *
 * All endpoints are prefixed with /v1/inspections/.
 */

import { apiGet, apiPost, apiPatch, apiDelete, type Page } from '@/shared/lib/api';

/* -- Types ----------------------------------------------------------------- */

export type InspectionType =
  | 'structural'
  | 'electrical'
  | 'plumbing'
  | 'fire_safety'
  | 'concrete'
  | 'concrete_pour'
  | 'waterproofing'
  | 'mep'
  | 'fire_stopping'
  | 'handover'
  | 'finishes'
  | 'general';

export type InspectionResult = 'pass' | 'fail' | 'partial';

export type InspectionStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** The verdict on one checklist item; `null` until the item is assessed. */
export type ChecklistVerdict = 'pass' | 'fail' | 'na';

export interface ChecklistItem {
  id: string;
  description: string;
  /** False only for an item with an explicit failing verdict. */
  passed: boolean;
  result: ChecklistVerdict | null;
  critical: boolean;
  notes: string;
}

export interface Inspection {
  id: string;
  project_id: string;
  /** Backend returns this already formatted, e.g. "INS-001". Do not re-prefix. */
  inspection_number: string;
  title: string;
  inspection_type: InspectionType;
  /** Display name of the inspector (resolved reference, else stored name). */
  inspector: string;
  /** The user/contact the inspector is linked to, when one was picked. */
  inspector_id: string | null;
  inspector_name: string | null;
  date: string;
  location: string;
  result: InspectionResult | null;
  status: InspectionStatus;
  checklist: ChecklistItem[];
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionFilters {
  project_id?: string;
  status?: InspectionStatus | '';
  result?: InspectionResult | '';
  type?: InspectionType | '';
}

/**
 * Checklist item as sent to the backend (matches the `ChecklistEntry`
 * schema). The backend keys off `question` and the boolean `passed`
 * (the create-defect / create-ncr flows read failed items from here).
 */
export interface ChecklistEntryPayload {
  question: string;
  response_type?: string;
  passed?: boolean;
  critical?: boolean;
  notes?: string;
}

export interface CreateInspectionPayload {
  project_id: string;
  title: string;
  inspection_type: InspectionType;
  inspection_date?: string;
  inspector_id?: string;
  inspector_name?: string;
  location?: string;
  checklist_data?: ChecklistEntryPayload[];
  /** The checklist template the checklist was loaded from; the server records it. */
  checklist_template?: string;
}

export interface UpdateInspectionPayload {
  title?: string;
  inspection_type?: InspectionType;
  inspection_date?: string | null;
  inspector_id?: string | null;
  inspector_name?: string | null;
  location?: string | null;
  status?: InspectionStatus;
  checklist_data?: ChecklistEntryPayload[];
}

/** The verdict on one item, sent with the inspection result. */
export interface ChecklistItemResultPayload {
  id?: string;
  index?: number;
  result: ChecklistVerdict;
  notes?: string;
}

/** What the user confirmed in the prefilled NCR form. */
export interface CreateNcrFromInspectionPayload {
  title: string;
  description: string;
  ncr_type: string;
  severity: string;
  location_description?: string;
  root_cause?: string;
  responsible_party_id?: string | null;
  responsible_party_name: string;
  responsible_party_kind?: string | null;
}

/** Result returned by POST /{id}/create-ncr/. */
export interface CreateNcrResult {
  ncr_id: string;
  ncr_number: string;
  inspection_id: string;
  severity?: string;
  ncr_type?: string;
  /** false when an NCR already linked to this inspection was returned as-is. */
  created: boolean;
}

/* -- Wire <-> UI normaliser ----------------------------------------------- */

type ChecklistEntryWire = {
  id?: string;
  category?: string | null;
  question?: string;
  response_type?: string;
  response?: string | null;
  critical?: boolean;
  description?: string;
  passed?: boolean;
  notes?: string | null;
};

type InspectionWire = Omit<Inspection, 'inspector' | 'inspector_id' | 'inspector_name' | 'date' | 'checklist'> & {
  inspector?: string;
  inspector_id?: string | null;
  inspector_name?: string | null;
  date?: string;
  inspection_date?: string | null;
  checklist?: ChecklistEntryWire[];
  checklist_data?: ChecklistEntryWire[];
};

const FAIL_RESPONSES = new Set(['no', 'fail', 'false', '0', 'failed']);
const PASS_RESPONSES = new Set(['yes', 'pass', 'true', '1', 'passed']);

/**
 * Read an item's verdict the way the backend's `item_failed` does: only an
 * explicit failing response is a failure, only an explicit passing one is a
 * pass, and anything else is "not assessed" rather than a silent green tick.
 */
export function checklistVerdict(e: ChecklistEntryWire): ChecklistVerdict | null {
  if (typeof e.passed === 'boolean') return e.passed ? 'pass' : 'fail';
  const resp = (e.response ?? '').trim().toLowerCase();
  if (FAIL_RESPONSES.has(resp)) return 'fail';
  if (PASS_RESPONSES.has(resp)) return 'pass';
  if (resp === 'na' || resp === 'n/a') return 'na';
  return null;
}

function normaliseChecklistItem(e: ChecklistEntryWire, i: number): ChecklistItem {
  const result = checklistVerdict(e);
  return {
    id: e.id ?? `item-${i}`,
    description: e.description ?? e.question ?? '',
    passed: result !== 'fail',
    result,
    critical: Boolean(e.critical),
    notes: e.notes ?? '',
  };
}

function normaliseInspection(raw: InspectionWire): Inspection {
  const checklistSrc = raw.checklist ?? raw.checklist_data ?? [];
  return {
    ...raw,
    // ``inspector_name`` is the backend's resolution of ``inspector_id``, which
    // may hold a contact id, a user id or a typed name depending on who wrote
    // the row. It is absent when nothing resolved, and then the stored value is
    // the best thing to show: on a hand-typed row it is already the name, and
    // on a deleted party it is the only trace left. Showing the id unresolved
    // is what printed a bare UUID in the inspector column.
    inspector: raw.inspector_name ?? raw.inspector ?? raw.inspector_id ?? '',
    inspector_id: raw.inspector_id ?? null,
    inspector_name: raw.inspector_name ?? null,
    date: raw.date ?? raw.inspection_date ?? '',
    checklist: checklistSrc.map(normaliseChecklistItem),
    notes: raw.notes ?? '',
  } as Inspection;
}

/* -- API Functions --------------------------------------------------------- */

export async function fetchInspections(
  filters?: InspectionFilters,
): Promise<Page<Inspection>> {
  const params = new URLSearchParams();
  if (filters?.project_id) params.set('project_id', filters.project_id);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.result) params.set('result', filters.result);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  const page = await apiGet<Page<InspectionWire>>(`/v1/inspections/${qs ? `?${qs}` : ''}`);
  return { ...page, items: page.items.map(normaliseInspection) };
}

export async function createInspection(data: CreateInspectionPayload): Promise<Inspection> {
  const row = await apiPost<InspectionWire>('/v1/inspections/', data);
  return normaliseInspection(row);
}

export async function completeInspection(
  id: string,
  result: InspectionResult = 'pass',
  itemResults: ChecklistItemResultPayload[] = [],
): Promise<Inspection> {
  const row = await apiPost<InspectionWire>(`/v1/inspections/${id}/complete/`, {
    result,
    item_results: itemResults,
  });
  return normaliseInspection(row);
}

/**
 * Raise a Non-Conformance Report pre-filled from a failed/partial inspection.
 *
 * The client prefills the NCR form from the inspection and the user confirms
 * it; the backend (POST /v1/inspections/{id}/create-ncr/) links
 * `linked_inspection_id` and requires a responsible party. It is idempotent:
 * if an NCR already exists for the inspection it is returned with
 * `created: false`.
 */
export async function createNcrFromInspection(
  id: string,
  body: CreateNcrFromInspectionPayload,
): Promise<CreateNcrResult> {
  return apiPost<CreateNcrResult>(`/v1/inspections/${id}/create-ncr/`, body);
}

export async function updateInspection(
  id: string,
  data: UpdateInspectionPayload,
): Promise<Inspection> {
  const row = await apiPatch<InspectionWire>(`/v1/inspections/${id}`, data);
  return normaliseInspection(row);
}

export async function deleteInspection(id: string): Promise<void> {
  return apiDelete(`/v1/inspections/${id}`);
}

/* -- Checklist templates ---------------------------------------------------- */

/** One item of a checklist template, worded by the server in the request's language. */
export interface ChecklistTemplateItem {
  key: string;
  /** The message key the text is read from. */
  text_key: string;
  text: string;
  critical: boolean;
}

/** A checklist template as offered for an inspection type. */
export interface ChecklistTemplate {
  code: string;
  name_key: string;
  name: string;
  inspection_types: string[];
  /** The template loaded when the requested type is picked. */
  is_default: boolean;
  items: ChecklistTemplateItem[];
}

/** The templates offered for an inspection type, its default first. */
export function listChecklistTemplates(inspectionType: InspectionType): Promise<ChecklistTemplate[]> {
  return apiGet<ChecklistTemplate[]>(
    `/v1/inspections/checklist-templates/?inspection_type=${encodeURIComponent(inspectionType)}`,
  );
}
