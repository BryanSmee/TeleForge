/**
 * English strings — the source of truth for translation keys. Every other
 * locale is typed against this object's keys, so a missing/extra key is a
 * compile error. `{name}`-style placeholders are filled by `translate()`.
 */
export const en = {
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.set': 'Set',
  'common.off': 'Off',
  'common.remove': 'Remove',
  'common.retry': 'Tap to retry',
  'common.connecting': 'Connecting…',
  'common.actionFailed': 'Action failed',
  'common.unknownError': 'Unknown error',
  'common.printerGone': 'This printer no longer exists.',

  'nav.addPrinter': 'Add printer',
  'nav.printer': 'Printer',
  'nav.settings': 'Settings',
  'nav.files': 'Files',
  'nav.webUi': 'Web UI',

  'list.emptyTitle': 'No printers yet',
  'list.emptyBody': 'Add a printer using its OctoEverywhere Shared Connection URL.',
  'list.removeHint': 'Long-press a printer to remove it.',
  'list.removeTitle': 'Remove printer',
  'list.removeConfirm': 'Remove "{name}"?',
  'list.addPrinter': 'Add printer',

  'add.name': 'Name',
  'add.url': 'Shared Connection URL',
  'add.urlHint':
    "Create one in your OctoEverywhere account (Shared Connections). The URL is a secret — it's stored in the device secure store.",
  'add.connectedTo': 'Connected to {name}',
  'add.connectionFailed': 'Connection failed',
  'add.testConnection': 'Test connection',
  'add.testing': 'Testing…',
  'add.save': 'Save printer',

  'settings.urlHint': 'The URL is a secret — stored in the device secure store.',
  'settings.removePrinter': 'Remove printer',

  'dashboard.temperatures': 'Temperatures',
  'dashboard.nozzle': 'Nozzle',
  'dashboard.nozzleN': 'Nozzle {n}',
  'dashboard.bed': 'Bed',
  'dashboard.chamber': 'Chamber',
  'dashboard.fans': 'Fans',
  'dashboard.partCooling': 'Part cooling',
  'dashboard.lights': 'Lights',
  'dashboard.filament': 'Filament',
  'dashboard.autoRefill': 'Auto-refill',
  'dashboard.slotN': 'Slot {n}',
  'dashboard.empty': 'Empty',
  'dashboard.active': 'Active',
  'dashboard.aiCheck': 'AI failure check: {pct}%',
  'dashboard.eta': 'ETA {time} · {left} left',
  'dashboard.layer': 'Layer {current} / {total}',
  'dashboard.printingFile': 'Printing',
  'dashboard.pause': 'Pause',
  'dashboard.pauseConfirm': 'Pause print?',
  'dashboard.resume': 'Resume',
  'dashboard.cancelPrint': 'Cancel print',
  'dashboard.cancelConfirm': 'Cancel print?',

  'motion.title': 'Motion',
  'motion.home': 'Home all axes',
  'motion.disabledPrinting': 'Locked while printing',
  'motion.stepMm': 'Step (mm)',
  'motion.amountMm': 'Amount (mm)',
  'motion.extrude': 'Extrude',
  'motion.retract': 'Retract',

  'status.offline': 'Offline',
  'status.connecting': 'Connecting',
  'status.idle': 'Idle',
  'status.printing': 'Printing',
  'status.paused': 'Paused',
  'status.complete': 'Complete',
  'status.error': 'Error',

  'files.empty': 'No g-code files on this printer.',
  'files.startTitle': 'Start print?',
  'files.start': 'Start',
  'files.couldNotStart': 'Could not start',

  'temp.setTitle': 'Set {label}',
  'temp.currentTarget': 'Current target: {value}°C',
  'temp.customPlaceholder': 'Custom (0–{max})',

  'webcam.unavailable': 'Webcam unavailable',
  'webcam.streamPaused': 'Stream paused',
  'webcam.tapResume': 'Tap to resume',
  'webcam.streamUnavailable': 'Stream unavailable',

  'appSettings.language': 'Language',
  'appSettings.languageSystem': 'System default',
} as const;

export type TranslationKey = keyof typeof en;
