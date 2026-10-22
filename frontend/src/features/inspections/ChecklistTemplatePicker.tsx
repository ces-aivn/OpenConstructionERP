// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Start an inspection's checklist from the usual one for its type.
//
// Picking "structural" left the checklist empty, so each inspector wrote the
// hold points from memory. The server keeps a template per kind of work
// (concrete pour, rebar, structural steel, MEP rough-in, waterproofing, fire
// stopping, finishes), worded in the reader's language. Picking a type loads
// its default while the checklist is still untouched; the select loads any
// other. Once loaded the rows are the inspector's: edited, added or removed
// like any other. A template never overwrites rows somebody edited without
// asking first.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';

import { Button } from '@/shared/ui';
import { listChecklistTemplates, type ChecklistTemplate, type InspectionType } from './api';

/** One checklist row of the inspection form. */
export interface ChecklistRow {
  question: string;
  critical: boolean;
  notes: string;
}

/** A template's items as form rows, in the words the server sent. */
export function rowsFromTemplate(template: ChecklistTemplate): ChecklistRow[] {
  return template.items.map((item) => ({ question: item.text, critical: item.critical, notes: '' }));
}

function sameRows(a: ChecklistRow[], b: ChecklistRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether the checklist may be replaced without asking: nothing in it, or
 * exactly what the last template put there.
 */
export function checklistIsPristine(rows: ChecklistRow[], loaded: ChecklistRow[] | null): boolean {
  return rows.length === 0 || (loaded !== null && sameRows(rows, loaded));
}

const SELECT_CLS =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

export function ChecklistTemplatePicker({
  inspectionType,
  rows,
  onLoad,
}: {
  inspectionType: InspectionType;
  rows: ChecklistRow[];
  /** Replace the checklist with a template's rows. */
  onLoad: (templateCode: string, rows: ChecklistRow[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const templatesQ = useQuery({
    // The server words the templates in the request's language, so the
    // language is part of what was read.
    queryKey: ['inspections', 'checklist-templates', inspectionType, i18n.language],
    queryFn: () => listChecklistTemplates(inspectionType),
    staleTime: 5 * 60_000,
  });
  const templates = templatesQ.data ?? [];

  const [loaded, setLoaded] = useState<{ code: string; rows: ChecklistRow[] } | null>(null);
  const [pending, setPending] = useState<ChecklistTemplate | null>(null);
  // The type whose default has been considered, so the default is loaded
  // once per pick of a type and never again because a row was deleted.
  const consideredType = useRef<string | null>(null);

  const load = (template: ChecklistTemplate) => {
    const next = rowsFromTemplate(template);
    setLoaded({ code: template.code, rows: next });
    setPending(null);
    onLoad(template.code, next);
  };

  useEffect(() => {
    if (!templatesQ.isSuccess || consideredType.current === inspectionType) return;
    consideredType.current = inspectionType;
    const fallback = templates.find((tpl) => tpl.is_default);
    if (!fallback || loaded?.code === fallback.code) return;
    if (checklistIsPristine(rows, loaded?.rows ?? null)) load(fallback);
    // `rows` and `loaded` are read at the moment the type's templates arrive;
    // later edits must not re-trigger a load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatesQ.isSuccess, templates, inspectionType]);

  const choose = (code: string) => {
    const template = templates.find((tpl) => tpl.code === code);
    if (!template) return;
    if (checklistIsPristine(rows, loaded?.rows ?? null)) load(template);
    else setPending(template);
  };

  if (templates.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="inspection-template-picker">
      <label className="block text-xs font-medium text-content-secondary">
        <span className="mb-1 flex items-center gap-1.5">
          <ClipboardList size={12} />
          {t('inspections.checklist_template_label', { defaultValue: 'Checklist template' })}
        </span>
        <select
          value={loaded?.code ?? ''}
          onChange={(e) => choose(e.target.value)}
          className={SELECT_CLS}
          data-testid="inspection-template-select"
        >
          <option value="">
            {t('inspections.checklist_template_none', { defaultValue: 'No template' })}
          </option>
          {templates.map((tpl) => (
            <option key={tpl.code} value={tpl.code}>
              {tpl.name}
            </option>
          ))}
        </select>
      </label>
      {pending && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          role="alert"
          data-testid="inspection-template-replace"
        >
          <span className="flex-1">
            {t('inspections.checklist_template_replace_prompt', {
              defaultValue: 'Replace the checklist you edited with the items of "{{name}}"?',
              name: pending.name,
            })}
          </span>
          <Button size="sm" variant="primary" type="button" onClick={() => load(pending)}>
            {t('inspections.checklist_template_replace', { defaultValue: 'Replace' })}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setPending(null)}>
            {t('inspections.checklist_template_keep', { defaultValue: 'Keep mine' })}
          </Button>
        </div>
      )}
      {loaded && checklistIsPristine(rows, loaded.rows) && rows.length > 0 && (
        <p className="text-xs text-content-tertiary" data-testid="inspection-template-loaded">
          {t('inspections.checklist_template_loaded', {
            defaultValue: 'Loaded from the template "{{name}}". Edit, add or remove items as needed.',
            name: templates.find((tpl) => tpl.code === loaded.code)?.name ?? loaded.code,
          })}
        </p>
      )}
    </div>
  );
}
