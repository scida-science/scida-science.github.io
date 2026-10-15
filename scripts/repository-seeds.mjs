// Initializes empty administrative storage only. Research must come from real
// investigation repositories; never seed production with test fixtures.
const state = {
  schemaVersion: 1,
  profiles: {},
  access: {},
  applications: [],
  invitations: [],
  codeRequests: [],
  sessions: {},
  exchanges: {},
  audit: [],
};
const repositories = [
  {
    name: "scida-admin",
    description: "Private SciDA profiles, scoped access and account records",
    files: {
      "scida/state.json": JSON.stringify(state, null, 2) + "\n",
      "README.md":
        "# SciDA private administration\n\nPrivate application records managed by the SciDA GitHub App. Do not make this repository public or grant researcher write access. No fabricated accounts are seeded.\n",
    },
  },
];
process.stdout.write(JSON.stringify(repositories));
