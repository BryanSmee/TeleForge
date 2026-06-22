import { describe, it, expect } from '@jest/globals';
import { formatDuration, formatProgress } from '../format';

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(5025)).toBe('1h 23m');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(310)).toBe('5m 10s');
  });

  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('handles zero and invalid input', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-10)).toBe('0s');
    expect(formatDuration(NaN)).toBe('0s');
  });
});

describe('formatProgress', () => {
  it('rounds and clamps to 0–100', () => {
    expect(formatProgress(42.6)).toBe(43);
    expect(formatProgress(-5)).toBe(0);
    expect(formatProgress(150)).toBe(100);
    expect(formatProgress(NaN)).toBe(0);
  });
});
