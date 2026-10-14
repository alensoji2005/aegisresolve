import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApprovalProgress } from './ApprovalProgress';
import { sortFactors } from './RiskBars';

const so = { role: 'SAFETY_OFFICER' as const, signer: 'safety1', at: '2026-10-14T09:00:00Z' };
const rb1 = { role: 'REVIEW_BOARD' as const, signer: 'board1', at: '2026-10-14T10:00:00Z' };

describe('ApprovalProgress', () => {
  it('shows 2 of 3 for HIGH with SO + one RB', () => {
    render(<ApprovalProgress level="HIGH" approvals={[so, rb1]} />);
    expect(screen.getByText('2 of 3 signatures')).toBeTruthy();
  });
  it('does not count the same board member twice', () => {
    render(<ApprovalProgress level="HIGH" approvals={[so, rb1, { ...rb1 }]} />);
    expect(screen.getByText('2 of 3 signatures')).toBeTruthy();
  });
});

describe('RiskBars', () => {
  it('sorts by contribution', () => {
    const f = (name: string, contribution: number) => ({ name, weight: 0.1, value: 1, contribution });
    expect(sortFactors([f('a', 0.1), f('b', 0.24), f('c', 0)]).map((x) => x.name)).toEqual(['b', 'a', 'c']);
  });
});
