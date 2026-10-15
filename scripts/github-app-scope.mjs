const org = 'scida-science';
const requiredRepositories = [
  'scida-admin', 'GRB180411A_Dust_Echo', 'TOI475_Ephemeris_Discrepancy',
  'TIC233166139_APOGEE_Mass_Ratio',
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const numericId = (value) => Number.isSafeInteger(value) && value > 0;

export class AppScopeError extends Error {}
const fail = (message) => { throw new AppScopeError(message); };

export function validateInstallation(installation, appId) {
  if (!object(installation) || !numericId(installation.id) || installation.app_id !== appId ||
    installation.account?.login?.toLowerCase() !== org || installation.account?.type !== 'Organization' ||
    installation.target_type !== 'Organization' || installation.target_id !== installation.account?.id ||
    installation.suspended_at !== null || !['all', 'selected'].includes(installation.repository_selection))
    fail('Install this App in scida-science using All repositories or Only select repositories, and keep it active.');
  return installation.repository_selection;
}

export function validateRepositories(repositories, selection) {
  if (!Array.isArray(repositories) || !['all', 'selected'].includes(selection))
    fail('GitHub returned an unsupported installation repository scope.');
  const names = new Set();
  const storageNames = [];
  for (const repository of repositories) {
    if (!object(repository) || repository.owner?.type !== 'Organization' ||
      repository.owner?.login?.toLowerCase() !== org || typeof repository.name !== 'string' ||
      !/^[A-Za-z0-9_.-]+$/.test(repository.name) || names.has(repository.name.toLowerCase()))
      fail('The installation must list unique repositories owned by scida-science.');
    names.add(repository.name.toLowerCase());
    const relevant = requiredRepositories.includes(repository.name) || repository.topics?.includes('scida-discovery') || repository.name.startsWith('discovery-');
    if (!relevant) {
      if (selection === 'all') continue;
      fail('With Only select repositories, select only scida-admin and investigation repositories marked scida-discovery.');
    }
    if (repository.private !== true || repository.archived !== false || repository.disabled !== false ||
      (repository.name.startsWith('discovery-') && !/^discovery-[a-z0-9][a-z0-9._-]*$/.test(repository.name)))
      fail('Keep scida-admin and investigation repositories active and private.');
    if (repository.name !== 'scida-admin' && repository.has_issues !== true)
      fail('Enable Issues on every discovery repository.');
    storageNames.push(repository.name);
  }
  if (requiredRepositories.some((name) => !storageNames.includes(name)))
    fail('Allow access to scida-admin and the three named astronomy investigation repositories before continuing.');
  return storageNames.sort();
}
