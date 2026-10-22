// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict, isValid as isValidDate, parseISO } from 'date-fns';
import { Layers } from 'lucide-react';
import { Card } from '@/shared/ui';
import { getIntlLocale } from '@/shared/lib/formatters';
import { formatCompactMoney, toNum } from '@/shared/lib/money';
import { getDateFnsLocale } from '@/shared/lib/dateFnsLocale';

export interface CompactProjectCardProps {
  id: string;
  name: string;
  description?: string;
  region?: string;
  currency?: string;
  classificationStandard?: string;
  status?: string;
  boqCount?: number;
  boqTotalValue?: number | string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  style?: React.CSSProperties;
}

// One of three places that turn a stored classification standard into a name
// for a reader. All three held the same three entries while the picker on
// CreateProjectPage could write eighteen, so every project on a standard
// outside the legacy trio showed its raw identifier on the card. The fallback
// below keeps that from being blank, which is why nobody noticed.
const standardLabels: Record<string, string> = {
  din276: 'DIN 276',
  nrm: 'NRM',
  masterformat: 'MasterFormat',
  uniformat: 'UniFormat',
  uniclass: 'Uniclass',
  omniclass: 'OmniClass',
  gb50500: 'GB/T',
  tetelrend: 'Tételrend',
  gesn: 'GESN / FER',
  bc3: 'BC3',
  vn_tt12: 'TT 12/2021/TT-BXD',
  untec: 'UNTEC',
  dpgf: 'DPGF',
  voci: 'VOCI',
  onorm: 'ÖNORM',
  gaeb: 'GAEB',
  sinapi: 'SINAPI',
  sekisan: 'Sekisan',
  kbim: 'KBIM',
  birimfiyat: 'Birim Fiyat',
  nlsfb: 'NL/SfB',
  knr: 'KNR',
};

export function CompactProjectCard({
  id,
  name,
  description,
  region,
  currency,
  classificationStandard,
  status,
  boqCount,
  boqTotalValue,
  updatedAt,
  createdAt,
  style,
}: CompactProjectCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const modifiedSource = updatedAt || createdAt;
  const modifiedDate = modifiedSource ? parseISO(modifiedSource) : null;
  const relativeModified =
    modifiedDate && isValidDate(modifiedDate)
      ? formatDistanceToNowStrict(modifiedDate, {
          addSuffix: true,
          // Without `locale` date-fns answers in en-US, so this line stayed
          // "3 hours ago" next to an absolute date that was already localised.
          locale: getDateFnsLocale(),
        })
      : null;
  const absoluteModified =
    modifiedDate && isValidDate(modifiedDate)
      ? modifiedDate.toLocaleDateString(getIntlLocale())
      : '';

  const numericValue = toNum(boqTotalValue);
  const hasValue = numericValue > 0;

  // Plain facts in one line instead of coloured chips: standard · region · currency.
  const facts = [
    classificationStandard ? standardLabels[classificationStandard] ?? classificationStandard : null,
    region || null,
    currency || null,
  ].filter(Boolean) as string[];

  return (
    <Card
      hoverable
      padding="none"
      className="group relative flex cursor-pointer flex-col overflow-hidden hover:border-content-quaternary focus-within:ring-2 focus-within:ring-oe-blue/30 motion-safe:transition-colors"
      style={style}
      onClick={() => navigate(`/projects/${id}`)}
    >
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-content-primary" title={name}>
            {name}
          </h3>
          {status === 'archived' && (
            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-2xs font-medium text-content-tertiary">
              {t('projects.status_archived', { defaultValue: 'Archived' })}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1 line-clamp-1 text-xs leading-snug text-content-secondary">{description}</p>
        )}
        {facts.length > 0 && (
          <p className="mt-2 truncate text-xs text-content-tertiary">{facts.join(' · ')}</p>
        )}
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-border-light px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-content-tertiary">
            {t('projects.card_total_value', { defaultValue: 'Total value' })}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className={`text-base font-semibold tabular-nums ${hasValue ? 'text-content-primary' : 'text-content-tertiary'}`}>
              {hasValue ? formatCompactMoney(numericValue, currency) : '—'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-2xs text-content-tertiary">
          {typeof boqCount === 'number' && boqCount > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Layers size={11} strokeWidth={2} />
              {boqCount} {t('projects.boq_short', { defaultValue: 'BOQs' })}
            </span>
          )}
          {relativeModified && <span title={absoluteModified}>{relativeModified}</span>}
        </div>
      </div>
    </Card>
  );
}
