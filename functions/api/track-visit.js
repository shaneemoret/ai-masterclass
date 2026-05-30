// POST /api/track-visit
// Lightweight page-view tracking for the live event dashboard.

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const path = normalize(body.path, 240) || '/';
  const referrer = normalize(body.referrer, 700);
  const landingVariant = normalizeVariant(body.landingVariant || body.landing_variant);
  const campaignId = normalizeCampaignId(body.campaignId || body.campaign_id || body.broadcastId || body.broadcast_id || body.utm_campaign);
  const campaignSource = normalizeSource(body.campaignSource || body.campaign_source || body.utm_source);
  const visitorId = normalizeVisitorId(body.visitorId || body.visitor_id);
  const userAgent = normalize(request.headers.get('user-agent'), 700);
  const country = normalize(request.cf?.country, 12);
  const visitorKey = await buildVisitorKey(request, userAgent);

  await env.DB.prepare(
    `INSERT INTO page_visits (path, referrer, user_agent, country, landing_variant, campaign_id, campaign_source, visitor_key, visitor_id, visited_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(path, referrer, userAgent, country, landingVariant, campaignId, campaignSource, visitorKey, visitorId, new Date().toISOString()).run();

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function normalize(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeVariant(value) {
  const variant = normalize(value, 32).toLowerCase();
  return [
    'control',
    'execution',
    'hormozi_registration',
    'april_structure_codex',
    'operator_build_codex_short',
    'qualified_owner_operator',
    'owner_operator_fast_path',
    'final_day_codex_revenue',
    'chatgpt_next_step_owner',
    'tomorrow_codex_work_session',
    'last_call_owner_codex',
    'last_call_operator_proof',
    'calendar_first_codex_workshop',
    'ai_revenue_system',
    'no_hype_ai_clinic',
  ].includes(variant)
    ? variant
    : 'unknown';
}

function normalizeCampaignId(value) {
  const id = normalize(value, 120).toLowerCase();
  if (!id) return null;
  return id.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

function normalizeSource(value) {
  const source = normalize(value, 60).toLowerCase();
  if (!source) return null;
  return source.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

function normalizeVisitorId(value) {
  const id = normalize(value, 80);
  return /^[a-z0-9._:-]{16,80}$/i.test(id) ? id : null;
}

async function buildVisitorKey(request, userAgent) {
  const ip = normalize(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0], 80);
  const language = normalize(request.headers.get('accept-language'), 120);
  const material = `${ip}|${userAgent}|${language}`;
  if (!ip && !userAgent && !language) return null;
  const bytes = new TextEncoder().encode(material);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
