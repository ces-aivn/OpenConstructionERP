// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/** Market report forms: what the server lists, and where each one downloads. */

export interface MarketFormInfo {
  id: string;
  market: string;
  source: 'boq' | 'claim';
  formats: string[];
}

export interface MarketFormClaim {
  id: string;
  claim_number: string;
  period_end: string;
  status: string;
  contract_code: string;
  contract_title: string;
}

export interface MarketFormsResponse {
  market: string | null;
  forms: MarketFormInfo[];
  claims: MarketFormClaim[];
}

/** The download URL of a form, or null while what it is drawn from is missing. */
export function marketFormUrl(
  form: MarketFormInfo,
  format: string,
  { boqId, claimId }: { boqId: string; claimId: string },
): string | null {
  if (form.source === 'boq') {
    return boqId ? `/api/v1/reporting/market-forms/vn-estimate-summary/?boq_id=${encodeURIComponent(boqId)}` : null;
  }
  if (!claimId) return null;
  const claim = encodeURIComponent(claimId);
  if (form.id === 'aia_g702_g703') {
    return format === 'pdf'
      ? `/api/v1/contracts/progress-claims/${claim}/aia-application/pdf`
      : `/api/v1/reporting/market-forms/aia-g702-g703/?claim_id=${claim}`;
  }
  return `/api/v1/reporting/market-forms/vn-payment-03a/?claim_id=${claim}`;
}

/** How a progress claim reads in the picker: contract, claim number, period end. */
export function claimLabel(c: MarketFormClaim): string {
  const contract = [c.contract_code, c.contract_title].filter(Boolean).join(' ');
  return [contract, c.claim_number, c.period_end].filter(Boolean).join(' · ');
}

