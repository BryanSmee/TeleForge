import { describe, it, expect, jest } from '@jest/globals';
import { MoonrakerClient } from '../client';

const BASE = 'https://shared-test.octoeverywhere.com';

function clientWithSpy() {
  const calls: { url: string; method?: string }[] = [];
  const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    return new Response('{"result":"ok"}', { status: 200 });
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
