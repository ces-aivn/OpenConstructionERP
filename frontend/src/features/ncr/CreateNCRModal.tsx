// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The NCR form, used to raise an NCR on the NCR register and to confirm one
 * prefilled from a failed inspection. Description, severity and the party
 * responsible for the correction are required, matching the server rule.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  AlertOctagon,
  Plus,
  X,
  Package,
  Wrench,
  PenTool,
  FileText,
  ShieldAlert,
  AlertCircle,
  AlertTriangle,
  Info,
  MapPin,
} from 'lucide-react';
import { Button } from '@/shared/ui';
import type { NCRType, NCRSeverity } from './api';
import { EMPTY_PARTY, PartyPicker, usePartyOptions, type PartyValue } from './PartyPicker';

// English fallbacks for the computed `ncr.severity_*` keys. The default used to be
// the raw value, so until the key lands in a locale the screen shows the bare
// enum token to every reader, English included.
export const NCR_SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical', major: 'Major', minor: 'Minor', observation: 'Observation'
};

const inputCls =
  'h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
const textareaCls =
  'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue resize-none';

export const NCR_TYPES: NCRType[] = ['material', 'workmanship', 'design', 'documentation', 'safety'];

const NCR_SEVERITIES: NCRSeverity[] = ['critical', 'major', 'minor', 'observation'];

