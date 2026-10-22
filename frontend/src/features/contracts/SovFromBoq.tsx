// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Draw a contract's schedule of values from the bill of quantities it prices.
//
// The chain contract -> schedule of values -> progress -> payment application
// starts here. Typed in by hand, a schedule also had to be linked to the bill
// line by line before "Populate from progress" could bill anything, so in
// practice a claim was raised with nothing to bill. The server writes one line
// per priced position, linked to it; these are the two places a person asks
// for that: the create form, and the schedule of a draft contract.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTree } from 'lucide-react';

import { Button } from '@/shared/ui';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { drawContractLinesFromBoq } from './api';

export interface ProjectBoq {
  id: string;
  name: string;
}

/** The project's bills, under the key the BOQ link editor reads them by. */
export function useProjectBoqs(projectId: string) {
  return useQuery({
    queryKey: ['boqs', projectId],
    queryFn: () => apiGet<ProjectBoq[]>(`/v1/boq/boqs/?project_id=${encodeURIComponent(projectId)}`),
    enabled: !!projectId,
  });
}

const SELECT_CLS =
  'h-9 w-full rounded-md border border-border bg-surface-primary px-2 text-sm text-content-primary';

/**
 * The create form's choice: draw the schedule from a bill, or enter it later.
 * An empty value means "later".
 */
export function SovSourceSelect({
  projectId,
  value,
  onChange,
  className = SELECT_CLS,
}: {
  projectId: string;
  value: string;
  onChange: (boqId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const boqsQ = useProjectBoqs(projectId);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      data-testid="contract-sov-source"
      aria-label={t('contracts.sov_source', { defaultValue: 'Schedule of values' })}
    >
      <option value="">
        {t('contracts.sov_source_later', { defaultValue: 'Enter the lines later' })}
      </option>
      {(boqsQ.data ?? []).map((b) => (
        <option key={b.id} value={b.id}>
          {t('contracts.sov_source_boq', { defaultValue: 'From BOQ: {{name}}', name: b.name })}
        </option>
      ))}
    </select>
  );
}

/**
 * "Draw from BOQ" on a draft contract's schedule. Positions some line already
 * links to are skipped by the server, so drawing again adds only what is new.
 */
export function SovFromBoqAction({
  contractId,
  projectId,
  onDrawn,
}: {
  contractId: string;
  projectId: string;
  /** Called once the lines are written, to re-read what they make stale. */
  onDrawn: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const boqsQ = useProjectBoqs(projectId);
  const boqs = boqsQ.data ?? [];
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const boqId = picked || boqs[0]?.id || '';

  const drawMut = useMutation({
    mutationFn: () => drawContractLinesFromBoq(contractId, { boq_id: boqId }),
    onSuccess: (result) => {
      onDrawn();
      // The contract's value follows the schedule when none was typed.
      qc.invalidateQueries({ queryKey: ['contracts', 'list'] });
      addToast({
        type: 'success',
        title:
          result.created > 0
            ? t('contracts.sov_drawn', {
                defaultValue: '{{count}} lines drawn from the BOQ',
                count: result.created,
              })
            : t('contracts.sov_drawn_nothing_new', {
                defaultValue: 'Every priced position of this BOQ is already on the schedule.',
              }),
      });
      setOpen(false);
    },
    onError: (err) => addToast({ type: 'error', title: getErrorMessage(err) }),
  });

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={<ListTree size={14} />}
        onClick={() => setOpen(true)}
        data-testid="sov-draw-from-boq"
      >
        {t('contracts.sov_draw_from_boq', { defaultValue: 'Draw from BOQ' })}
      </Button>
    );
  }

  return (
    <div
      className="mb-2 flex flex-wrap items-end gap-2 rounded-md border border-border-light bg-surface-secondary p-2"
      data-testid="sov-draw-from-boq-panel"
    >
      {boqs.length === 0 && !boqsQ.isLoading ? (
        <p className="text-sm text-content-tertiary">
          {t('contracts.sov_no_boq', {
            defaultValue: 'This project has no bill of quantities yet. Create one in the BOQ module first.',
          })}
        </p>
      ) : (
        <label className="min-w-[14rem] flex-1 text-xs text-content-secondary">
          {t('contracts.sov_pick_boq', { defaultValue: 'Bill of quantities' })}
          <select
            value={boqId}
            onChange={(e) => setPicked(e.target.value)}
            className={`mt-1 ${SELECT_CLS}`}
            data-testid="sov-draw-boq-select"
          >
            {boqs.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="basis-full text-xs text-content-tertiary">
        {t('contracts.sov_draw_hint', {
          defaultValue:
            'One line per priced position, at its quantity and rate, linked to the position so claims can be billed from progress.',
        })}
      </p>
      <Button
        size="sm"
        variant="primary"
        onClick={() => drawMut.mutate()}
        loading={drawMut.isPending}
        disabled={!boqId}
        data-testid="sov-draw-confirm"
      >
        {t('contracts.sov_draw_confirm', { defaultValue: 'Draw lines' })}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={drawMut.isPending}>
        {t('common.cancel', { defaultValue: 'Cancel' })}
      </Button>
    </div>
  );
}
