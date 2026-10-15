import { describe, expect, it } from 'vitest';
import { AppScopeError, validateInstallation, validateRepositories } from './github-app-scope.mjs';

const repository = (name, changes = {}) => ({
  name, private: true, archived: false, disabled: false, has_issues: true,
  owner: { login: 'scida-science', type: 'Organization' }, ...changes,
});
const initial = () => [
  'scida-admin', 'GRB180411A_Dust_Echo', 'TOI475_Ephemeris_Discrepancy',
  'TIC233166139_APOGEE_Mass_Ratio',
].map((name) => repository(name));
const installation = (changes = {}) => ({
  id: 42, app_id: 123, account: { id: 456, login: 'scida-science', type: 'Organization' },
  target_id: 456, target_type: 'Organization', suspended_at: null,
  repository_selection: 'all', ...changes,
});

describe('GitHub App installation scope', () => {
  it.each(['all', 'selected'])('accepts an active organization installation with %s repositories', (selection) => {
    expect(validateInstallation(installation({ repository_selection: selection }), 123)).toBe(selection);
  });

  it.each([
    { id: 0 }, { app_id: 999 }, { repository_selection: 'unknown' },
    { suspended_at: '2026-10-14T12:00:00Z' }, { target_id: 999 }, { target_type: 'User' },
    { account: { id: 456, login: 'foreign-org', type: 'Organization' } },
    { account: { id: 456, login: 'scida-science', type: 'User' } },
  ])('rejects invalid installation identity or state: %j', (changes) => {
    expect(() => validateInstallation(installation(changes), 123)).toThrow(AppScopeError);
  });
});

describe('GitHub App repository scope', () => {
  it('allows All repositories with the public website and unrelated repositories while returning only private storage', () => {
    const rows = [
      ...initial(), repository('scida-science.github.io', { private: false }),
      repository('unrelated-archive', { archived: true, disabled: true, has_issues: false }),
      repository('discovery-new-topic'),
    ];
    expect(validateRepositories(rows, 'all')).toEqual([
      'GRB180411A_Dust_Echo', 'TIC233166139_APOGEE_Mass_Ratio', 'TOI475_Ephemeris_Discrepancy',
      'discovery-new-topic', 'scida-admin',
    ]);
  });

  it('keeps the existing selected-repository setup valid', () => {
    expect(validateRepositories(initial(), 'selected')).toHaveLength(4);
  });

  it('keeps unrelated repositories excluded from a selected installation', () => {
    expect(() => validateRepositories([...initial(), repository('scida-science.github.io', { private: false })], 'selected'))
      .toThrow('With Only select repositories');
  });

  it.each(['scida-admin', 'discovery-ai-001', 'discovery-extra'])(
    'rejects public, archived, or disabled storage at %s even with All repositories', (name) => {
      for (const changes of [{ private: false }, { archived: true }, { disabled: true }]) {
        const rows = [...initial().filter((row) => row.name !== name), repository(name, changes)];
        expect(() => validateRepositories(rows, 'all')).toThrow('active and private');
      }
    },
  );

  it.each(['discovery-ai-001', 'discovery-extra'])('requires Issues for %s', (name) => {
    const rows = [...initial().filter((row) => row.name !== name), repository(name, { has_issues: false })];
    expect(() => validateRepositories(rows, 'all')).toThrow('Enable Issues');
  });

  it('does not require Issues on the administrative repository', () => {
    const rows = initial().map((row) => row.name === 'scida-admin' ? { ...row, has_issues: false } : row);
    expect(validateRepositories(rows, 'all')).toHaveLength(4);
  });

  it.each(['scida-admin', 'GRB180411A_Dust_Echo'])('rejects missing required storage %s', (name) => {
    expect(() => validateRepositories(initial().filter((row) => row.name !== name), 'all'))
      .toThrow('Allow access to scida-admin and the three named astronomy investigation repositories');
  });

  it('rejects duplicate names including casing differences', () => {
    expect(() => validateRepositories([...initial(), repository('grb180411a_dust_echo')], 'all'))
      .toThrow('unique repositories');
  });

  it.each(['discovery-foreign', 'unrelated-foreign'])('rejects foreign-organization metadata for %s', (name) => {
    expect(() => validateRepositories([
      ...initial(), repository(name, { owner: { login: 'someone-else', type: 'Organization' } }),
    ], 'all')).toThrow('owned by scida-science');
  });

  it('rejects malformed additional discovery repository names', () => {
    expect(() => validateRepositories([...initial(), repository('discovery-')], 'all')).toThrow(AppScopeError);
  });

  it('does not treat an unrecognized selection value as All repositories', () => {
    expect(() => validateRepositories(initial(), 'unknown')).toThrow('unsupported installation repository scope');
  });
});
