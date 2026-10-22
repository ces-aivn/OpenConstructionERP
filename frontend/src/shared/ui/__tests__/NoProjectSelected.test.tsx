// Every project-scoped screen says "no project selected" the same way and
// offers the same action: open the header project picker, or the project list
// when no picker is on screen.
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  NoProjectSelected,
  OPEN_PROJECT_PICKER_EVENT,
  requestProjectPicker,
  type OpenProjectPickerDetail,
} from '../NoProjectSelected';

afterEach(cleanup);

function mount() {
  render(
    <MemoryRouter initialEntries={['/reports']}>
      <Routes>
        <Route path="/reports" element={<NoProjectSelected />} />
        <Route path="/projects" element={<p>project list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NoProjectSelected', () => {
  it('says one thing with one action', () => {
    mount();
    expect(screen.getByText('No project selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a project' })).toBeTruthy();
  });

  it('opens the project list when no picker answers', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a project' }));
    expect(screen.getByText('project list')).toBeTruthy();
  });

  it('stays on the page when the header picker opens', () => {
    const answer = (e: Event) => {
      (e as CustomEvent<OpenProjectPickerDetail>).detail.handled = true;
    };
    window.addEventListener(OPEN_PROJECT_PICKER_EVENT, answer);
    try {
      expect(requestProjectPicker()).toBe(true);
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Choose a project' }));
      expect(screen.queryByText('project list')).toBeNull();
    } finally {
      window.removeEventListener(OPEN_PROJECT_PICKER_EVENT, answer);
    }
  });
});
