// The market forms download from the bill or the progress claim they are
// drawn from, and wait until one is chosen.
import { describe, expect, it } from 'vitest';
import { claimLabel, marketFormUrl, type MarketFormInfo } from '../marketForms';

const summary: MarketFormInfo = { id: 'vn_estimate_summary', market: 'VN', source: 'boq', formats: ['xlsx'] };
const appendix: MarketFormInfo = { id: 'vn_payment_03a', market: 'VN', source: 'claim', formats: ['xlsx'] };
const aia: MarketFormInfo = { id: 'aia_g702_g703', market: 'US', source: 'claim', formats: ['xlsx', 'pdf'] };

describe('marketFormUrl', () => {
  it('draws the estimate summary from the chosen bill', () => {
    expect(marketFormUrl(summary, 'xlsx', { boqId: 'b1', claimId: '' })).toBe(
      '/api/v1/reporting/market-forms/vn-estimate-summary/?boq_id=b1',
    );
    expect(marketFormUrl(summary, 'xlsx', { boqId: '', claimId: 'c1' })).toBeNull();
  });

  it('draws the claim forms from the chosen claim, the AIA PDF from the contracts module', () => {
    expect(marketFormUrl(appendix, 'xlsx', { boqId: '', claimId: 'c1' })).toBe(
      '/api/v1/reporting/market-forms/vn-payment-03a/?claim_id=c1',
    );
    expect(marketFormUrl(aia, 'xlsx', { boqId: '', claimId: 'c1' })).toBe(
      '/api/v1/reporting/market-forms/aia-g702-g703/?claim_id=c1',
    );
    expect(marketFormUrl(aia, 'pdf', { boqId: '', claimId: 'c1' })).toBe(
      '/api/v1/contracts/progress-claims/c1/aia-application/pdf',
    );
    expect(marketFormUrl(appendix, 'xlsx', { boqId: 'b1', claimId: '' })).toBeNull();
  });
});

describe('claimLabel', () => {
  it('names the contract, the claim and its period end', () => {
    expect(
      claimLabel({
        id: 'c1',
        claim_number: 'PC-03',
        period_end: '2026-09-30',
        status: 'approved',
        contract_code: 'HĐ-01',
        contract_title: 'Phần thô',
      }),
    ).toBe('HĐ-01 Phần thô · PC-03 · 2026-09-30');
  });
});
