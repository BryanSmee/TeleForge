/**
 * Small formatting helpers for printer status display.
 * Pure functions, no React Native deps — easy to unit test.
 */

/** Format a duration in seconds as `1h 23m` / `5m 10s` / `45s`. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0s';
  }
  const seconds = Math.floor(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

/** Format an absolute epoch-ms time as a local `HH:MM` clock string. */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Clamp a progress value to a 0–100 integer percentage. */
export function formatProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

/** Format a byte count as `0 B` / `12 KB` / `3.4 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded = value >= 10 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** Format an epoch-seconds time as a relative `5m ago` / `3h ago` / `2d ago`, else a date. */
export function formatRelative(epochSec: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(epochSec) || epochSec <= 0) {
    return '';
  }
  const diffSec = Math.max(0, Math.floor(nowMs / 1000 - epochSec));
  if (diffSec < 60) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(epochSec * 1000).toLocaleDateString();
}
