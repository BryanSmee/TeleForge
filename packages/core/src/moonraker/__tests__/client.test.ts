import { describe, it, expect, jest } from '@jest/globals';
import { MoonrakerClient } from '../client';

const BASE = 'https://shared-test.octoeverywhere.com';

function clientWithSpy(body = '{"result":"ok"}') {
  const calls: { url: string; method?: string }[] = [];
  const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new MoonrakerClient({ baseUrl: BASE, fetchImpl }), calls };
}

describe('MoonrakerClient gcode temp setters', () => {
  it('targets a specific extruder with M104 T{n}', async () => {
    const { client, calls } = clientWithSpy();
    await client.setExtruderTemp(2, 210);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${BASE}/printer/gcode/script?script=${encodeURIComponent('M104 T2 S210')}`);
  });

  it('sets the bed with M140', async () => {
    const { client, calls } = clientWithSpy();
    await client.setBedTemp(60);
    expect(calls[0].url).toContain(encodeURIComponent('M140 S60'));
  });

  it('rounds and clamps out-of-range targets', async () => {
    const { client, calls } = clientWithSpy();
    await client.setExtruderTemp(0, 999.6);
    expect(calls[0].url).toContain(encodeURIComponent('M104 T0 S300'));
    await client.setBedTemp(-5);
    expect(calls[1].url).toContain(encodeURIComponent('M140 S0'));
  });
});

describe('MoonrakerClient.setFanSpeed', () => {
  it('drives the part-cooling fan with M106 S0-255', async () => {
    const { client, calls } = clientWithSpy();
    await client.setFanSpeed('fan', 50);
    expect(calls[0].url).toContain(encodeURIComponent('M106 S128')); // round(0.5*255)
    await client.setFanSpeed('fan', 0);
    expect(calls[1].url).toContain(encodeURIComponent('M106 S0'));
    await client.setFanSpeed('fan', 100);
    expect(calls[2].url).toContain(encodeURIComponent('M106 S255'));
  });

  it('drives a generic fan with SET_FAN_SPEED FAN="name" SPEED=0..1', async () => {
    const { client, calls } = clientWithSpy();
    await client.setFanSpeed('fan_generic cavity_fan', 75);
    expect(calls[0].url).toContain(encodeURIComponent('SET_FAN_SPEED FAN="cavity_fan" SPEED=0.75'));
  });

  it('clamps out-of-range percentages', async () => {
    const { client, calls } = clientWithSpy();
    await client.setFanSpeed('fan', 150);
    expect(calls[0].url).toContain(encodeURIComponent('M106 S255'));
  });
});

describe('MoonrakerClient files', () => {
  it('lists gcode files, mapping fields and sorting newest first', async () => {
    const body = JSON.stringify({
      result: [
        { path: 'old.gcode', modified: 100, size: 1000 },
        { path: 'new.gcode', modified: 300, size: 2000 },
        { path: 'mid.gcode', modified: 200, size: 1500 },
      ],
    });
    const { client, calls } = clientWithSpy(body);
    const files = await client.listFiles();

    expect(calls[0].url).toBe(`${BASE}/server/files/list?root=gcodes`);
    expect(files.map((f) => f.path)).toEqual(['new.gcode', 'mid.gcode', 'old.gcode']);
    expect(files[0]).toEqual({ path: 'new.gcode', modifiedEpochSec: 300, sizeBytes: 2000 });
  });

  it('starts a print with the URL-encoded filename', async () => {
    const { client, calls } = clientWithSpy();
    await client.startPrint('subdir/My Benchy.gcode');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(
      `${BASE}/printer/print/start?filename=${encodeURIComponent('subdir/My Benchy.gcode')}`,
    );
  });
});
