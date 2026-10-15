import { describe, expect, it } from 'vitest';
import { describeReason } from './Anomalies';

describe('describeReason', () => {
  it('reads as a sentence fragment with signed z', () => {
    expect(describeReason({ feature: 'evidence_downloads', value: 14, baseline: 0.3, z: 30.7, basis: 'own history' }))
      .toBe('evidence downloads: 14 vs usual 0.3 (z +30.7, own history)');
  });
});
