export interface Env {
  FRONTEND_ORIGIN: string;
  API_ORIGIN: string;
  GITHUB_ORG: string;
  ADMIN_REPOSITORY: string;
  ADMIN_GITHUB_ID: string;
  GITHUB_APP_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_PRIVATE_KEY: string;
  SESSION_SECRET: string;
  DISCUSSION_SECRET: string;
}

export function configured(env: Env): boolean {
  return (
    [
      env.FRONTEND_ORIGIN,
      env.API_ORIGIN,
      env.GITHUB_ORG,
      env.ADMIN_REPOSITORY,
      env.ADMIN_GITHUB_ID,
      env.GITHUB_APP_ID,
      env.GITHUB_CLIENT_ID,
      env.GITHUB_INSTALLATION_ID,
      env.GITHUB_CLIENT_SECRET,
      env.GITHUB_PRIVATE_KEY,
      env.SESSION_SECRET,
      env.DISCUSSION_SECRET,
    ].every((value) => !!value && !value.includes("REPLACE_")) &&
    env.SESSION_SECRET.length >= 32 &&
    env.DISCUSSION_SECRET.length >= 32
  );
}
