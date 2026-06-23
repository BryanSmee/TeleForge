import { describe, it, expect } from '@jest/globals';
import { formatBytes, formatDuration, formatProgress, formatRelative } from '../format';

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

describe('formatBytes', () => {
  it('scales into B/KB/MB and rounds sensibly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

describe('formatRelative', () => {
  const now = 1_000_000 * 1000; // fixed "now" in ms

  it('formats minute/hour/day deltas', () => {
    expect(formatRelative(1_000_000 - 30, now)).toBe('just now');
    expect(formatRelative(1_000_000 - 5 * 60, now)).toBe('5m ago');
    expect(formatRelative(1_000_000 - 3 * 3600, now)).toBe('3h ago');
    expect(formatRelative(1_000_000 - 2 * 86400, now)).toBe('2d ago');
  });

  it('returns empty for missing timestamps', () => {
    expect(formatRelative(0, now)).toBe('');
    expect(formatRelative(NaN, now)).toBe('');
  });
});
