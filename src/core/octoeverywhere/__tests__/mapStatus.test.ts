import { describe, it, expect } from '@jest/globals';
import { mapStatus } from '../mapStatus';
import { OeFeature, type RawStatusResult } from '../raw';

const FEATURES = OeFeature.LIGHT_CONTROL | OeFeature.AXIS_MOVEMENT | OeFeature.HOMING | OeFeature.TEMPERATURE_CONTROL;

// Mirrors the real idle payload captured from the CC2 during the spike:
// stale CurrentPrint fields (CurrentLayer 515, DurationSec 7159) while idle.
const idleStatus: RawStatusResult = {
  JobStatus: {
    State: 'idle',
    SubState: null,
    Error: null,
    Lights: [{ Name: 'chamber', On: true }],
    CurrentPrint: {
      Progress: 0,
      DurationSec: 7159,
      TimeLeftSec: 0,
      FileName: '',
      CurrentLayer: 515,
      TotalLayers: 0,
      Temps: {
        BedActual: 38,
        BedTarget: 0,
        HotendActual: 40,
        HotendTarget: 0,
        ChamberActual: 31,
        ChamberTarget: 0,
      },
    },
  },
  PlatformVersion: 'Elegoo-CC2',
  Features: FEATURES,
};

const printingStatus: RawStatusResult = {
  JobStatus: {
    State: 'printing',
    SubState: null,
    Error: null,
    CurrentPrint: {
      Progress: 42.6,
      DurationSec: 1200,
      TimeLeftSec: 1800,
      FileName: 'benchy.gcode',
      CurrentLayer: 87,
      TotalLayers: 220,
      Temps: {
        BedActual: 60,
        BedTarget: 60,
        HotendActual: 210,
        HotendTarget: 210,
        ChamberActual: 35,
        ChamberTarget: 0,
      },
    },
  },
  PlatformVersion: 'Elegoo-CC2',
  Features: FEATURES,
};

describe('mapStatus — idle (stale CurrentPrint must be ignored)', () => {
  const state = mapStatus(idleStatus, 1_000_000);

  it('reports an idle, inactive connection', () => {
    expect(state.connection).toBe('idle');
    expect(state.isActive).toBe(false);
  });

  it('does NOT expose a job when idle (no stale layer/duration leakage)', () => {
    expect(state.job).toBeUndefined();
  });

  it('still exposes live temps, including the chamber', () => {
    expect(state.temps.map((t) => t.id)).toEqual(['nozzle', 'bed', 'chamber']);
    expect(state.temps.find((t) => t.id === 'nozzle')?.actual).toBe(40);
    expect(state.temps.find((t) => t.id === 'chamber')?.actual).toBe(31);
  });

  it('marks nozzle/bed settable but never the chamber', () => {
    expect(state.temps.find((t) => t.id === 'nozzle')?.settable).toBe(true);
    expect(state.temps.find((t) => t.id === 'chamber')?.settable).toBe(false);
  });

  it('derives capabilities from the feature bitfield + state', () => {
    expect(state.capabilities.canSetTemp).toBe(true);
    expect(state.capabilities.canSetLight).toBe(true);
    expect(state.capabilities.canStart).toBe(false); // PRINT_START not in FEATURES
    expect(state.capabilities.canPause).toBe(false); // not printing
    expect(state.capabilities.canCancel).toBe(false);
  });

  it('detects the CC2 model and records the timestamp', () => {
    expect(state.model).toBe('cc2');
    expect(state.lastUpdated).toBe(1_000_000);
  });
});

describe('mapStatus — printing', () => {
  const now = 1_000_000;
  const state = mapStatus(printingStatus, now);

  it('is active and exposes the job', () => {
    expect(state.isActive).toBe(true);
    expect(state.job?.fileName).toBe('benchy.gcode');
  });

  it('rounds progress and computes ETA from TimeLeftSec', () => {
    expect(state.job?.progressPct).toBe(43);
    expect(state.job?.remainingSec).toBe(1800);
    expect(state.job?.etaEpochMs).toBe(now + 1800 * 1000);
  });

  it('exposes layer info when present', () => {
    expect(state.job?.currentLayer).toBe(87);
    expect(state.job?.totalLayers).toBe(220);
  });

  it('allows pause/cancel but not resume while printing', () => {
    expect(state.capabilities.canPause).toBe(true);
    expect(state.capabilities.canCancel).toBe(true);
    expect(state.capabilities.canResume).toBe(false);
  });
});
