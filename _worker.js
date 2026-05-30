import { onRequestGet as dashboardGet, onRequestOptions as dashboardOptions } from "./functions/api/dashboard.js";
import { onRequestPost as registerPost } from "./functions/api/register.js";
import { onRequestPost as trackVisitPost } from "./functions/api/track-visit.js";

const apiHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

function methodNotAllowed() {
  return new Response(null, { status: 405, headers: apiHeaders });
}

function makeContext(request, env, ctx) {
  return {
    request,
    env,
    waitUntil: ctx?.waitUntil?.bind(ctx),
    next: () => env.ASSETS.fetch(request),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const context = makeContext(request, env, ctx);

    if (url.pathname === "/api/register") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders });
      if (request.method === "POST") return registerPost(context);
      return methodNotAllowed();
    }

    if (url.pathname === "/api/track-visit") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders });
      if (request.method === "POST") return trackVisitPost(context);
      return methodNotAllowed();
    }

    if (url.pathname === "/api/dashboard") {
      if (request.method === "OPTIONS") return dashboardOptions(context);
      if (request.method === "GET") return dashboardGet(context);
      return methodNotAllowed();
    }

    return env.ASSETS.fetch(request);
  },
};
