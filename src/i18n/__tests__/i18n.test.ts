import { describe, it, expect } from '@jest/globals';
import { en } from '../locales/en';
import { fr } from '../locales/fr';
import { resolveLocale, translate, SUPPORTED_LOCALES } from '../index';

describe('translate', () => {
  it('returns the string for the locale', () => {
    expect(translate('en', 'common.cancel')).toBe('Cancel');
    expect(translate('fr', 'common.cancel')).toBe('Annuler');
  });

  it('fills {placeholders}', () => {
    expect(translate('en', 'list.removeConfirm', { name: 'CC2' })).toBe('Remove "CC2"?');
    expect(translate('fr', 'list.removeConfirm', { name: 'U1' })).toBe('Supprimer « U1 » ?');
    expect(translate('en', 'dashboard.layer', { current: 3, total: 10 })).toBe('Layer 3 / 10');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(translate('en', 'temp.setTitle', {})).toBe('Set {label}');
  });
});

describe('locale resolution', () => {
  it('passes through explicit locales and resolves system to a supported one', () => {
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('en')).toBe('en');
    expect(SUPPORTED_LOCALES).toContain(resolveLocale('system'));
  });
});

describe('translation completeness', () => {
  it('fr defines exactly the same keys as en', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty strings', () => {
    const empties = [...Object.entries(en), ...Object.entries(fr)]
      .filter(([, value]) => value === '')
      .map(([key]) => key);
    expect(empties).toEqual([]);
  });
});
