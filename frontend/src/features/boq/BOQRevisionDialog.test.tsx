// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BOQRevisionDialog, revisionRequest } from './BOQRevisionDialog';

describe('revisionRequest', () => {
  it('drops empty fields so the server numbers the revision itself', () => {
    expect(revisionRequest('   ', '')).toEqual({});
  });

  it('keeps a trimmed name and reason', () => {
    expect(revisionRequest('  Tender issue  ', ' client changed the facade ')).toEqual({
      name: 'Tender issue',
      reason: 'client changed the facade',
    });
  });
});

describe('BOQRevisionDialog', () => {
  it('creates nothing until the form is confirmed, then sends the name and reason', () => {
    const onSubmit = vi.fn();
    render(<BOQRevisionDialog baseName="Landmark 81" isPending={false} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('boq-revision-name').getAttribute('placeholder')).toContain('Landmark 81');

    fireEvent.change(screen.getByTestId('boq-revision-reason'), { target: { value: 'Re-measured basement' } });
    fireEvent.click(screen.getByTestId('boq-revision-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ reason: 'Re-measured basement' });
  });

  it('closes on cancel without creating a revision', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<BOQRevisionDialog baseName="B" isPending={false} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
