import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { cc2ClientFor, controlFor, probeLan } from '../endpoint';

const mockMoonrakerProbe = jest.fn<(url: string) => Promise<boolean>>();
const mockCc2Probe = jest.fn<(lanUrl: string) => Promise<boolean>>();
const mockCc2Dispose = jest.fn();
const mockCc2Options: Record<string, unknown>[] = [];

jest.mock('@teleforge/core', () => ({
  MoonrakerClient: Object.assign(
    jest.fn().mockImplementation(() => ({ kind: 'moonraker' })),
    { probe: (url: string) => mockMoonrakerProbe(url) },
  ),
  OctoEverywhereClient: jest.fn().mockImplementation(() => ({ kind: 'relay' })),
  Cc2LanClient: jest.fn().mockImplementation((opts) => {
    mockCc2Options.push(opts as Record<string, unknown>);
    const lanUrl = (opts as { lanUrl: string }).lanUrl;
    return { kind: 'cc2', lanUrl, probe: () => mockCc2Probe(lanUrl), dispose: mockCc2Dispose };
  }),
}));

const RELAY = 'https://shared-cc2.octoeverywhere.com';

beforeEach(() => {
  mockMoonrakerProbe.mockReset();
  mockCc2Probe.mockReset();
  mockCc2Dispose.mockReset();
  mockCc2Options.length = 0;
});

describe('probeLan', () => {
  it('finds a Klipper printer, then only probes Moonraker', async () => {
    const printer = { baseUrl: RELAY, lanUrl: 'http://192.168.1.50' };
    mockMoonrakerProbe.mockResolvedValue(true);
    mockCc2Probe.mockResolvedValue(false);

    await expect(probeLan(printer)).resolves.toBe('moonraker');
    await expect(probeLan(printer)).resolves.toBe('moonraker');
    expect(mockMoonrakerProbe).toHaveBeenCalledTimes(2);
    expect(mockCc2Probe).toHaveBeenCalledTimes(1);
  });

  it('finds a CC2, then only probes its broker', async () => {
    const printer = { baseUrl: RELAY, lanUrl: 'http://192.168.1.240' };
    mockMoonrakerProbe.mockResolvedValue(false);
    mockCc2Probe.mockResolvedValueOnce(true).mockResolvedValue(false);

    await expect(probeLan(printer)).resolves.toBe('cc2');
    await expect(probeLan(printer)).resolves.toBeUndefined(); // left the LAN
    expect(mockMoonrakerProbe).toHaveBeenCalledTimes(1);
    expect(mockCc2Probe).toHaveBeenCalledTimes(2);
  });

  it('reports nothing when neither answers', async () => {
    mockMoonrakerProbe.mockResolvedValue(false);
    mockCc2Probe.mockResolvedValue(false);
    await expect(probeLan({ baseUrl: RELAY, lanUrl: 'http://10.0.0.9' })).resolves.toBeUndefined();
    await expect(probeLan({ baseUrl: RELAY })).resolves.toBeUndefined();
  });
});

describe('cc2ClientFor / controlFor', () => {
  it('shares one CC2 client per LAN URL with the endpoint it resolved', () => {
    const printer = { baseUrl: RELAY, lanUrl: 'http://192.168.1.241', lanAccessCode: '1234' };
    const client = cc2ClientFor(printer);
    expect(cc2ClientFor(printer)).toBe(client);
    expect(controlFor({ kind: 'lan', url: printer.lanUrl, protocol: 'cc2' })).toBe(client);
    expect(mockCc2Options[0]).toMatchObject({ lanUrl: printer.lanUrl, accessCode: '1234' });
  });

  it('replaces the client when the access code changes', () => {
    const printer = { baseUrl: RELAY, lanUrl: 'http://192.168.1.242' };
    const first = cc2ClientFor(printer);
    const second = cc2ClientFor({ ...printer, lanAccessCode: '9999' });
    expect(second).not.toBe(first);
    expect(mockCc2Dispose).toHaveBeenCalledTimes(1);
  });

  it('uses Moonraker on a Klipper LAN endpoint and OE on the relay', () => {
    expect(controlFor({ kind: 'lan', url: 'http://192.168.1.50', protocol: 'moonraker' })).toMatchObject({
      kind: 'moonraker',
    });
    expect(controlFor({ kind: 'relay', url: RELAY })).toMatchObject({ kind: 'relay' });
  });
});
