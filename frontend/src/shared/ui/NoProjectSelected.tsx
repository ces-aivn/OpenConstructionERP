// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The one "no project selected" state for every project-scoped screen.
 *
 * Modules used to word this each their own way ("Open a project first",
 * "No project selected", "No projects yet"), and only some offered a way to
 * act on it. This component says it once, the same way everywhere, with one
 * call to action: open the project picker in the header. On a screen too
 * narrow for the picker the action opens the project list instead.
 */
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

/** Window event the header project picker answers by opening itself. */
export const OPEN_PROJECT_PICKER_EVENT = 'oe:open-project-picker';

export interface OpenProjectPickerDetail {
  /** Set by the picker when it opened, so the caller can fall back. */
  handled: boolean;
}

/**
 * Ask the header project picker to open. Returns false when no picker
 * answered (it is hidden on narrow screens), so the caller can fall back.
 */
export function requestProjectPicker(): boolean {
  if (typeof window === 'undefined') return false;
  const detail: OpenProjectPickerDetail = { handled: false };
  window.dispatchEvent(new CustomEvent<OpenProjectPickerDetail>(OPEN_PROJECT_PICKER_EVENT, { detail }));
  return detail.handled;
}

export interface NoProjectSelectedProps {
  /** One sentence on what the screen shows once a project is chosen. */
  description?: string;
  className?: string;
}

export function NoProjectSelected({ description, className }: NoProjectSelectedProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      className={className}
      icon={<FolderOpen size={24} strokeWidth={1.75} />}
      title={t('common.no_project_title', { defaultValue: 'No project selected' })}
      description={
        description ??
        t('common.no_project_hint', {
          defaultValue: 'Choose a project in the project picker at the top of the page to continue.',
        })
      }
      action={
        <Button
          variant="primary"
          onClick={() => {
            if (!requestProjectPicker()) navigate('/projects');
          }}
        >
          {t('common.choose_project', { defaultValue: 'Choose a project' })}
        </Button>
      }
    />
  );
}
