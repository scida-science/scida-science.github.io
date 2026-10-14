// Executes the real migrations and permission tests in embedded PostgreSQL.
// Auth sessions are represented by database roles/JWT subject settings. This is
// not a test of hosted Supabase email delivery, Auth HTTP endpoints, or API config.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
let checks = 0;
const ids = Object.fromEntries(
  [
    "owner",
    "reader",
    "reviewer",
    "approver",
    "outsider",
    "unverified",
    "invitee",
  ].map((name, i) => [
    name,
    `${i + 1}`.repeat(8) +
      "-" +
      `${i + 1}`.repeat(4) +
      "-4" +
      `${i + 1}`.repeat(3) +
      "-8" +
      `${i + 1}`.repeat(3) +
      "-" +
      `${i + 1}`.repeat(12),
  ]),
);
const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params = []) => (await q(sql, params)).rows[0];
function check(value, message) {
  assert.ok(value, message);
  checks++;
}
async function denied(action, message, codes = ["42501", "23514", "23505"]) {
  try {
    await action();
  } catch (error) {
    assert.ok(
      codes.includes(error.code),
      `${message}: unexpected error ${error.code}: ${error.message}`,
    );
    checks++;
    return;
  }
  assert.fail(`${message}: unexpectedly allowed`);
}
async function as(name, action) {
  await db.exec(`set role ${name === "anon" ? "anon" : "authenticated"}`);
  await q("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[name] ?? "",
  ]);
  try {
    return await action();
  } finally {
    await db.exec("reset role");
  }
}
async function migrate() {
  await db.exec(
    await fs.readFile(
      new URL("../supabase/tests/auth-fixture.sql", import.meta.url),
      "utf8",
    ),
  );
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await fs.readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await db.exec(await fs.readFile(new URL(file, dir), "utf8"));
  }
}

