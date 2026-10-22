// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import type { Activity } from './api';
import { parseProgressPct } from './ActivityGrid';

/**
 * The progress of one activity, typed as a percentage and saved on request.
 *
 * Shown in the activity panel a Gantt bar opens. A section's progress is
 * rolled up from its activities by the server, so it is shown, not edited.
 */
export function ActivityProgressEditor({
  activity,
  saving = false,
  disabled = false,
  onSave,
}: {
  activity: Pick<Activity, 'id' | 'progress_pct' | 'activity_type'>;
  saving?: boolean;
  /** A reader without edit rights sees the value only. */
  disabled?: boolean;
  onSave: (pct: number) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const stored = Math.round(Number(activity.progress_pct) || 0);
  const [draft, setDraft] = useState(String(stored));
  // A saved value, or another activity, starts the field afresh.
  useEffect(() => setDraft(String(stored)), [activity.id, stored]);

  if (activity.activity_type === 'summary' || disabled) {
    return (
      <p className="text-sm text-content-secondary" data-testid="activity-progress-readonly">
        {activity.activity_type === 'summary'
          ? t('schedule.progress_rolled_up', {
              defaultValue: 'Progress: {{pct}}%, rolled up from the activities in this section.',
              pct: stored,
            })
          : t('schedule.progress_value', { defaultValue: 'Progress: {{pct}}%', pct: stored })}
      </p>
    );
  }

  const pct = parseProgressPct(draft);
  const invalid = draft.trim() !== '' && pct == null;
  const save = () => {
    if (pct != null && pct !== stored) onSave(pct);
  };

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-content-primary">
        {t('schedule.progress', { defaultValue: 'Progress' })}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          data-testid="activity-progress-input"
          aria-invalid={invalid || undefined}
          className="h-9 w-24 rounded-lg border border-border bg-surface-primary px-2 text-right text-sm tabular-nums focus:border-oe-blue focus:outline-none focus:ring-2 focus:ring-oe-blue/30"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
        />
        <span className="text-sm text-content-tertiary">%</span>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          data-testid="activity-progress-save"
          loading={saving}
          disabled={pct == null || pct === stored}
          onClick={save}
        >
          {t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>
      {invalid && (
        <p className="text-xs text-semantic-error">
          {t('schedule.progress_invalid', { defaultValue: 'Enter a whole number from 0 to 100.' })}
        </p>
      )}
    </div>
  );
}
