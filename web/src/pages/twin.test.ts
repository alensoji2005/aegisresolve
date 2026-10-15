import { describe, expect, it } from 'vitest';
import { bayState } from './DigitalTwin';

const bay = { id: 'DEP-02/MAG-01/BAY-04', temp: 20, rh: 55, readingAt: null, inBoundsNow: true, excursionHours7d: 0, openCases: 0, lots: 3, anomalies7d: 0 };

describe('bayState', () => {
  it('ranks conditions worst first', () => {
    expect(bayState(bay).label).toBe('Normal');
    expect(bayState({ ...bay, openCases: 1 }).label).toBe('Open case / anomaly');
    expect(bayState({ ...bay, excursionHours7d: 48 }).label).toBe('Recent excursion');
    expect(bayState({ ...bay, excursionHours7d: 48, openCases: 2 }).label).toBe('Excursion + open case');
    expect(bayState({ ...bay, inBoundsNow: false, openCases: 2 }).label).toBe('Out of bounds now');
  });
});