try {
  await migrate();
  check(
    (await one("select count(*)::int as n from public.profiles")).n === 0,
    "Migrations must not seed identities",
  );
  check(
    (await one("select count(*)::int as n from public.comments")).n === 0,
    "Migrations must not seed discussions",
  );
  check(
    (await one("select count(*)::int as n from public.reviewer_applications"))
      .n === 0,
    "Migrations must not seed approval decisions",
  );
  check(
    (
      await one(
        "select count(*)::int as n from public.discoveries where illustrative",
      )
    ).n === 6,
    "Exactly six illustrative discoveries",
  );
  check(
    (
      await one(
        "select bool_and(relrowsecurity) as enabled from pg_class where relnamespace='public'::regnamespace and relkind='r'",
      )
    ).enabled,
    "RLS enabled on every public table",
  );
  await as("anon", async () => {
    check(
      (await q("select * from public.discoveries")).rows.length === 6,
      "Public discovery browsing",
    );
    check(
      (await q("select * from public.comments")).rows.length === 0,
      "Public discussion browsing",
    );
    await denied(
      () => q("select * from public.profiles"),
      "Anonymous private profile read",
    );
    await denied(
      () =>
        q("select public.set_account_access($1,'Admin','{}','{}')", [
          ids.reader,
        ]),
      "Anonymous admin RPC",
    );
    await denied(
      () =>
        q(
          "insert into public.code_requests(discovery_id,explanation) values ('AI-001','Read the implementation')",
        ),
      "Anonymous code request",
    );
  });
  for (const [name, id] of Object.entries(ids)) {
    await q(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,$3,$4)",
      [
        id,
        `${name}@example.test`,
        name === "unverified" ? null : new Date().toISOString(),
        JSON.stringify({
          full_name: name,
          role: "Admin",
          approved_topics: ["bandit-theory"],
        }),
      ],
    );
  }
  check(
    (
      await one(
        "select count(*)::int as n from public.user_roles where role='Reader'",
      )
    ).n === 7,
    "Every signup is Reader, ignoring role metadata",
  );
  check(
    (await one("select count(*)::int as n from public.reviewer_topics")).n ===
      0,
    "Metadata cannot seed reviewer topics",
  );
  let bootstrap = await fs.readFile(
    new URL("../supabase/bootstrap-admin.sql", import.meta.url),
    "utf8",
  );
  await denied(() => db.exec(bootstrap), "Unedited admin bootstrap fails", [
    "P0001",
  ]);
  await db.exec("rollback");
  const unverifiedBootstrap = bootstrap
    .replace("00000000-0000-0000-0000-000000000000", ids.unverified)
    .replace("REPLACE_WITH_YOUR_VERIFIED_EMAIL", "unverified@example.test");
  await denied(
    () => db.exec(unverifiedBootstrap),
    "Unverified bootstrap fails",
    ["P0001"],
  );
  await db.exec("rollback");
  bootstrap = bootstrap
    .replace("00000000-0000-0000-0000-000000000000", ids.owner)
    .replace("REPLACE_WITH_YOUR_VERIFIED_EMAIL", "owner@example.test");
  await db.exec(bootstrap);
  check(
    (
      await one("select role from public.user_roles where user_id=$1", [
        ids.owner,
      ])
    ).role === "Admin",
    "Verified owner bootstrap",
  );
  await denied(() => db.exec(bootstrap), "Bootstrap cannot replace owner", [
    "P0001",
  ]);
  await db.exec("rollback");

  await as("reader", async () => {
    check(
      (await q("select id from public.profiles")).rows.length === 1,
      "Reader sees only own private profile",
    );
    await q(
      "update public.profiles set full_name='Reader edited',fields=array['Artificial Intelligence'],expertise_topics=array['bandit-theory'],evidence='Private application evidence' where id=$1",
      [ids.reader],
    );
    check(
      (await one("select full_name from public.profiles")).full_name ===
        "Reader edited",
      "Own profile persists",
    );
    await denied(
      () =>
        q(
          "update public.profiles set expertise_topics=array['exoplanets'] where id=$1",
          [ids.reader],
        ),
      "Field/topic mismatch",
    );
    await denied(
      () => q("update public.profiles set id=$1", [ids.owner]),
      "Cannot rewrite profile identity",
    );
    await denied(
      () =>
        q("update public.user_roles set role='Admin' where user_id=$1", [
          ids.reader,
        ]),
      "Cannot self-promote role",
    );
    await denied(
      () =>
        q("insert into public.user_roles values ($1,'Admin')", [ids.reader]),
      "Cannot insert own role",
    );
    await denied(
      () =>
        q("insert into public.reviewer_topics values ($1,'bandit-theory')", [
          ids.reader,
        ]),
      "Cannot self-grant topics",
    );
    await denied(
      () =>
        q("insert into public.approver_topics values ($1,'bandit-theory')", [
          ids.reader,
        ]),
      "Cannot self-grant approver topics",
    );
    await denied(
      () =>
        q(
          "select public.set_account_access($1,'Approver',array['bandit-theory'],array['bandit-theory'])",
          [ids.reader],
        ),
      "Reader cannot appoint approver",
    );
    check(
      (
        await q(
          "update public.discoveries set status='Published' where id='AI-001' returning id",
        )
      ).rows.length === 0,
      "Reader cannot change status",
    );
    check(
      (
        await q(
          "delete from public.discoveries where id='AST-003' returning id",
        )
      ).rows.length === 0,
      "Reader cannot delete discovery",
    );
    await denied(
      () =>
        q(
          "insert into public.discoveries(id,title,field,topic,status,summary,version) values('AI-999','Forbidden record','Artificial Intelligence','bandit-theory','Published','Should fail','v1')",
        ),
      "Reader cannot create discovery",
    );
    await denied(
      () =>
        q(
          "insert into public.comments(discovery_id,version,reference,body) values('AI-001','v0.2','Assumption A1','A reader cannot post.')",
        ),
      "Reader cannot discuss",
    );
    await denied(
      () =>
        q(
          "insert into public.code_requests(discovery_id,user_id,explanation) values('AI-001',$1,'Forged researcher request')",
          [ids.owner],
        ),
      "Cannot forge code request",
    );
    await q(
      "insert into public.code_requests(discovery_id,explanation) values('AI-001','Please share code for independent inspection')",
    );
    check(
      (await q("select * from public.code_requests")).rows.length === 1,
      "Own code request stored",
    );
    await denied(
      () =>
        q(
          "insert into public.code_requests(discovery_id,explanation) values('AI-001','   ')",
        ),
      "Blank code request denied",
    );
    await denied(
      () =>
        q(
          "insert into public.reviewer_applications(user_id,topics,evidence,status) values($1,array['bandit-theory'],'My research evidence','Approved')",
          [ids.reader],
        ),
      "Cannot forge approved application",
    );
    await q(
      "insert into public.reviewer_applications(topics,evidence) values(array['bandit-theory'],'My research evidence and thesis')",
    );
    await denied(
      () =>
        q(
          "insert into public.reviewer_applications(topics,evidence) values(array['bandit-theory'],'Duplicate pending evidence')",
        ),
      "Only one pending application",
    );
  });
  const banditApplication = (
    await one("select id from public.reviewer_applications where user_id=$1", [
      ids.reader,
    ])
  ).id;
  await as("outsider", async () => {
    check(
      (await q("select * from public.code_requests")).rows.length === 0,
      "Private code requests",
    );
    check(
      (await q("select * from public.reviewer_applications")).rows.length === 0,
      "Private applications",
    );
    await q(
      "insert into public.reviewer_applications(topics,evidence) values(array['exoplanets'],'My astronomy research evidence')",
    );
  });
  const astroApplication = (
    await one("select id from public.reviewer_applications where user_id=$1", [
      ids.outsider,
    ])
  ).id;
  await as("owner", async () => {
    check(
      (await q("select id from public.profiles")).rows.length === 7,
      "Admin can manage profiles",
    );
    await q(
      "select public.set_account_access($1,'Approver','{}',array['bandit-theory'])",
      [ids.approver],
    );
    await q(
      "select public.set_account_access($1,'Reviewer',array['bandit-theory'],'{}')",
      [ids.reviewer],
    );
    check(
      (
        await q(
          "update public.discoveries set status='Validated' where id='AI-001' returning id",
        )
      ).rows.length === 1,
      "Admin status update",
    );
    await q(
      "update public.discoveries set status='Awaiting Validation' where id='AI-001'",
    );
    await denied(
      () =>
        q("select public.set_account_access($1,'Admin','{}','{}')", [
          ids.reader,
        ]),
      "API cannot appoint second admin",
    );
    await denied(
      () =>
        q("select public.set_account_access($1,'Reader','{}','{}')", [
          ids.owner,
        ]),
      "API cannot demote initial admin",
    );
    await denied(
      () =>
        q(
          "select public.set_account_access($1,'Reviewer',array['bandit-theory'],'{}')",
          [ids.unverified],
        ),
      "Cannot grant unverified user access",
    );
    await denied(
      () =>
        q(
          "insert into public.comments(discovery_id,version,reference,body) values('AI-001','v0.2','Section','Admin without reviewer topics')",
        ),
      "Admin does not bypass reviewer topic scope",
    );
  });
  await as("approver", async () => {
    check(
      (await q("select id from public.reviewer_applications")).rows.length ===
        1,
      "Approver sees only scope applications",
    );
    check(
      (await q("select id from public.profiles")).rows.length === 2,
      "Approver sees own and relevant applicant profiles",
    );
    await denied(
      () =>
        q(
          "select public.set_account_access($1,'Approver','{}',array['bandit-theory'])",
          [ids.reader],
        ),
      "Approver cannot appoint approver",
    );
    check(
      (
        await q(
          "update public.discoveries set title='Forbidden' where id='AI-001' returning id",
        )
      ).rows.length === 0,
      "Approver cannot edit content",
    );
    await denied(
      () =>
        q("select public.review_application($1,true,$2)", [
          astroApplication,
          "Outside my scope",
        ]),
      "Approver cannot approve astronomy",
    );
    await denied(
      () =>
        q(
          "select public.create_invitation(array['exoplanets'],'invitee@example.test')",
        ),
      "Approver cannot invite astronomy",
    );
    await q(
      "insert into public.reviewer_applications(topics,evidence) values(array['bandit-theory'],'Approver own research evidence')",
    );
    const own = (
      await one(
        "select id from public.reviewer_applications where user_id=$1",
        [ids.approver],
      )
    ).id;
    await denied(
      () => q("select public.review_application($1,true,'Self review')", [own]),
      "Approver cannot self-approve",
    );
    await q(
      "select public.review_application($1,true,'Evidence reviewed within scope')",
      [banditApplication],
    );
    await denied(
      () =>
        q("select public.review_application($1,false,'Second decision')", [
          banditApplication,
        ]),
      "Application decisions immutable",
    );
    await denied(
      () =>
        q(
          "update public.reviewer_applications set status='Approved' where id=$1",
          [astroApplication],
        ),
      "Direct decision updates denied",
    );
    await denied(
      () =>
        q(
          "select public.create_invitation(array['bandit-theory'],'approver@example.test')",
        ),
      "Cannot self-invite",
    );
  });
  await as("reader", async () => {
    check(
      (
        await one("select role from public.user_roles where user_id=$1", [
          ids.reader,
        ])
      ).role === "Reviewer",
      "Approved applicant becomes Reviewer",
    );
    check(
      (
        await q(
          "select topic_id from public.reviewer_topics where user_id=$1",
          [ids.reader],
        )
      ).rows
        .map((x) => x.topic_id)
        .join() === "bandit-theory",
      "Only approved topic granted",
    );
    await q(
      "insert into public.comments(discovery_id,version,reference,body) values('AI-001','v0.2','Assumption A1','Does adaptive sampling affect the confidence event?')",
    );
    await denied(
      () =>
        q(
          "insert into public.comments(discovery_id,version,reference,body) values('AST-001','v0.1','Section 2','Bandit approval cannot post in astronomy')",
        ),
      "Reviewer cannot cross field scope",
    );
    await denied(
      () =>
        q(
          "insert into public.comments(discovery_id,author_id,version,reference,body) values('AI-001',$1,'v0.2','Section 2','Forged author identity')",
          [ids.owner],
        ),
      "Cannot forge comment author",
    );
    await denied(
      () =>
        q(
          "insert into public.comments(discovery_id,version,reference,body) values('AI-001','v0.1','Section 2','Wrong manuscript version')",
        ),
      "Current version enforced",
    );
  });
  const parent = (
    await one("select id from public.comments where author_id=$1", [ids.reader])
  ).id;
  await as("reviewer", async () => {
    await q(
      "insert into public.comments(discovery_id,parent_id,version,reference,body) values('AI-001',$1,'v0.2','','A simultaneous event may address this point.')",
      [parent],
    );
    check(
      (await q("select * from public.comments where parent_id=$1", [parent]))
        .rows.length === 1,
      "Threaded reply stored",
    );
    await denied(
      () =>
        q("update public.comments set body='Tampered' where id=$1", [parent]),
      "Discussion text immutable",
    );
    await denied(
      () => q("delete from public.comments where id=$1", [parent]),
      "Cannot delete another comment",
    );
  });
  // Give a second topic only to exercise cross-discovery parent integrity independently of RLS.
  await as("owner", () =>
    q(
      "select public.set_account_access($1,'Reviewer',array['bandit-theory','exoplanets'],'{}')",
      [ids.reviewer],
    ),
  );
  await as("reviewer", () =>
    denied(
      () =>
        q(
          "insert into public.comments(discovery_id,parent_id,version,reference,body) values('AST-002',$1,'v1.1','Figure 1','Reply points to another discovery')",
          [parent],
        ),
      "Cross-discovery reply denied",
    ),
  );
  await as("owner", () =>
    q("update public.discoveries set version='v0.3' where id='AI-001'"),
  );
  await as("reader", async () => {
    await denied(
      () =>
        q(
          "insert into public.comments(discovery_id,parent_id,version,reference,body) values('AI-001',$1,'v0.3','A1','Reply across manuscript versions')",
          [parent],
        ),
      "Cross-version reply denied",
    );
    check(
      (await q("select * from public.comments where version='v0.2'")).rows
        .length === 2,
      "Previous version discussion remains readable",
    );
    await q(
      "insert into public.comments(discovery_id,parent_id,version,reference,body) values('AI-001',$1,'v0.2','A1','Continue this discussion against the original version.')",
      [parent],
    );
    check(
      (await q("select * from public.comments where version='v0.2'")).rows
        .length === 3,
      "Replies preserve the original manuscript version after a revision",
    );
  });

  let invitation;
  await as("approver", async () => {
    invitation = (
      await one(
        "select public.create_invitation(array['bandit-theory'],'invitee@example.test') as invitation",
      )
    ).invitation;
    check(
      invitation.code.length === 64,
      "High-entropy invitation token returned once",
    );
    await denied(
      () => q("select code_hash from public.invitations"),
      "Invitation hash not exposed",
    );
    check(
      (await q("select id,topics,intended_email from public.invitations")).rows
        .length === 1,
      "Creator sees safe invitation metadata",
    );
  });
  const stored = (
    await one("select code_hash from public.invitations where id=$1", [
      invitation.id,
    ])
  ).code_hash;
  check(stored !== invitation.code, "Only hash stored in database");
  await as("outsider", () =>
    denied(
      () => q("select public.preview_invitation($1)", [invitation.code]),
      "Wrong email cannot preview invitation",
    ),
  );
  await as("invitee", async () => {
    const preview = (
      await one("select public.preview_invitation($1) as preview", [
        invitation.code,
      ])
    ).preview;
    check(
      preview.topics.join() === "bandit-theory" && !("code" in preview),
      "Preview exposes exact scope without new token",
    );
    check(
      (await q("select * from public.reviewer_topics")).rows.length === 0,
      "Preview does not grant privileges",
    );
    await denied(
      () =>
        q("select public.accept_invitation($1,array['exoplanets'])", [
          invitation.code,
        ]),
      "Wrong scope confirmation denied",
    );
    await denied(
      () => q("select public.accept_invitation($1,'{}')", [invitation.code]),
      "Empty scope confirmation denied",
    );
    await q("select public.accept_invitation($1,array['bandit-theory'])", [
      invitation.code,
    ]);
    check(
      (await q("select * from public.reviewer_topics")).rows.length === 1,
      "Confirmed invitation grants only intended topics",
    );
    await denied(
      () =>
        q("select public.accept_invitation($1,array['bandit-theory'])", [
          invitation.code,
        ]),
      "Invitation cannot be reused",
    );
  });
  let revokedInvitation;
  await as("approver", async () => {
    revokedInvitation = (
      await one(
        "select public.create_invitation(array['bandit-theory'],'outsider@example.test') as invitation",
      )
    ).invitation;
  });
  await as("owner", () =>
    q("select public.set_account_access($1,'Reader','{}','{}')", [
      ids.approver,
    ]),
  );
  await as("outsider", () =>
    denied(
      () => q("select public.preview_invitation($1)", [revokedInvitation.code]),
      "Revoked approver invitation becomes unusable",
    ),
  );
  await as("unverified", async () => {
    await denied(
      () =>
        q(
          "insert into public.code_requests(discovery_id,explanation) values('AI-001','Unverified request should fail')",
        ),
      "Unverified user cannot mutate",
    );
    check(
      (
        await q(
          "update public.profiles set full_name='Unverified edit' returning id",
        )
      ).rows.length === 0,
      "Unverified profile write denied",
    );
    await denied(
      () => q("select public.preview_invitation($1)", [invitation.code]),
      "Unverified invitation use denied",
    );
  });
  await as("anon", async () => {
    const authors = (await q("select * from public.get_public_authors()")).rows;
    check(
      authors.length === 2 &&
        Object.keys(authors[0]).sort().join() === "full_name,id",
      "Public attribution contains only author id and name",
    );
    await denied(
      () => q("select * from public.access_audit"),
      "Private audit history",
    );
  });
  await as("owner", async () => {
    check(
      (await q("select * from public.access_audit")).rows.length >= 6,
      "Access decisions audited",
    );
    await q("select public.set_account_access($1,'Reader','{}','{}')", [
      ids.reader,
    ]);
  });
  await as("reader", () =>
    denied(
      () =>
        q(
          "insert into public.comments(discovery_id,version,reference,body) values('AI-001','v0.3','A1','Revoked reviewer cannot discuss')",
        ),
      "Revoked topic immediately removes posting access",
    ),
  );
  console.log(
    `Database permission checks passed: ${checks}. Real migrations executed in PGlite PostgreSQL; hosted Auth/email/API still require integration testing.`,
  );
} finally {
  await db.close();
}
