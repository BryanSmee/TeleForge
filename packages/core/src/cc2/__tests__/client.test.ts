import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { Cc2Error, Cc2LanClient, hostOf } from '../client';
import { FakeBroker } from './fakeBroker';

const STATUS = {
  machine_status: { status: 2, sub_status: 2075, exception_status: [], progress: 10 },
  print_status: { filename: 'cube.gcode', print_duration: 60, remaining_time_sec: 600, progress: 10 },
  extruder: { temperature: 219, target: 220 },
  heater_bed: { temperature: 60, target: 60 },
  led: { status: 0 },
};

const clients: Cc2LanClient[] = [];

function makeClient(broker: FakeBroker, opts: Partial<ConstructorParameters<typeof Cc2LanClient>[0]> = {}) {
  const client = new Cc2LanClient({ lanUrl: 'http://192.168.1.240', webSocket: broker.factory, ...opts });
  clients.push(client);
  return client;
}

afterEach(() => {
  clients.splice(0).forEach((c) => c.close());
  jest.useRealTimers();
});

describe('hostOf', () => {
  it('keeps only the host of a LAN URL', () => {
    expect(hostOf('http://192.168.1.240')).toBe('192.168.1.240');
    expect(hostOf(' http://cc2.local:80/path ')).toBe('cc2.local');
    expect(hostOf('http://[fe80::1]:80')).toBe('[fe80::1]');
  });
});