const NCR_TYPE_CARD_CONFIG: Record<NCRType, { icon: React.ElementType; color: string }> = {
  material: { icon: Package, color: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/30 dark:border-blue-800' },
  workmanship: { icon: Wrench, color: 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-800' },
  design: { icon: PenTool, color: 'text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950/30 dark:border-purple-800' },
  documentation: { icon: FileText, color: 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/50 dark:border-gray-700' },
  safety: { icon: ShieldAlert, color: 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-800' },
};

const SEVERITY_CARD_CONFIG: Record<NCRSeverity, { icon: React.ElementType; color: string; ringColor: string }> = {
  critical: { icon: AlertOctagon, color: 'text-red-700 bg-red-50 border-red-300 dark:text-red-400 dark:bg-red-950/30 dark:border-red-800', ringColor: 'ring-red-300' },
  major: { icon: AlertCircle, color: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950/30 dark:border-orange-800', ringColor: 'ring-orange-300' },
  minor: { icon: AlertTriangle, color: 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/30 dark:border-yellow-800', ringColor: 'ring-yellow-300' },
  observation: { icon: Info, color: 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/50 dark:border-gray-700', ringColor: 'ring-gray-300' },
};

/* -- Create NCR Modal ------------------------------------------------------ */

export interface NCRFormData {
  title: string;
  ncr_type: NCRType;
  /** Empty until the person raising the NCR chooses one: never assumed. */
  severity: NCRSeverity | '';
  description: string;
  location: string;
  root_cause: string;
  responsible: PartyValue;
}

export const EMPTY_NCR_FORM: NCRFormData = {
  title: '',
  ncr_type: 'material',
  severity: '',
  description: '',
  location: '',
  root_cause: '',
  responsible: EMPTY_PARTY,
};

/** The fields a valid form contributes to a create payload. */
export function ncrFormPayload(form: NCRFormData) {
  return {
    title: form.title.trim(),
    ncr_type: form.ncr_type,
    severity: form.severity as NCRSeverity,
    description: form.description.trim(),
    location_description: form.location.trim() || undefined,
    root_cause: form.root_cause.trim() || undefined,
    responsible_party_id: form.responsible.id || null,
    responsible_party_name: form.responsible.name.trim(),
    responsible_party_kind: form.responsible.id ? form.responsible.kind : 'text',
  } as const;
}

/** What is still missing before the form can be sent. */
export function ncrFormErrors(form: NCRFormData) {
  return {
    title: form.title.trim().length === 0,
    description: form.description.trim().length === 0,
    severity: form.severity === '',
    responsible: form.responsible.name.trim().length === 0,
  };
}

export function CreateNCRModal({
  onClose,
  onSubmit,
  isPending,
  projectName,
  initialData,
  heading,
  subheading,
}: {
  onClose: () => void;
  onSubmit: (data: NCRFormData) => void;
  isPending: boolean;
  projectName?: string;
  /** Prefill, e.g. from a failed inspection. The user confirms before saving. */
  initialData?: Partial<NCRFormData>;
  heading?: string;
  subheading?: string;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<NCRFormData>({ ...EMPTY_NCR_FORM, ...initialData });
  // Opened prefilled (from a failed inspection), the form says at once what
  // it still needs, rather than showing a disabled Create with no reason.
  const [touched, setTouched] = useState(!!initialData);
  const partyOptions = usePartyOptions(['subcontractor', 'contact', 'user']);

  const set = <K extends keyof NCRFormData>(key: K, value: NCRFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const errors = ncrFormErrors(form);
  const titleError = touched && errors.title;
  const descError = touched && errors.description;
  const severityError = touched && errors.severity;
  const partyError = touched && errors.responsible;
  const canSubmit = !Object.values(errors).some(Boolean);

  const handleSubmit = () => {
    setTouched(true);
    if (canSubmit) onSubmit(form);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-lg animate-fade-in">
      <div className="w-full max-w-2xl bg-surface-elevated rounded-xl shadow-xl border border-border animate-card-in mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-label={t('ncr.new_ncr', { defaultValue: 'New NCR' })}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border-light">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-content-primary">
              {heading ?? t('ncr.new_ncr', { defaultValue: 'New NCR' })}
            </h2>
            {subheading && <p className="text-xs text-content-tertiary mt-0.5 truncate">{subheading}</p>}
            {projectName && (
              <p className="text-xs text-content-tertiary mt-0.5">
                {t('common.creating_in_project', {
                  defaultValue: 'In {{project}}',
                  project: projectName,
                })}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-content-tertiary hover:bg-surface-secondary hover:text-content-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-5">
          {/* ── NCR Type ── */}
          <div>
            <label className="block text-sm font-medium text-content-primary mb-2">
              {t('ncr.field_type', { defaultValue: 'Non-Conformance Type' })}
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {NCR_TYPES.map((nt) => {
                const cfg = NCR_TYPE_CARD_CONFIG[nt];
                const TypeIcon = cfg.icon;
                const selected = form.ncr_type === nt;
                return (
                  <button
                    key={nt}
                    type="button"
                    onClick={() => set('ncr_type', nt)}
                    className={clsx(
                      'flex flex-col items-center gap-1.5 rounded-lg border-2 px-2 py-2.5 text-center transition-all',
                      selected
                        ? cfg.color + ' ring-2 ring-oe-blue/30'
                        : 'border-border bg-surface-primary text-content-tertiary hover:border-border-light hover:bg-surface-secondary',
                    )}
                  >
                    <TypeIcon size={18} />
                    <span className="text-2xs font-medium leading-tight">
                      {t(`ncr.type_${nt}`, {
                        defaultValue: nt.charAt(0).toUpperCase() + nt.slice(1),
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Severity ── */}
          <div>
            <label className="block text-sm font-medium text-content-primary mb-2">
              {t('ncr.field_severity', { defaultValue: 'Severity' })}{' '}
              <span className="text-semantic-error">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {NCR_SEVERITIES.map((sev) => {
                const cfg = SEVERITY_CARD_CONFIG[sev];
                const SevIcon = cfg.icon;
                const selected = form.severity === sev;
                return (
                  <button
                    key={sev}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => set('severity', sev)}
                    className={clsx(
                      'flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 transition-all text-left',
                      selected
                        ? cfg.color + ' ring-2 ' + cfg.ringColor
                        : 'border-border bg-surface-primary text-content-tertiary hover:border-border-light hover:bg-surface-secondary',
                    )}
                  >
                    <SevIcon size={16} className="shrink-0" />
                    <span className="text-xs font-semibold">
                      {t(`ncr.severity_${sev}`, {
                        defaultValue: NCR_SEVERITY_LABELS[sev] ?? sev.charAt(0).toUpperCase() + sev.slice(1),
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {severityError && (
            <p className="-mt-3 text-xs text-semantic-error">
              {t('ncr.severity_required', { defaultValue: 'Choose a severity' })}
            </p>
          )}

          {/* ── Responsible party ── */}
          <div>
            <label htmlFor="ncr-responsible" className="block text-sm font-medium text-content-primary mb-1.5">
              {t('ncr.field_responsible_party', { defaultValue: 'Responsible party' })}{' '}
              <span className="text-semantic-error">*</span>
            </label>
            <PartyPicker
              id="ncr-responsible"
              value={form.responsible}
              onChange={(v) => set('responsible', v)}
              options={partyOptions}
              invalid={partyError}
              placeholder={t('ncr.responsible_party_placeholder', {
                defaultValue: 'Subcontractor, contact or team member - or type a name',
              })}
            />
            {partyError ? (
              <p className="mt-1 text-xs text-semantic-error">
                {t('ncr.responsible_party_required', {
                  defaultValue: 'Name who is responsible for correcting this non-conformance',
                })}
              </p>
            ) : (
              <p className="mt-1 text-xs text-content-tertiary">
                {t('ncr.responsible_party_hint', {
                  defaultValue: 'Pick from the subcontractor register or contacts to link the record.',
                })}
              </p>
            )}
          </div>

          {/* ── Details Section ── */}
          <div className="flex items-center gap-2 pt-2 pb-1">
            <AlertOctagon size={14} className="text-content-tertiary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              {t('ncr.section_details', { defaultValue: 'NCR Details' })}
            </span>
            <div className="flex-1 h-px bg-border-light" />
          </div>

          {/* Title */}
          <div>
            <label htmlFor="ncr-title" className="block text-sm font-medium text-content-primary mb-1.5">
              {t('ncr.field_title', { defaultValue: 'Title' })}{' '}
              <span className="text-semantic-error">*</span>
            </label>
            <input
              id="ncr-title"
              value={form.title}
              onChange={(e) => {
                set('title', e.target.value);
                setTouched(true);
              }}
              placeholder={t('ncr.title_placeholder', {
                defaultValue: 'e.g. Concrete strength below specification at Column C3',
              })}
              className={clsx(
                inputCls,
                titleError &&
                  'border-semantic-error focus:ring-red-300 focus:border-semantic-error',
              )}
              maxLength={500}
              autoFocus
            />
            {titleError && (
              <p className="mt-1 text-xs text-semantic-error">
                {t('ncr.title_required', { defaultValue: 'Title is required' })}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="ncr-description" className="block text-sm font-medium text-content-primary mb-1.5">
              {t('ncr.field_description', { defaultValue: 'Description' })}{' '}
              <span className="text-semantic-error">*</span>
            </label>
            <textarea
              id="ncr-description"
              value={form.description}
              onChange={(e) => {
                set('description', e.target.value);
                setTouched(true);
              }}
              rows={5}
              maxLength={10000}
              className={clsx(
                textareaCls,
                descError &&
                  'border-semantic-error focus:ring-red-300 focus:border-semantic-error',
              )}
              placeholder={t('ncr.description_placeholder', {
                defaultValue: 'Describe the non-conformance in detail: what was observed, where, and what specification was not met...',
              })}
            />
            {descError && (
              <p className="mt-1 text-xs text-semantic-error">
                {t('ncr.description_required', { defaultValue: 'Description is required' })}
              </p>
            )}
          </div>

          {/* ── Location Section ── */}
          <div className="flex items-center gap-2 pt-2 pb-1">
            <MapPin size={14} className="text-content-tertiary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              {t('ncr.section_location', { defaultValue: 'Location' })}
            </span>
            <div className="flex-1 h-px bg-border-light" />
          </div>

          <div>
            <label htmlFor="ncr-location" className="block text-sm font-medium text-content-primary mb-1.5">
              {t('ncr.field_location', { defaultValue: 'Location' })}
            </label>
            <input
              id="ncr-location"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              className={inputCls}
              placeholder={t('ncr.location_placeholder', {
                defaultValue: 'e.g. Building A, Level 2, Zone C',
              })}
            />
          </div>

          {/* Root Cause */}
          <div>
            <label htmlFor="ncr-root-cause" className="block text-sm font-medium text-content-primary mb-1.5">
              {t('ncr.field_root_cause', { defaultValue: 'Root Cause (if known)' })}
            </label>
            <textarea
              id="ncr-root-cause"
              value={form.root_cause}
              onChange={(e) => set('root_cause', e.target.value)}
              rows={3}
              className={textareaCls}
              placeholder={t('ncr.root_cause_placeholder', {
                defaultValue: 'Preliminary analysis of why the non-conformance occurred...',
              })}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2 shrink-0" />
            ) : (
              <Plus size={16} className="mr-1.5 shrink-0" />
            )}
            <span>{t('ncr.create_ncr', { defaultValue: 'Create NCR' })}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
