const encoder = new TextEncoder();

function jsonResponse(message, status) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

async function secretMatches(provided, expected) {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function cloudflareResult(response) {
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}`);
  }
  return payload.result;
}

async function enroll(email, env) {
  const policiesUrl =
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}` +
    `/access/apps/${env.GRAFANA_APP_ID}/policies`;
  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const policies = await cloudflareResult(
    await fetch(`${policiesUrl}?per_page=1000`, { headers }),
  );
  const alreadyEnrolled = policies.some((policy) =>
    policy.include.some(
      (rule) => rule.email?.email?.toLowerCase() === email,
    ),
  );
  if (alreadyEnrolled) return false;

  const emailHash = await crypto.subtle.digest("SHA-256", encoder.encode(email));
  const suffix = [...new Uint8Array(emailHash)]
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const body = {
    name: `Invite ${suffix}`,
    decision: "allow",
    precedence: policies.length + 1,
    include: [{ email: { email } }],
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

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/join") {
    return jsonResponse("Not found", 404);
  }

  const invite = url.searchParams.get("invite") ?? "";
  if (!(await secretMatches(invite, env.INVITE_TOKEN))) {
    return jsonResponse("This invitation is invalid", 403);
  }
  if (Date.now() >= Number(env.INVITE_EXPIRES_AT)) {
    return jsonResponse("This invitation has expired", 410);
  }
  if (!ctx.access) return jsonResponse("Cloudflare Access is required", 403);

  const identity = await ctx.access.getIdentity();
  const email = identity?.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return jsonResponse("Cloudflare Access did not provide an email", 403);
  }

  try {
    const added = await enroll(email, env);
    console.log(JSON.stringify({ event: "grafana_invite_redeemed", added }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "grafana_invite_redeem_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return jsonResponse("Enrollment failed; ask the administrator to retry", 502);
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: "https://stats.t3play.dev/login",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export default {
  fetch: handleRequest,
};
