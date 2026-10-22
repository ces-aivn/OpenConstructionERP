// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Two small rules on the meetings register: a pasted attendee list separated
// by semicolons or commas is several people, and a meeting whose date has
// passed while it still reads "scheduled" is pointed out, never silently
// changed.
import { describe, it, expect } from 'vitest';
import { splitAttendeeNames, meetingNeedsStatusUpdate } from './MeetingsPage';

describe('splitAttendeeNames', () => {
  it('counts each name separated by a semicolon, a comma or a line break', () => {
    expect(splitAttendeeNames('Turner; StadCo; AECOM')).toEqual(['Turner', 'StadCo', 'AECOM']);
    expect(splitAttendeeNames('Turner, StadCo\nAECOM')).toEqual(['Turner', 'StadCo', 'AECOM']);
    expect(splitAttendeeNames(' ;\n , ')).toEqual([]);
  });
});

describe('meetingNeedsStatusUpdate', () => {
  const now = new Date(2026, 9, 22, 10, 0, 0);

  it('flags a past meeting that still says it is to come', () => {
    expect(meetingNeedsStatusUpdate({ status: 'scheduled', date: '2018-03-14' }, now)).toBe(true);
    expect(meetingNeedsStatusUpdate({ status: 'in_progress', date: '2018-03-14T09:00:00' }, now)).toBe(true);
  });

  it('leaves alone a held, cancelled, today or future meeting', () => {
    expect(meetingNeedsStatusUpdate({ status: 'completed', date: '2018-03-14' }, now)).toBe(false);
    expect(meetingNeedsStatusUpdate({ status: 'cancelled', date: '2018-03-14' }, now)).toBe(false);
    expect(meetingNeedsStatusUpdate({ status: 'scheduled', date: '2026-10-22' }, now)).toBe(false);
    expect(meetingNeedsStatusUpdate({ status: 'scheduled', date: '2026-11-01' }, now)).toBe(false);
  });
});
