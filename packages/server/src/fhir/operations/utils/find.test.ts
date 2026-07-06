// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { findAlignedSlotTimes, findSlotTimes } from './find';
import type { SchedulingParameters } from './scheduling-parameters';

describe('findAlignedSlotTimes', () => {
  test('can find a slot that exactly coincides with the interval', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T01:00:00Z') },
      { alignment: 60, offsetMinutes: 0, durationMinutes: 60 }
    );
    expect(slots).toEqual([{ start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T01:00:00Z') }]);
  });

  test('returns empty when the interval is less than the duration', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T01:00:00Z') },
      { alignment: 60, offsetMinutes: 0, durationMinutes: 90 }
    );
    expect(slots).toEqual([]);
  });

  test('it finds slots aligned to hours', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 60, offsetMinutes: 0, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T00:10:00Z') },
      { start: new Date('2025-12-01T01:00:00Z'), end: new Date('2025-12-01T01:10:00Z') },
    ]);
  });

  test('it finds slots aligned to half hours', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 30, offsetMinutes: 0, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T00:10:00Z') },
      { start: new Date('2025-12-01T00:30:00Z'), end: new Date('2025-12-01T00:40:00Z') },
      { start: new Date('2025-12-01T01:00:00Z'), end: new Date('2025-12-01T01:10:00Z') },
      { start: new Date('2025-12-01T01:30:00Z'), end: new Date('2025-12-01T01:40:00Z') },
    ]);
  });

  test('it finds slots aligned to quarter hours', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 15, offsetMinutes: 0, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T00:10:00Z') },
      { start: new Date('2025-12-01T00:15:00Z'), end: new Date('2025-12-01T00:25:00Z') },
      { start: new Date('2025-12-01T00:30:00Z'), end: new Date('2025-12-01T00:40:00Z') },
      { start: new Date('2025-12-01T00:45:00Z'), end: new Date('2025-12-01T00:55:00Z') },
      { start: new Date('2025-12-01T01:00:00Z'), end: new Date('2025-12-01T01:10:00Z') },
      { start: new Date('2025-12-01T01:15:00Z'), end: new Date('2025-12-01T01:25:00Z') },
      { start: new Date('2025-12-01T01:30:00Z'), end: new Date('2025-12-01T01:40:00Z') },
      { start: new Date('2025-12-01T01:45:00Z'), end: new Date('2025-12-01T01:55:00Z') },
    ]);
  });

  test('it finds slots aligned to ten minute marks', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 10, offsetMinutes: 0, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T00:10:00Z') },
      { start: new Date('2025-12-01T00:10:00Z'), end: new Date('2025-12-01T00:20:00Z') },
      { start: new Date('2025-12-01T00:20:00Z'), end: new Date('2025-12-01T00:30:00Z') },
      { start: new Date('2025-12-01T00:30:00Z'), end: new Date('2025-12-01T00:40:00Z') },
      { start: new Date('2025-12-01T00:40:00Z'), end: new Date('2025-12-01T00:50:00Z') },
      { start: new Date('2025-12-01T00:50:00Z'), end: new Date('2025-12-01T01:00:00Z') },
      { start: new Date('2025-12-01T01:00:00Z'), end: new Date('2025-12-01T01:10:00Z') },
      { start: new Date('2025-12-01T01:10:00Z'), end: new Date('2025-12-01T01:20:00Z') },
      { start: new Date('2025-12-01T01:20:00Z'), end: new Date('2025-12-01T01:30:00Z') },
      { start: new Date('2025-12-01T01:30:00Z'), end: new Date('2025-12-01T01:40:00Z') },
      { start: new Date('2025-12-01T01:40:00Z'), end: new Date('2025-12-01T01:50:00Z') },
      { start: new Date('2025-12-01T01:50:00Z'), end: new Date('2025-12-01T02:00:00Z') },
    ]);
  });

  test('offsetting alignment by five minutes', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 15, offsetMinutes: 5, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:05:00Z'), end: new Date('2025-12-01T00:15:00Z') },
      { start: new Date('2025-12-01T00:20:00Z'), end: new Date('2025-12-01T00:30:00Z') },
      { start: new Date('2025-12-01T00:35:00Z'), end: new Date('2025-12-01T00:45:00Z') },
      { start: new Date('2025-12-01T00:50:00Z'), end: new Date('2025-12-01T01:00:00Z') },
      { start: new Date('2025-12-01T01:05:00Z'), end: new Date('2025-12-01T01:15:00Z') },
      { start: new Date('2025-12-01T01:20:00Z'), end: new Date('2025-12-01T01:30:00Z') },
      { start: new Date('2025-12-01T01:35:00Z'), end: new Date('2025-12-01T01:45:00Z') },
      { start: new Date('2025-12-01T01:50:00Z'), end: new Date('2025-12-01T02:00:00Z') },
    ]);
  });

  test('offsetting alignment by 20 minutes', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 30, offsetMinutes: 20, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:20:00Z'), end: new Date('2025-12-01T00:30:00Z') },
      { start: new Date('2025-12-01T00:50:00Z'), end: new Date('2025-12-01T01:00:00Z') },
      { start: new Date('2025-12-01T01:20:00Z'), end: new Date('2025-12-01T01:30:00Z') },
      { start: new Date('2025-12-01T01:50:00Z'), end: new Date('2025-12-01T02:00:00Z') },
    ]);
  });

  test('offsetting alignment by a negative number', () => {
    // While we don't expect users to offset by a negative number, doing so can be helpful
    // for situations like "bufferBefore", where we want to check that availability starts
    // some time before the resulting slot start time.
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 30, offsetMinutes: -20, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:10:00Z'), end: new Date('2025-12-01T00:20:00Z') },
      { start: new Date('2025-12-01T00:40:00Z'), end: new Date('2025-12-01T00:50:00Z') },
      { start: new Date('2025-12-01T01:10:00Z'), end: new Date('2025-12-01T01:20:00Z') },
      { start: new Date('2025-12-01T01:40:00Z'), end: new Date('2025-12-01T01:50:00Z') },
    ]);
  });

  test('slot alignment by values that do not evenly divide an hour', () => {
    // Adapted from upstream #9488: slots align to a fifty-minute grid anchored
    // at UTC midnight. The first slot is found at `00:00`.
    const slots50Midnight = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T03:00:00Z') },
      { alignment: 50, offsetMinutes: 0, durationMinutes: 10 }
    );
    expect(slots50Midnight).toEqual([
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T00:10:00Z') },
      { start: new Date('2025-12-01T00:50:00Z'), end: new Date('2025-12-01T01:00:00Z') },
      { start: new Date('2025-12-01T01:40:00Z'), end: new Date('2025-12-01T01:50:00Z') },
      { start: new Date('2025-12-01T02:30:00Z'), end: new Date('2025-12-01T02:40:00Z') },
    ]);

    // When searching does not start at midnight, we still find slots aligned
    // to the same fifty-minute grid.
    const slots50Later = findAlignedSlotTimes(
      { start: new Date('2025-12-01T01:00:00Z'), end: new Date('2025-12-01T03:00:00Z') },
      { alignment: 50, offsetMinutes: 0, durationMinutes: 10 }
    );
    expect(slots50Later).toEqual([
      { start: new Date('2025-12-01T01:40:00Z'), end: new Date('2025-12-01T01:50:00Z') },
      { start: new Date('2025-12-01T02:30:00Z'), end: new Date('2025-12-01T02:40:00Z') },
    ]);
  });

  test('free fragment after a booking stays on the daily grid (ENG-908 regression)', () => {
    // A 16:40-19:20 America/Costa_Rica (UTC-6) availability block with 40-minute
    // slots, where 16:40-17:20 is already booked. The remaining fragment starts
    // at 17:20 local (23:20Z) and must yield 17:20/18:00/18:40 local - the same
    // grid as the unbooked block - NOT re-phase to 17:40/18:20 the way
    // minute-of-hour alignment does.
    const bookedFragment = findAlignedSlotTimes(
      { start: new Date('2026-07-22T23:20:00Z'), end: new Date('2026-07-23T01:20:00Z') },
      { alignment: 40, offsetMinutes: 0, durationMinutes: 40 }
    );
    expect(bookedFragment).toEqual([
      { start: new Date('2026-07-22T23:20:00Z'), end: new Date('2026-07-23T00:00:00Z') },
      { start: new Date('2026-07-23T00:00:00Z'), end: new Date('2026-07-23T00:40:00Z') },
      { start: new Date('2026-07-23T00:40:00Z'), end: new Date('2026-07-23T01:20:00Z') },
    ]);

    // The unbooked block produces the same grid, starting at 16:40 local. The
    // block spans UTC midnight; the grid stays continuous across it because 40
    // divides 1440.
    const unbookedBlock = findAlignedSlotTimes(
      { start: new Date('2026-07-22T22:40:00Z'), end: new Date('2026-07-23T01:20:00Z') },
      { alignment: 40, offsetMinutes: 0, durationMinutes: 40 }
    );
    expect(unbookedBlock).toEqual([
      { start: new Date('2026-07-22T22:40:00Z'), end: new Date('2026-07-22T23:20:00Z') },
      { start: new Date('2026-07-22T23:20:00Z'), end: new Date('2026-07-23T00:00:00Z') },
      { start: new Date('2026-07-23T00:00:00Z'), end: new Date('2026-07-23T00:40:00Z') },
      { start: new Date('2026-07-23T00:40:00Z'), end: new Date('2026-07-23T01:20:00Z') },
    ]);
  });

  test('alignment not dividing 1440: grid continues across UTC midnight within one interval', () => {
    // 50 does not divide 1440, so a daily grid cannot be continuous across
    // midnight. Within a single contiguous interval we keep stepping the grid
    // of the day the interval started in (23:20 -> 00:10 -> 01:00 -> 01:50).
    // Upstream #9488 instead re-anchors at each midnight (00:00/00:50/01:40);
    // the difference only affects alignments that do not divide 1440, which no
    // real configuration uses, and disappears on upgrade to >= 5.1.19.
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T23:00:00Z'), end: new Date('2025-12-02T02:00:00Z') },
      { alignment: 50, offsetMinutes: 0, durationMinutes: 10 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T23:20:00Z'), end: new Date('2025-12-01T23:30:00Z') },
      { start: new Date('2025-12-02T00:10:00Z'), end: new Date('2025-12-02T00:20:00Z') },
      { start: new Date('2025-12-02T01:00:00Z'), end: new Date('2025-12-02T01:10:00Z') },
      { start: new Date('2025-12-02T01:50:00Z'), end: new Date('2025-12-02T02:00:00Z') },
    ]);
  });

  test('errors when alignment is zero', () => {
    expect(() => {
      findAlignedSlotTimes(
        { start: new Date('2025-12-01'), end: new Date('2025-12-08') },
        { alignment: 0, offsetMinutes: 0, durationMinutes: 10 }
      );
    }).toThrow('Invalid alignment');
  });

  test('maxCount option is respected', () => {
    const slots = findAlignedSlotTimes(
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T02:00:00Z') },
      { alignment: 15, offsetMinutes: 0, durationMinutes: 10, maxCount: 5 }
    );
    expect(slots).toEqual([
      { start: new Date('2025-12-01T00:00:00Z'), end: new Date('2025-12-01T00:10:00Z') },
      { start: new Date('2025-12-01T00:15:00Z'), end: new Date('2025-12-01T00:25:00Z') },
      { start: new Date('2025-12-01T00:30:00Z'), end: new Date('2025-12-01T00:40:00Z') },
      { start: new Date('2025-12-01T00:45:00Z'), end: new Date('2025-12-01T00:55:00Z') },
      { start: new Date('2025-12-01T01:00:00Z'), end: new Date('2025-12-01T01:10:00Z') },
    ]);
  });
});

