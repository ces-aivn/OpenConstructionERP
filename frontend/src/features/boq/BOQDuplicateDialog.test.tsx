// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOQDuplicateDialog, defaultCopyName } from './BOQDuplicateDialog';

afterEach(() => cleanup());

describe('defaultCopyName', () => {
  it('names the copy in the reader\'s language', () => {
    const vi_ = (_key: string, o?: Record<string, string>) => `${o?.name} (bản sao)`;
    expect(defaultCopyName('Landmark 81', vi_)).toBe('Landmark 81 (bản sao)');
  });
});

describe('BOQDuplicateDialog', () => {
  it('proposes "<name> (copy)" and copies only once the name is confirmed', () => {
    const onSubmit = vi.fn();
    render(<BOQDuplicateDialog baseName="Landmark 81" isPending={false} onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByTestId('boq-duplicate-name') as HTMLInputElement;
    expect(input.value).toBe('Landmark 81 (copy)');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  Landmark 81 - phương án thép  ' } });
    fireEvent.click(screen.getByTestId('boq-duplicate-submit'));
    expect(onSubmit).toHaveBeenCalledWith('Landmark 81 - phương án thép');
  });

  it('does not copy under an empty name', () => {
    const onSubmit = vi.fn();
    render(<BOQDuplicateDialog baseName="B" isPending={false} onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('boq-duplicate-name'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByTestId('boq-duplicate-name').closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes on Escape without copying', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<BOQDuplicateDialog baseName="B" isPending={false} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('boq-duplicate-name'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
