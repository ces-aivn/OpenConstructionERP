// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Asks for the name and the reason of a new revision before it is created.
 *
 * A revision made on one click came out as "<name> (Copy)", so two revisions
 * of the same bill could not be told apart. Leaving the name empty lets the
 * server number it ("<original name> v2", "v3", ...); the reason is kept with
 * the revision so the version history says why it was made.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

export interface RevisionRequest {
  name?: string;
  reason?: string;
}

/** Trim the form and drop empty fields, so the server applies its defaults. */
export function revisionRequest(name: string, reason: string): RevisionRequest {
  const out: RevisionRequest = {};
  const n = name.trim();
  const r = reason.trim();
  if (n) out.name = n;
  if (r) out.reason = r;
  return out;
}

interface BOQRevisionDialogProps {
  baseName: string;
  isPending: boolean;
  onSubmit: (request: RevisionRequest) => void;
  onClose: () => void;
}

export function BOQRevisionDialog({ baseName, isPending, onSubmit, onClose }: BOQRevisionDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const title = t('boq.revision_dialog_title', { defaultValue: 'Create revision' });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <form
        className="w-full max-w-md rounded-xl bg-surface-primary p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPending) onSubmit(revisionRequest(name, reason));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 className="mb-3 text-base font-semibold text-content-primary">{title}</h2>
        <label className="mb-1 block text-xs font-medium text-content-secondary" htmlFor="boq-revision-name">
          {t('boq.revision_name', { defaultValue: 'Revision name' })}
        </label>
        <input
          id="boq-revision-name"
          autoFocus
          value={name}
          maxLength={255}
          data-testid="boq-revision-name"
          placeholder={t('boq.revision_name_placeholder', {
            defaultValue: '{{name}} v2, v3... (numbered automatically)',
            name: baseName,
          })}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-md border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary focus:border-oe-blue focus:outline-none"
        />
        <label className="mb-1 block text-xs font-medium text-content-secondary" htmlFor="boq-revision-reason">
          {t('boq.revision_reason', { defaultValue: 'Reason for the revision (optional)' })}
        </label>
        <textarea
          id="boq-revision-reason"
          value={reason}
          maxLength={2000}
          rows={3}
          data-testid="boq-revision-reason"
          onChange={(e) => setReason(e.target.value)}
          className="mb-4 w-full rounded-md border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary focus:border-oe-blue focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" size="sm" loading={isPending} data-testid="boq-revision-submit">
            {t('boq.revision_dialog_confirm', { defaultValue: 'Create revision' })}
          </Button>
        </div>
      </form>
    </div>
  );
}
