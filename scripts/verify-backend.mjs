// Opt-in hosted Supabase check. Supply an existing confirmed Reader through
// process environment variables; never put test passwords in Git or VITE_* vars.
// This does not register accounts, fabricate research records, or send email.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const names = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SCIDA_TEST_READER_EMAIL",
  "SCIDA_TEST_READER_PASSWORD",
];
const missing = names.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(
    `Hosted verification requires process environment variables: ${missing.join(", ")}. No checks were run.`,
  );
  process.exitCode = 1;
} else {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  let first;
  let fresh;
  let checks = 0;
  let userId;
  class CheckFailure extends Error {}
  const verified = (value, message) => {
    assert.ok(value, message);
    checks++;
  };
  const requireOk = (response, message) => {
    if (response.error) throw new CheckFailure(message);
    return response.data;
  };
  const expectDenied = (response, message, allowEmpty = false) => {
    if (
      response.error?.code === "42501" ||
      (!response.error &&
        allowEmpty &&
        Array.isArray(response.data) &&
        response.data.length === 0)
    ) {
      checks++;
      return;
    }
    throw new CheckFailure(
      `${message} Access was not rejected by a permission policy.`,
    );
  };
  const signIn = async (client) => {
    const { data, error } = await client.auth.signInWithPassword({
      email: process.env.SCIDA_TEST_READER_EMAIL,
      password: process.env.SCIDA_TEST_READER_PASSWORD,
    });
    if (error || !data.user?.email_confirmed_at || !data.session) {
      throw new CheckFailure(
        "Real login failed. Supply an existing confirmed Reader account and working Auth configuration.",
      );
    }
    return data.user;
  };
  try {
    const parsed = new URL(url);
    verified(
      parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname)),
      "Use an HTTPS Supabase URL (localhost may use HTTP).",
    );
    let legacyRole;
    if (key.split(".").length === 3) {
      try {
        legacyRole = JSON.parse(
          Buffer.from(key.split(".")[1], "base64url").toString(),
        ).role;
      } catch {
        /* invalid key is rejected below */
      }
    }
    verified(
      key.startsWith("sb_publishable_") || legacyRole === "anon",
      "Only a frontend publishable/anon key is accepted; privileged keys are forbidden.",
    );
    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
    first = createClient(url, key, options);
    const user = await signIn(first);
    userId = user.id;
    checks++;
    const profile = requireOk(
      await first
        .from("profiles")
        .select("id,full_name")
        .eq("id", userId)
        .single(),
      "Cannot read the authenticated profile. Apply the migrations first.",
    );
    verified(
      profile?.id === userId,
      "Profile identity does not match the real login.",
    );
    const role = requireOk(
      await first
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single(),
      "Cannot read own role.",
    );
    verified(
      role?.role === "Reader",
      "Use a dedicated existing Reader account; privileged accounts cannot run this check.",
    );
    for (const table of ["reviewer_topics", "approver_topics"]) {
      const topics = requireOk(
        await first.from(table).select("topic_id").eq("user_id", userId),
        `Cannot read own ${table}.`,
      );
      verified(
        topics.length === 0,
        "The test Reader must have no reviewer or approver topics.",
      );
    }
    const discoveries = requireOk(
      await first.from("discoveries").select("id,status").order("id").limit(1),
      "Cannot read discoveries.",
    );
    verified(
      discoveries.length === 1,
      "Seed at least one discovery before running the hosted checks.",
    );
    const discovery = discoveries[0];

    // Idempotent write: no invented profile text or other research records.
    const written = requireOk(
      await first
        .from("profiles")
        .update({ full_name: profile.full_name })
        .eq("id", userId)
        .select("id,full_name")
        .single(),
      "Reader cannot update their own profile.",
    );
    verified(
      written.full_name === profile.full_name,
      "Profile update did not return the saved value.",
    );
    fresh = createClient(url, key, options);
    const secondUser = await signIn(fresh);
    verified(
      secondUser.id === userId,
      "Fresh session authenticated as a different identity.",
    );
    const reread = requireOk(
      await fresh
        .from("profiles")
        .select("id,full_name")
        .eq("id", userId)
        .single(),
      "Fresh session cannot read the saved profile.",
    );
    verified(
      reread.full_name === written.full_name,
      "Fresh session did not read the persisted profile value.",
    );

    // Idempotent protected writes still must be denied. Never request actual
    // elevated privileges from the live service, even if its policies are broken.
    const roleAttempt = await first
      .from("user_roles")
      .update({ role: "Reader" })
      .eq("user_id", userId)
      .select("user_id,role");
    expectDenied(
      roleAttempt,
      "Reader protected-role mutation check failed.",
      true,
    );
    for (const table of ["reviewer_topics", "approver_topics"]) {
      // A deliberately invalid topic cannot confer a usable review scope even
      // with broken grants. Only permission error 42501 passes; a constraint
      // rejection exposes the missing permission protection and fails the test.
      const grantAttempt = await first
        .from(table)
        .insert({ user_id: userId, topic_id: "__scida_permission_probe__" })
        .select("user_id,topic_id");
      expectDenied(
        grantAttempt,
        `Reader self-grant check failed for ${table}.`,
      );
    }
    const rpcAttempt = await first.rpc("set_account_access", {
      p_user_id: userId,
      p_role: "Reader",
      p_approved_topics: [],
      p_assigned_topics: [],
    });
    expectDenied(rpcAttempt, "Reader admin RPC check failed.");
    // Attempting the existing status tests UPDATE permission without changing research content.
    const statusAttempt = await first
      .from("discoveries")
      .update({ status: discovery.status })
      .eq("id", discovery.id)
      .select("id,status");
    expectDenied(statusAttempt, "Reader discovery status check failed.", true);
    const unchanged = requireOk(
      await fresh
        .from("discoveries")
        .select("status")
        .eq("id", discovery.id)
        .single(),
      "Cannot recheck discovery status.",
    );
    verified(
      unchanged.status === discovery.status,
      "Discovery status changed unexpectedly.",
    );
    const finalRole = requireOk(
      await fresh
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single(),
      "Cannot recheck account role.",
    );
    verified(
      finalRole.role === "Reader",
      "Test account no longer has the Reader role.",
    );
    console.log(
      `Hosted backend verification passed: ${checks} checks. Real email/password login, own-profile write and fresh-session read, and denied protected account/topic/discovery mutations verified. No elevated privileges requested or fabricated accounts created.`,
    );
  } catch (error) {
    // Report only our fixed check messages, never raw HTTP/Auth response objects.
    console.error(
      `Hosted backend verification FAILED: ${error instanceof assert.AssertionError || error instanceof CheckFailure ? error.message : "Connection or permission verification failed."}`,
    );
    process.exitCode = 1;
  } finally {
    for (const client of [fresh, first]) {
      if (client) {
        try {
          await client.auth.signOut({ scope: "local" });
        } catch {
          /* no session or connection */
        }
      }
    }
  }
}
