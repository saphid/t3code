const encoder = new TextEncoder();
const MAX_INVITE_ENROLLMENTS = 25;
const MAX_FORM_BYTES = 4096;
const POLICY_PAGE_SIZE = 100;
const CLOUDFLARE_POLICY_PREFIX = "Cloudflare";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function jsonResponse(message, status) {
  return Response.json(
    { error: message },
    { status, headers: securityHeaders },
  );
}

function htmlResponse(body, status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>T3 performance dashboards</title><style>
body{font:16px system-ui,sans-serif;background:#111827;color:#f9fafb;display:grid;min-height:100vh;margin:0;place-items:center}
main{box-sizing:border-box;max-width:34rem;padding:2rem;width:100%}h1{font-size:1.6rem}p{color:#d1d5db;line-height:1.5}
label{display:block;margin:1.5rem 0 .5rem}input,button,a.button{box-sizing:border-box;border-radius:.5rem;font:inherit;padding:.8rem;width:100%}
input{background:#fff;border:0;color:#111827}button,a.button{background:#f97316;border:0;color:#fff;cursor:pointer;display:block;font-weight:700;margin-top:1rem;text-align:center;text-decoration:none}
</style></head><body><main>${body}</main></body></html>`, {
    status,
    headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function secretMatches(provided, expected) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function validInvitation(invite, env) {
  const expiresAt = Number(env.INVITE_EXPIRES_AT);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt && await secretMatches(invite, env.INVITE_TOKEN);
}

async function cloudflareResult(response) {
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}`);
  }
  return payload.result;
}

async function readPolicies(policiesUrl, headers) {
  const policies = [];
  for (let page = 1; ; page += 1) {
    const url = `${policiesUrl}?per_page=${POLICY_PAGE_SIZE}&page=${page}`;
    const result = await cloudflareResult(await fetch(url, { headers }));
    policies.push(...result);
    if (result.length < POLICY_PAGE_SIZE) return policies;
  }
}

async function readBoundedForm(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) return null;
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FORM_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

async function enroll(email, env) {
  const policiesUrl =
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}` +
    `/access/apps/${env.GRAFANA_APP_ID}/policies`;
  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const policies = await readPolicies(policiesUrl, headers);
  const alreadyEnrolled = policies.some((policy) => policy.decision === "allow" &&
    policy.include?.some(
      (rule) => rule.email?.email?.toLowerCase() === email,
    ),
  );
  if (alreadyEnrolled) return false;

  const enrollmentEmails = new Set(policies
    .filter((policy) => policyRequiresLoginMethod(policy, env.OTP_IDP_ID))
    .flatMap((policy) => policy.include ?? [])
    .flatMap((rule) => rule.email?.email ? [rule.email.email.toLowerCase()] : []));
  if (enrollmentEmails.size >= MAX_INVITE_ENROLLMENTS) {
    throw new Error("Invitation enrollment limit reached");
  }

  const suffix = await emailPolicySuffix(email);
  const body = {
    name: `Invite ${suffix}`,
    decision: "allow",
    precedence: Math.max(0, ...policies.map((policy) => policy.precedence ?? 0)) + 1,
    include: [{ email: { email } }],
    require: [{ login_method: { id: env.OTP_IDP_ID } }],
  };
  await cloudflareResult(
    await fetch(policiesUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  return true;
}

async function emailPolicySuffix(email) {
  const emailHash = await crypto.subtle.digest("SHA-256", encoder.encode(email));
  const suffix = [...new Uint8Array(emailHash)]
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return suffix;
}

function policyIncludesEmail(policy, email) {
  return policy.decision === "allow" && policy.include?.some(
    (rule) => rule.email?.email?.toLowerCase() === email,
  );
}

function policyRequiresLoginMethod(policy, identityProviderId) {
  return policy.require?.some(
    (rule) => rule.login_method?.id === identityProviderId,
  );
}

async function enableCloudflareLogin(email, env) {
  const policiesUrl =
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}` +
    `/access/apps/${env.GRAFANA_APP_ID}/policies`;
  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const policies = await readPolicies(policiesUrl, headers);
  const pinEnrollment = policies.some((policy) =>
    policyIncludesEmail(policy, email) &&
    policyRequiresLoginMethod(policy, env.OTP_IDP_ID),
  );
  if (!pinEnrollment) {
    throw new Error("No completed PIN enrollment exists for this email");
  }

  const alreadyEnabled = policies.some((policy) =>
    policyIncludesEmail(policy, email) &&
    policyRequiresLoginMethod(policy, env.CLOUDFLARE_IDP_ID),
  );
  if (alreadyEnabled) return false;

  const cloudflareEmails = new Set(policies
    .filter((policy) => policyRequiresLoginMethod(policy, env.CLOUDFLARE_IDP_ID))
    .flatMap((policy) => policy.include ?? [])
    .flatMap((rule) => rule.email?.email ? [rule.email.email.toLowerCase()] : []));
  if (cloudflareEmails.size >= MAX_INVITE_ENROLLMENTS) {
    throw new Error("Cloudflare account enrollment limit reached");
  }
  const suffix = await emailPolicySuffix(email);
  const body = {
    name: `${CLOUDFLARE_POLICY_PREFIX} ${suffix}`,
    decision: "allow",
    precedence: Math.max(0, ...policies.map((policy) => policy.precedence ?? 0)) + 1,
    include: [{ email: { email } }],
    exclude: [],
    require: [{ login_method: { id: env.CLOUDFLARE_IDP_ID } }],
  };
  await cloudflareResult(
    await fetch(policiesUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  return true;
}

function invitationForm(invite) {
  return htmlResponse(`<h1>Join the T3 performance dashboards</h1>
<p>Enter the email address you want to use. Cloudflare will send one verification code to that address when you continue to Grafana.</p>
<form method="post" action="/join"><input type="hidden" name="invite" value="${escapeHtml(invite)}">
<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required>
<button type="submit">Accept invitation</button></form>`);
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === "/enroll" && request.method === "GET") {
    if (!ctx?.access) return jsonResponse("Cloudflare Access authentication required", 403);
    try {
      const identity = await ctx.access.getIdentity();
      const email = String(identity?.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return jsonResponse("Authenticated identity has no valid email", 403);
      }
      const added = await enableCloudflareLogin(email, env);
      console.log(JSON.stringify({ event: "grafana_cloudflare_login_enabled", added }));
      return htmlResponse(`<h1>Cloudflare account login is ready</h1>
<p>Your verified email is enrolled. You can use Grafana now; on a future sign-in, choose your Cloudflare account instead of requesting another PIN.</p>
<a class="button" href="https://stats.t3play.dev/">Open Grafana</a>`);
    } catch (error) {
      console.error(JSON.stringify({
        event: "grafana_cloudflare_login_enable_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }));
      return htmlResponse("<h1>Cloudflare login could not be enabled</h1><p>Ask the administrator to retry.</p>", 403);
    }
  }

  if (url.pathname !== "/join" || !["GET", "POST"].includes(request.method)) {
    return jsonResponse("Not found", 404);
  }

  if (request.method === "GET") {
    const invite = url.searchParams.get("invite") ?? "";
    if (!(await secretMatches(invite, env.INVITE_TOKEN))) {
      return jsonResponse("This invitation is invalid", 403);
    }
    const expiresAt = Number(env.INVITE_EXPIRES_AT);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      return jsonResponse("This invitation has expired", 410);
    }
    return invitationForm(invite);
  }

  const form = await readBoundedForm(request);
  if (!form) return htmlResponse("<h1>That form could not be accepted</h1><p>Return to the invitation link and try again.</p>", 413);
  const invite = String(form.get("invite") ?? "");
  if (!(await validInvitation(invite, env))) {
    return htmlResponse("<h1>This invitation is invalid or expired</h1><p>Ask for a fresh invitation link.</p>", 403);
  }
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return htmlResponse("<h1>Enter a valid email address</h1><p>Return to the invitation link and try again.</p>", 400);
  }

  try {
    const added = await enroll(email, env);
    console.log(JSON.stringify({ event: "grafana_invite_redeemed", added }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "grafana_invite_redeem_failed",
      error: error instanceof Error ? error.message : "unknown error",
    }));
    return htmlResponse("<h1>Enrollment failed</h1><p>Ask the administrator to retry.</p>", 502);
  }

  return htmlResponse(`<h1>Your invitation is ready</h1>
<p>Cloudflare may take a few seconds to apply it. Continue once and enter the single verification code sent to your email. That verified login will also enable your Cloudflare account for future visits.</p>
<a class="button" href="https://stats.t3play.dev/enroll">Verify email and continue</a>`);
}

export default { fetch: handleRequest };
