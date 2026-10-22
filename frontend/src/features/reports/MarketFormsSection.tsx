// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The forms of the project's market on the Reports page.
 *
 * A Vietnamese project gets the cost estimate summary in the shape of
 * Circular 11/2021 (from the chosen bill) and Appendix 03a (from a progress
 * claim); an American one gets AIA G702/G703 (from a progress claim). The
 * server decides which forms apply from the project's country and lists the
 * project's progress claims alongside, so the section needs one request.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Landmark } from 'lucide-react';

import { apiGet, downloadWithAuth } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { claimLabel, marketFormUrl, type MarketFormInfo, type MarketFormsResponse } from './marketForms';

const FORM_TEXT: Record<string, { title: string; description: string }> = {
  vn_estimate_summary: {
    title: 'Cost estimate summary (Circular 11/2021)',
    description:
      'Direct cost by materials, labour and plant, then indirect cost, pre-determined taxable income and VAT, from the chosen BOQ and its markups.',
  },
  vn_payment_03a: {
    title: 'Completed work valuation (Appendix 03a)',
    description:
      'Contract value, value done before this payment, in this payment and to date, and the amount requested, from a progress claim.',
  },
  aia_g702_g703: {
    title: 'AIA G702 / G703 payment application',
    description: 'Application and certificate for payment with its continuation sheet, from a progress claim.',
  },
};

export function MarketFormsSection({ projectId, boqId }: { projectId: string; boqId: string }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [claimId, setClaimId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['reporting', 'market-forms', projectId],
    queryFn: () => apiGet<MarketFormsResponse>(`/v1/reporting/market-forms/?project_id=${encodeURIComponent(projectId)}`),
    enabled: !!projectId,
    retry: false,
    meta: { suppressGlobalErrorToast: true },
  });

  if (!data || data.forms.length === 0) return null;
  const claims = data.claims ?? [];
  const activeClaim = claimId || claims[0]?.id || '';
  const needsClaim = data.forms.some((f) => f.source === 'claim');

  const download = async (form: MarketFormInfo, format: string) => {
    const url = marketFormUrl(form, format, { boqId, claimId: activeClaim });
    if (!url) return;
    const key = `${form.id}:${format}`;
    setBusy(key);
    try {
      await downloadWithAuth(url, `${form.id}.${format}`);
    } catch (err) {
      addToast({
        type: 'error',
        title: t('reports.market_forms.download_failed', { defaultValue: 'Could not download the form' }),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="rounded-xl border border-border-light bg-surface-elevated p-5 shadow-sm"
      aria-labelledby="market-forms-title"
      data-testid="market-forms"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-oe-blue/10">
            <Landmark size={20} className="text-oe-blue" strokeWidth={1.75} />
          </div>
          <div>
            <h2 id="market-forms-title" className="text-base font-semibold text-content-primary">
              {t('reports.market_forms.title', { defaultValue: 'Market forms' })}
            </h2>
            <p className="mt-0.5 text-sm text-content-secondary">
              {t('reports.market_forms.hint', {
                defaultValue: 'The forms your market expects, filled from this project’s figures.',
              })}
            </p>
          </div>
        </div>
        {needsClaim && claims.length > 0 && (
          <label className="flex min-w-0 flex-col gap-1 text-xs text-content-secondary">
            {t('reports.market_forms.choose_claim', { defaultValue: 'Progress claim' })}
            <select
              value={activeClaim}
              onChange={(e) => setClaimId(e.target.value)}
              data-testid="market-forms-claim"
              className="h-9 max-w-xs rounded-lg border border-border bg-surface-primary px-2 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue"
            >
              {claims.map((c) => (
                <option key={c.id} value={c.id}>
                  {claimLabel(c)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.forms.map((form) => {
          const text = FORM_TEXT[form.id] ?? { title: form.id, description: '' };
          const missing =
            form.source === 'boq'
              ? !boqId && t('reports.market_forms.needs_boq', { defaultValue: 'Choose a BOQ above.' })
              : !activeClaim &&
                t('reports.market_forms.no_claims', {
                  defaultValue: 'No progress claims yet. Create one under Contracts.',
                });
          return (
            <li
              key={form.id}
              data-testid={`market-form-${form.id}`}
              className="flex flex-col justify-between rounded-lg border border-border-light p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={16} className="shrink-0 text-oe-blue" aria-hidden />
                  <h3 className="text-sm font-semibold text-content-primary">
                    {t(`reports.market_forms.${form.id}.title`, { defaultValue: text.title })}
                  </h3>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                  {t(`reports.market_forms.${form.id}.description`, { defaultValue: text.description })}
                </p>
                {missing && <p className="mt-2 text-xs text-content-tertiary">{missing}</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {form.formats.map((format) => (
                  <button
                    key={format}
                    type="button"
                    disabled={!!missing || busy !== null}
                    onClick={() => void download(form, format)}
                    data-testid={`market-form-${form.id}-${format}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-content-primary hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={12} aria-hidden />
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
