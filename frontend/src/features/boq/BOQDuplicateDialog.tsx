// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Asks for the name of a copy of a bill before it is made.
 *
 * Duplicate used to copy on one click and name the copy "<name> (Copy)" in
 * English, so two copies of one bill could not be told apart and the name was
 * in the wrong language. The dialog proposes "<name> (copy)" in the reader's
 * language and lets the user change it, the way Create revision does.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

/** The name the copy is proposed under. */
export function defaultCopyName(
  baseName: string,
  t: (key: string, options?: Record<string, string>) => string,
): string {
  return t('boq.duplicate_default_name', { defaultValue: '{{name}} (copy)', name: baseName });
}

interface BOQDuplicateDialogProps {
  baseName: string;
  isPending: boolean;
  /** The trimmed name of the copy; the dialog never submits an empty name. */
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function BOQDuplicateDialog({ baseName, isPending, onSubmit, onClose }: BOQDuplicateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => defaultCopyName(baseName, t));
  const title = t('boq.duplicate_dialog_title', { defaultValue: 'Duplicate bill of quantities' });
  const trimmed = name.trim();

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
          if (!isPending && trimmed) onSubmit(trimmed);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 className="mb-3 text-base font-semibold text-content-primary">{title}</h2>
        <label className="mb-1 block text-xs font-medium text-content-secondary" htmlFor="boq-duplicate-name">
          {t('boq.duplicate_name', { defaultValue: 'Name of the copy' })}
        </label>
        <input
          id="boq-duplicate-name"
          autoFocus
          value={name}
          maxLength={255}
          data-testid="boq-duplicate-name"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded-md border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary focus:border-oe-blue focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" size="sm" loading={isPending} disabled={!trimmed} data-testid="boq-duplicate-submit">
            {t('boq.duplicate_dialog_confirm', { defaultValue: 'Duplicate' })}
          </Button>
        </div>
      </form>
    </div>
  );
}
