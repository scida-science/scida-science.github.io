// Exports only the six explicitly illustrative source records and empty storage.
// No users, sessions, approvals, comments, or code requests are fabricated.
import { discoveries } from "../src/data/discoveries.ts";
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
for (const discovery of discoveries)
  repositories.push({
    name: "discovery-" + discovery.id.toLowerCase(),
    description: "Illustrative SciDA discovery " + discovery.id,
    files: {
      "discovery.json":
        JSON.stringify(
          {
            schemaVersion: 1,
            visibility: "public",
            discovery,
            materials: {
              paper: null,
              appendix: null,
              figures: null,
              data: null,
              repository: null,
            },
          },
          null,
          2,
        ) + "\n",
      "README.md": `# ${discovery.id}: illustrative example\n\nThis is fictional research content used to demonstrate SciDA. No paper, data or code is uploaded.\n\nEdit discovery.json to update the brief. Store paper, appendix, figures and data in this private repository and explicitly map allowed materials in discovery.json. The repository remains private even when its brief is explicitly public.\n`,
    },
  });
process.stdout.write(JSON.stringify(repositories));
