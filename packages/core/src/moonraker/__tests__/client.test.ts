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

const LAN = 'http://192.168.1.50';

function routedClient(routes: Record<string, unknown>) {
  const calls: { url: string; method?: string }[] = [];
  const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method });
    const path = u.slice(LAN.length).split('?')[0];
    if (!(path in routes)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new MoonrakerClient({ baseUrl: LAN, fetchImpl }), calls, fetchImpl };
}

describe('MoonrakerClient.probe', () => {
  it('is true when Moonraker answers /server/info', async () => {
    const { fetchImpl, calls } = routedClient({ '/server/info': { result: { klippy_state: 'ready' } } });
    await expect(MoonrakerClient.probe(LAN, { fetchImpl })).resolves.toBe(true);
    expect(calls[0].url).toBe(`${LAN}/server/info`);
  });

  it('is false on an HTTP error, a non-Moonraker body or a network failure', async () => {
    const notFound = routedClient({}).fetchImpl;
    await expect(MoonrakerClient.probe(LAN, { fetchImpl: notFound })).resolves.toBe(false);

    const other = routedClient({ '/server/info': { hello: 'world' } }).fetchImpl;
    await expect(MoonrakerClient.probe(LAN, { fetchImpl: other })).resolves.toBe(false);

    const failing = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(MoonrakerClient.probe(LAN, { fetchImpl: failing })).resolves.toBe(false);
  });

  it('is false when the request outlasts the timeout', async () => {
    const hanging = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    await expect(MoonrakerClient.probe(LAN, { fetchImpl: hanging, timeoutMs: 10 })).resolves.toBe(false);
  });
});

describe('MoonrakerClient LAN control', () => {
  const objects = ['webhooks', 'print_stats', 'extruder', 'extruder1', 'toolhead', 'heater_bed'];
  const routes = {
    '/printer/objects/list': { result: { objects } },
    '/printer/objects/query': {
      result: {
        status: {
          webhooks: { state: 'ready' },
          print_stats: { state: 'standby' },
          extruder: { temperature: 20, target: 0 },
          extruder1: { temperature: 21, target: 0 },
          toolhead: { extruder: 'extruder' },
          heater_bed: { temperature: 22, target: 0 },
        },
      },
    },
    '/server/webcams/list': { result: { webcams: [{ name: 'Cam', stream_url: '/webcam/?action=stream' }] } },
    '/printer/print/pause': { result: 'ok' },
    '/printer/print/resume': { result: 'ok' },
    '/printer/print/cancel': { result: 'ok' },
    '/printer/gcode/script': { result: 'ok' },
  };

  it('maps status and lists the objects only once', async () => {
    const { client, calls } = routedClient(routes);
    const s = await client.getStatus(1);
    expect(s.model).toBe('klipper');
    expect(s.extruders).toHaveLength(2);
    expect(s.bed?.actual).toBe(22);

    await client.getStatus(2);
    expect(calls.filter((c) => c.url.includes('/printer/objects/list'))).toHaveLength(1);
  });

  it('lists webcams on the LAN base', async () => {
    const { client } = routedClient(routes);
    const cams = await client.listWebcams();
    expect(cams[0].streamUrl).toBe(`${LAN}/webcam/?action=stream`);
  });

  it('pauses, resumes and cancels via the print endpoints', async () => {
    const { client, calls } = routedClient(routes);
    await client.pause();
    await client.resume();
    await client.cancel();
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', `${LAN}/printer/print/pause`],
      ['POST', `${LAN}/printer/print/resume`],
      ['POST', `${LAN}/printer/print/cancel`],
    ]);
  });

  const script = (url: string) => decodeURIComponent(url.split('script=')[1]);

  it('homes, jogs relatively and restores the g-code state', async () => {
    const { client, calls } = routedClient(routes);
    await client.home();
    await client.moveAxis('Z', -0.1);
    expect(script(calls[0].url)).toBe('G28');
    expect(script(calls[1].url).split('\n')).toEqual([
      'SAVE_GCODE_STATE NAME=teleforge_jog',
      'G91',
      'G1 Z-0.1 F600',
      'RESTORE_GCODE_STATE NAME=teleforge_jog',
    ]);
  });

  it('extrudes on the active tool, changing tool first for another one', async () => {
    const { client, calls } = routedClient(routes);
    await client.getStatus(); // active tool: extruder (0)
    await client.extrude(0, 5);
    await client.extrude(1, -2);
    const scripts = calls.filter((c) => c.url.includes('gcode/script')).map((c) => script(c.url).split('\n'));
    expect(scripts[0]).toEqual([
      'SAVE_GCODE_STATE NAME=teleforge_extrude',
      'M83',
      'G1 E5 F300',
      'RESTORE_GCODE_STATE NAME=teleforge_extrude',
    ]);
    expect(scripts[1][0]).toBe('T1');
    expect(scripts[1]).toContain('G1 E-2 F300');
  });

  it('sets heaters and lights with g-code', async () => {
    const { client, calls } = routedClient(routes);
    await client.setTemp({ toolC: 200, toolNumber: 1, bedC: 60 });
    await client.setLight('caselight', false);
    expect(calls.map((c) => script(c.url))).toEqual(['M104 T1 S200', 'M140 S60', 'SET_PIN PIN=caselight VALUE=0']);
    await expect(client.setTemp({})).rejects.toThrow();
  });
});