describe('Cc2LanClient', () => {
  it('connects on port 9001, learns the serial, registers and maps the full status', async () => {
    const broker = new FakeBroker({ status: STATUS, attributes: { machine_model: 'Centauri Carbon 2' } });
    const client = makeClient(broker);

    const state = await client.getStatus(1000);

    expect(broker.urls).toEqual(['ws://192.168.1.240:9001']);
    expect(client.serialNumber).toBe('CC2SN0001');
    expect(broker.registerPayloads).toHaveLength(1);
    const { client_id, request_id } = broker.registerPayloads[0] as { client_id: string; request_id: string };
    expect(client_id).toMatch(/^0cli[0-9a-f]{6}$/);
    expect(request_id).toBe(`${client_id}_req`);
    expect(state).toMatchObject({
      model: 'cc2',
      connection: 'printing',
      job: { fileName: 'cube.gcode', progressPct: 10, remainingSec: 600 },
      extruders: [{ actual: 219, target: 220 }],
      lights: [{ name: 'chamber', on: false }],
      platformVersion: 'Centauri Carbon 2',
    });
    // The wildcard used to find the serial and the registration reply are dropped once registered.
    expect(broker.sockets[0].subscriptions.sort()).toEqual(
      ['elegoo/CC2SN0001/api_status', `elegoo/CC2SN0001/${client_id}/api_response`].sort(),
    );
  });

  it('merges the status deltas the printer pushes', async () => {
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker);
    await client.getStatus();

    broker.pushStatus(2, { print_status: { progress: 55 }, extruder: { temperature: 221.5 } });
    await new Promise((r) => setTimeout(r, 0));

    const state = await client.getStatus();
    expect(state.job?.progressPct).toBe(55);
    expect(state.job?.fileName).toBe('cube.gcode');
    expect(state.extruders[0]).toMatchObject({ actual: 221.5, target: 220 });
  });

  it('resyncs from a full status after a single missed delta', async () => {
    const status = { ...STATUS };
    const broker = new FakeBroker({ status });
    const client = makeClient(broker);
    await client.getStatus();
    const fullStatusRequests = () => broker.requests.filter((r) => r.method === 1002).length;
    expect(fullStatusRequests()).toBe(1);

    broker.pushStatus(1, { print_status: { progress: 11 } });
    broker.pushStatus(2, { print_status: { progress: 12 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(fullStatusRequests()).toBe(1); // in order: no resync

    // Delta 3 (the print ending) is lost; the printer is idle now.
    status.machine_status = { status: 1, sub_status: 0, exception_status: [], progress: 0 };
    broker.pushStatus(4, { extruder: { temperature: 200 } });
    await new Promise((r) => setTimeout(r, 0));

    expect(fullStatusRequests()).toBe(2);
    expect((await client.getStatus()).connection).toBe('idle');
  });

  it('reuses one session for status and commands', async () => {
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker);
    await Promise.all([client.getStatus(), client.probe(), client.pause()]);
    expect(broker.sockets).toHaveLength(1);
  });

  it('sends the CC2 methods for each command', async () => {
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker);

    await client.pause();
    await client.resume();
    await client.cancel();
    await client.setTemp({ toolC: 210, bedC: 55 });
    await client.setLight('chamber', true);
    await client.home();
    await client.moveAxis('Z', -1);

    expect(broker.requests.filter((r) => r.method !== 1001 && r.method !== 1002)).toEqual([
      { method: 1021, params: {} },
      { method: 1023, params: {} },
      { method: 1022, params: {} },
      { method: 1028, params: { extruder: 210, heater_bed: 55 } },
      { method: 1029, params: { brightness: 255, power: 1 } },
      { method: 1026, params: { homed_axes: 'xyz' } },
      { method: 1027, params: { axes: 'z', distance: -1 } },
    ]);
  });

  it('rejects what the CC2 cannot do before sending anything', async () => {
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker);
    await expect(client.setTemp({ chamberC: 40 })).rejects.toThrow(/chamber/);
    await expect(client.setTemp({ bedC: 120 })).rejects.toThrow(/exceeds/);
    await expect(client.extrude()).rejects.toThrow(/not supported/);
    await expect(client.setLight('cavity_led', true)).rejects.toThrow(/Unknown light/);
    expect(broker.sockets).toHaveLength(0);
  });

  it('fails a command the printer refuses', async () => {
    const broker = new FakeBroker({ status: STATUS });
    broker.replies.set(1021, { error_code: 1003 });
    const client = makeClient(broker);
    await expect(client.pause()).rejects.toThrow('The printer refused the command (error 1003)');
  });

  it('reads the combo / CFS slots over MQTT', async () => {
    const broker = new FakeBroker({ status: STATUS });
    const canvas = { active_canvas_id: 0, active_tray_id: -1, auto_refill: false, canvas_list: [] };
    broker.replies.set(2005, { error_code: 0, canvas_info: canvas });
    const client = makeClient(broker);
    await expect(client.getCanvasInfo()).resolves.toEqual({ error_code: 0, canvas_info: canvas });
  });

  it('turns the camera on and points at its MJPEG stream', async () => {
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker);
    const cams = await client.listWebcams();
    expect(cams).toEqual([
      expect.objectContaining({ kind: 'mjpeg', streamUrl: 'http://192.168.1.240:8080/?action=stream' }),
    ]);
    await client.getStatus();
    await new Promise((r) => setTimeout(r, 0));
    expect(broker.requests.some((r) => r.method === 1042 && r.params.enable === true)).toBe(true);
  });

  it('asks lookupSerial when the broker refuses the wildcard', async () => {
    const broker = new FakeBroker({ status: STATUS, refuseWildcard: true, serial: 'CC2RELAY' });
    const lookupSerial = jest.fn(async () => 'CC2RELAY');
    const client = makeClient(broker, { lookupSerial });
    await expect(client.probe()).resolves.toBe(true);
    expect(lookupSerial).toHaveBeenCalled();
    expect(client.serialNumber).toBe('CC2RELAY');
  });

  it('uses a known serial without discovery', async () => {
    const broker = new FakeBroker({ status: STATUS, refuseWildcard: true });
    const client = makeClient(broker, { serialNumber: 'CC2SN0001' });
    await expect(client.probe()).resolves.toBe(true);
  });

  it('sends the access code as the MQTT password and reports a wrong one', async () => {
    const broker = new FakeBroker({ status: STATUS, accessCode: '4242' });
    await expect(makeClient(broker).getStatus()).rejects.toMatchObject({ kind: 'auth' });
    await expect(makeClient(broker, { accessCode: '4242' }).probe()).resolves.toBe(true);
  });

  it('reports a printer that already has too many clients', async () => {
    const broker = new FakeBroker({ status: STATUS, registerError: 'too many clients' });
    const error = await makeClient(broker).getStatus().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Cc2Error);
    expect((error as Cc2Error).kind).toBe('too-many-clients');
    expect(broker.sockets[0].closed).toBe(true);
  });

  it('fails fast when the printer is unreachable', async () => {
    const broker = new FakeBroker({ status: STATUS });
    broker.unreachable = true;
    const started = Date.now();
    await expect(makeClient(broker, { openTimeoutMs: 50 }).probe()).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('keeps the session alive with PINGs, then drops it once the printer goes silent', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker, { idleMs: 10 ** 9 });
    await client.getStatus();

    await jest.advanceTimersByTimeAsync(25_000);
    expect(broker.pings).toBe(2);
    await expect(client.probe()).resolves.toBe(true);

    broker.silent = true; // left the LAN: the socket lingers, nothing answers
    await jest.advanceTimersByTimeAsync(36_000);
    expect(broker.sockets[0].closed).toBe(true);

    broker.unreachable = true;
    const probing = client.probe();
    await jest.advanceTimersByTimeAsync(2000);
    await expect(probing).resolves.toBe(false);
  });

  it('never reopens a session once disposed', async () => {
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker);
    await client.getStatus();
    client.dispose();
    await expect(client.getStatus()).rejects.toMatchObject({ kind: 'closed' });
    await expect(client.probe()).resolves.toBe(false);
    expect(broker.sockets).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(broker.sockets[0].closed).toBe(true);
  });

  it('closes the session after idleMs without use', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const broker = new FakeBroker({ status: STATUS });
    const client = makeClient(broker, { idleMs: 15_000 });
    await client.getStatus();
    await jest.advanceTimersByTimeAsync(21_000);
    expect(broker.sockets[0].closed).toBe(true);

    // The next call opens a new session.
    await client.getStatus();
    expect(broker.sockets).toHaveLength(2);
  });
});
