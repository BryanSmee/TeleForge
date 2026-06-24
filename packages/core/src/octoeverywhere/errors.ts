/**
 * OctoEverywhere error handling.
 *
 * Two error families surface through the relay (see docs/octoeverywhere-auth.md):
 *  - Relay errors (600–613): returned as the HTTP status code by the OE relay
 *    (printer offline, connection revoked, not a supporter, limits, …).
 *  - Command errors (750–789): returned inside the response envelope's `Status`
 *    field by the plugin's command handler.
 */

export type OeErrorKind = 'relay' | 'command' | 'transport';

const RELAY_MESSAGES: Record<number, string> = {
  600: 'Server/plugin error (temporary)',
  601: 'Printer is not connected to OctoEverywhere',
  602: "OctoEverywhere's connection to the printer timed out",
  603: 'App/Shared Connection not found',
  604: 'Connection revoked or expired',
  605: 'Account is no longer an OctoEverywhere supporter',
  606: 'Invalid or missing connection credentials',
  607: 'File download limit exceeded',
  608: 'File upload limit exceeded',
  609: 'Webcam back-to-back limit exceeded',
  610: 'Plugin update required',
  611: 'No beta access',
};

/** Relay codes that are worth retrying later (vs. permanent failures). */
const TEMPORARY_RELAY_CODES = new Set([600, 601, 602, 605, 609, 610, 611, 612, 613]);

export class OctoEverywhereError extends Error {
  readonly kind: OeErrorKind;
  readonly code: number;
  /** True if retrying later might succeed. */
  readonly temporary: boolean;

  constructor(kind: OeErrorKind, code: number, message: string, temporary: boolean) {
    super(message);
    this.name = 'OctoEverywhereError';
    this.kind = kind;
    this.code = code;
    this.temporary = temporary;
  }

  static relay(code: number): OctoEverywhereError {
    return new OctoEverywhereError(
      'relay',
      code,
      RELAY_MESSAGES[code] ?? `OctoEverywhere relay error ${code}`,
      TEMPORARY_RELAY_CODES.has(code),
    );
  }

  static command(code: number, message?: string): OctoEverywhereError {
    return new OctoEverywhereError('command', code, message ?? `Command failed (${code})`, false);
  }

  static transport(message: string): OctoEverywhereError {
    return new OctoEverywhereError('transport', 0, message, true);
  }
}

/** An HTTP status in the OE relay custom range. */
export function isRelayErrorStatus(status: number): boolean {
  return status >= 600 && status <= 699;
}
