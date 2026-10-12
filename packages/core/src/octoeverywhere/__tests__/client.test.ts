import { describe, it, expect, jest } from '@jest/globals';
import { OctoEverywhereClient } from '../client';
import { OctoEverywhereError } from '../errors';

const BASE = 'https://shared-test.octoeverywhere.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch, bearerToken?: string) {
  return new OctoEverywhereClient({ baseUrl: BASE, fetchImpl, bearerToken });
}

describe('OctoEverywhereClient.command envelope handling', () => {
  it('unwraps Result on a 200/{Status:200} envelope', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ Status: 200, Result: { Webcams: [], DefaultIndex: 0 } }),
    ) as unknown as typeof fetch;

    const webcams = await clientWith(fetchImpl).listWebcams();
    expect(webcams).toEqual([]);
  });

  it('throws a relay error on a 6xx HTTP status', async () => {
    // The WHATWG Response constructor rejects 6xx, but a real relay returns it
    // over the wire — fake a minimal response object the client can read.
    const relay601 = { status: 601, ok: false, json: async () => ({}) } as unknown as Response;
    const fetchImpl = jest.fn(async () => relay601) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).getStatus()).rejects.toMatchObject({
      kind: 'relay',
      code: 601,
      temporary: true,
    });
  });

  it('throws a command error when the envelope Status is not 200', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ Status: 785, Error: 'Host not connected' }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).getStatus()).rejects.toMatchObject({
      kind: 'command',
      code: 785,
    });
  });

  it('wraps network failures as a transport error', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).getStatus()).rejects.toBeInstanceOf(OctoEverywhereError);
  });
});

describe('OctoEverywhereClient command shapes', () => {
  it('POSTs set-temp with the API field names', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ Status: 200, Result: null });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).setTemp({ bedC: 60, toolC: 210 });

    expect(calls[0].url).toBe(`${BASE}/octoeverywhere-command-api/set-temp`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ BedC: 60, ToolC: 210 });
  });

  it('POSTs set-light with Name/On', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ Status: 200, Result: null });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).setLight('cavity_led', true);

    expect(calls[0].url).toBe(`${BASE}/octoeverywhere-command-api/set-light`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ Name: 'cavity_led', On: true });
  });

  it('rejects set-temp above the safety limits without a network call', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ Status: 200, Result: null })) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);
    expect(() => client.setTemp({ toolC: 999 })).toThrow(/exceeds/);
    expect(() => client.setTemp({})).toThrow(/at least one/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('getCanvasInfo POSTs send-command with the mqtt method-2005 shape and unwraps the reply', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        Status: 200,
        Result: {
          TransportType: 'mqtt',
          ResponseReceived: true,
          IsError: false,
          Response: { Payload: { id: 1, method: 2005, result: { canvas_info: { active_tray_id: 1 }, error_code: 0 } } },
        },
      });
    }) as unknown as typeof fetch;

    const out = await clientWith(fetchImpl).getCanvasInfo();

    expect(calls[0].url).toBe(`${BASE}/octoeverywhere-command-api/send-command`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      TransportType: 'mqtt',
      Request: { Method: 2005, Params: {} },
    });
    expect(out).toEqual({ canvas_info: { active_tray_id: 1 }, error_code: 0 });
  });

  it('getCanvasInfo returns null when the printer did not reply or errored', async () => {
    const noReply = jest.fn(async () =>
      jsonResponse({ Status: 200, Result: { ResponseReceived: false, IsError: false } }),
    ) as unknown as typeof fetch;
    expect(await clientWith(noReply).getCanvasInfo()).toBeNull();

    const errored = jest.fn(async () =>
      jsonResponse({ Status: 200, Result: { ResponseReceived: true, IsError: true } }),
    ) as unknown as typeof fetch;
    expect(await clientWith(errored).getCanvasInfo()).toBeNull();
  });

  it('POSTs move-axis with Axis/DistanceMm (signed for direction)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ Status: 200, Result: null });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).moveAxis('Z', -0.1);

    expect(calls[0].url).toBe(`${BASE}/octoeverywhere-command-api/move-axis`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ Axis: 'Z', DistanceMm: -0.1 });
  });

  it('POSTs home with no body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ Status: 200, Result: null });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).home();

    expect(calls[0].url).toBe(`${BASE}/octoeverywhere-command-api/home`);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('POSTs extrude with Extruder/DistanceMm (negative retracts)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ Status: 200, Result: null });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).extrude(0, -5);

    expect(calls[0].url).toBe(`${BASE}/octoeverywhere-command-api/extrude`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ Extruder: 0, DistanceMm: -5 });
  });

  it('sends the Bearer header when a token is configured', async () => {
    let seen: Record<string, string> | undefined;
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>;
      return jsonResponse({ Status: 200, Result: null });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl, 'tok123').pause();
    expect(seen?.Authorization).toBe('Bearer tok123');
  });
});