describe('findSlotTimes', () => {
  test('finds slots of the requested duration', () => {
    const schedulingParameters: SchedulingParameters = {
      availability: [],
      duration: 20,
      bufferBefore: 0,
      bufferAfter: 0,
      alignmentInterval: 60,
      alignmentOffset: 0,
      serviceType: [],
    };
    const availability = [{ start: new Date('2025-12-01T12:00:00Z'), end: new Date('2025-12-01T15:00:00Z') }];
    expect(findSlotTimes(schedulingParameters, availability)).toEqual([
      { start: new Date('2025-12-01T12:00:00Z'), end: new Date('2025-12-01T12:20:00Z') },
      { start: new Date('2025-12-01T13:00:00Z'), end: new Date('2025-12-01T13:20:00Z') },
      { start: new Date('2025-12-01T14:00:00Z'), end: new Date('2025-12-01T14:20:00Z') },
    ]);
  });

  test('can offset alignment', () => {
    const schedulingParameters: SchedulingParameters = {
      availability: [],
      duration: 20,
      bufferBefore: 0,
      bufferAfter: 0,
      alignmentInterval: 30,
      alignmentOffset: 15,
      serviceType: [],
    };
    const availability = [{ start: new Date('2025-12-01T12:00:00Z'), end: new Date('2025-12-01T15:00:00Z') }];
    expect(findSlotTimes(schedulingParameters, availability)).toEqual([
      { start: new Date('2025-12-01T12:15:00Z'), end: new Date('2025-12-01T12:35:00Z') },
      { start: new Date('2025-12-01T12:45:00Z'), end: new Date('2025-12-01T13:05:00Z') },
      { start: new Date('2025-12-01T13:15:00Z'), end: new Date('2025-12-01T13:35:00Z') },
      { start: new Date('2025-12-01T13:45:00Z'), end: new Date('2025-12-01T14:05:00Z') },
      { start: new Date('2025-12-01T14:15:00Z'), end: new Date('2025-12-01T14:35:00Z') },
    ]);
  });

  test('can require buffer time around the slot', () => {
    const schedulingParameters: SchedulingParameters = {
      availability: [],
      duration: 20,
      bufferBefore: 20,
      bufferAfter: 30,
      alignmentInterval: 30,
      alignmentOffset: 15,
      serviceType: [],
    };
    const availability = [{ start: new Date('2025-12-01T12:00:00Z'), end: new Date('2025-12-01T15:00:00Z') }];
    expect(findSlotTimes(schedulingParameters, availability)).toEqual([
      // Slot from 12:15-12:35 not found because it doesn't have enough bufferBefore
      { start: new Date('2025-12-01T12:45:00Z'), end: new Date('2025-12-01T13:05:00Z') },
      { start: new Date('2025-12-01T13:15:00Z'), end: new Date('2025-12-01T13:35:00Z') },
      { start: new Date('2025-12-01T13:45:00Z'), end: new Date('2025-12-01T14:05:00Z') },
      // Slot from 14:15-14:35 not found because it doesn't have enough bufferAfter
    ]);
  });

  test('respects the maxCount option', () => {
    const schedulingParameters: SchedulingParameters = {
      availability: [],
      duration: 20,
      bufferBefore: 0,
      bufferAfter: 0,
      alignmentInterval: 30,
      alignmentOffset: 15,
      serviceType: [],
    };
    const availability = [{ start: new Date('2025-12-01T12:00:00Z'), end: new Date('2025-12-01T15:00:00Z') }];
    expect(findSlotTimes(schedulingParameters, availability, { maxCount: 3 })).toEqual([
      { start: new Date('2025-12-01T12:15:00Z'), end: new Date('2025-12-01T12:35:00Z') },
      { start: new Date('2025-12-01T12:45:00Z'), end: new Date('2025-12-01T13:05:00Z') },
      { start: new Date('2025-12-01T13:15:00Z'), end: new Date('2025-12-01T13:35:00Z') },
    ]);
  });
});
