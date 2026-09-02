// POST /api/register
// Body: { name, email, businessOwner, landingVariant, campaignId, campaignSource, visitorId }
// Stores registration in D1 and sends welcome email via Resend.

const FROM = 'Shanee Moret <hello@growthacademy.global>';
const REPLY_TO = 'hello@growthacademy.global';
const INTERNAL_NOTIFICATION_TO = ['hello@growthacademy.global', 'support@growthacademy.global'];
const SITE = 'https://masterclass.growthacademy.global';
const ICS_URL = `${SITE}/series.ics`;
const REFERRAL_URL = `${SITE}/?utm_source=registrant-share&utm_campaign=july14-masterclass-welcome-email`;
const SERIES_ID = 'codex-masterclass-july-2026';
const SERIES_NAME = 'Build Your AI Agent Operating System Masterclass | Next Session Waitlist';
const RESEND_SIGNAL_SEGMENTS = [
  'Signal - Current Codex Masterclass July 2026',
  'Signal - Now Current Event',
  'Signal - Recent 0-30 Days',
  'Signal - Top Sales Follow-Up',
  'Signal - Offer AI Community',
  'Signal - AI Community Fit',
  'Signal - AI Community Hot',
  'Signal - Has Sales Signal',
  'Event Interest - AI Masterclass',
  'Event Signal - Registered For Event',
];
const HIGH_VALUE_CUSTOMER_SEGMENTS = [
  'Customers - CLV Greater Than 25',
  'Customer Signal - High Value',
];
const PRODUCT_SEGMENT_RULES = [
  ['Product - AI ChatGPT Codex', /ai|chatgpt|gpt|codex|agent setup|agent/i],
  ['Product - LinkedInpreneurs', /linkedinpreneurs/i],
  ['Product - LinkedIn Growth Course', /growth linkedin course|linkedin leads|linkedin growth|linkedin personal|linkedin content|linkedin marketing|linkedin \\+ ai/i],
  ['Product - Growth Academy Membership', /growth academy.*member|membership|4evergrowth/i],
  ['Product - Growthpreneurs', /growthpreneur|growthpreneurs/i],
  ['Product - Video Challenge', /video challenge|visibility video|grow video|live with shanee/i],
  ['Product - 1:1 Coaching', /1:1|one-on-one|coaching|coach|vip|strategy session|fast growth/i],
  ['Product - Masterclass', /masterclass|live training|training library|workshop/i],
  ['Product - Dashboard Tools', /dashboard|bundle|tool|template/i],
];
const RESEND_SIGNAL_PROPERTIES = [
  'signal_score',
  'signal_tier',
  'timeliness_band',
  'next_best_offer',
  'primary_interest',
  'all_interests',
  'source_signals',
  'value_tier',
  'customer_lifetime_value',
  'products_paid_for',
  'latest_signal_date',
  'current_masterclass_registered_at',
  'business_owner',
  'followup_angle',
  'evidence_summary',
];

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const name = String(body?.name || '').trim().slice(0, 200);
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 320);
  const landingVariant = normalizeVariant(body?.landingVariant || body?.landing_variant);
  const campaignId = normalizeCampaignId(
    body?.campaignId || body?.campaign_id || body?.broadcastId || body?.broadcast_id || body?.utm_campaign
  );
  const campaignSource = normalizeSource(body?.campaignSource || body?.campaign_source || body?.utm_source);
  const businessOwner = normalizeBusinessOwner(body?.businessOwner || body?.business_owner);
  const visitorId = normalizeVisitorId(body?.visitorId || body?.visitor_id);

  if (!name) return json({ ok: false, error: 'name_required' }, 400);
  if (!isValidEmail(email)) return json({ ok: false, error: 'email_invalid' }, 400);
  if (await isBlockedEmail(env, email)) {
    console.warn('blocked_registration_attempt', email);
    return json({ ok: false, error: 'registration_unavailable' }, 403);
  }

  // Upsert: same email re-registering keeps the row, updates name + timestamp.
  // This is the only synchronous work — everything else is backgrounded so the
  // user gets an instant ok:true and can move on. The slow Resend contact
  // property/segment sync was previously holding requests open ~6s and tanking
  // conversion because users bailed during the wait.
  await env.DB.prepare(
    `INSERT INTO registrations (email, name, registered_at, reminders_sent, landing_variant, campaign_id, campaign_source, visitor_id)
     VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       registered_at = excluded.registered_at,
       landing_variant = excluded.landing_variant,
       campaign_id = COALESCE(excluded.campaign_id, registrations.campaign_id),
       campaign_source = COALESCE(excluded.campaign_source, registrations.campaign_source),
       visitor_id = COALESCE(excluded.visitor_id, registrations.visitor_id)`
  ).bind(email, name, new Date().toISOString(), landingVariant, campaignId, campaignSource, visitorId).run();

  // Fire-and-forget: welcome email, internal notification, Resend contact sync.
  // waitUntil keeps the worker alive until these settle but does NOT delay the
  // response to the user.
  const backgroundWork = Promise.allSettled([
    sendWelcome({ env, name, email }).catch((error) => {
      console.error('welcome_email_error', error?.message || String(error));
    }),
    sendInternalRegistrationNotification({ env, name, email, businessOwner }).catch((error) => {
      console.error('internal_notification_error', error?.message || String(error));
    }),
    syncRegistrationContact({ env, name, email, businessOwner }).catch((error) => {
      console.error('resend_signal_sync_error', error?.message || String(error));
    }),
  ]);
  if (typeof waitUntil === 'function') {
    waitUntil(backgroundWork);
  }

  return json({
    ok: true,
    emailQueued: true,
    resendTagged: true,
    internalNotificationQueued: true,
  });
}

async function isBlockedEmail(env, email) {
  const row = await env.DB.prepare(
    `SELECT email FROM blocked_emails
     WHERE email = ?1 AND scope IN ('all_events', ?2)
     LIMIT 1`
  ).bind(email, SERIES_ID).first();
  return Boolean(row);
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeVariant(value) {
  const variant = String(value || '').trim().toLowerCase().slice(0, 32);
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
  const id = String(value || '').trim().toLowerCase().slice(0, 120);
  if (!id) return null;
  return id.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

function normalizeSource(value) {
  const source = String(value || '').trim().toLowerCase().slice(0, 60);
  if (!source) return null;
  return source.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

function normalizeVisitorId(value) {
  const id = String(value || '').trim().slice(0, 80);
  return /^[a-z0-9._:-]{16,80}$/i.test(id) ? id : null;
}

function normalizeBusinessOwner(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'true') return 'yes';
  if (normalized === 'no' || normalized === 'false') return 'no';
  return 'unknown';
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sendWelcome({ env, name, email }) {
  const firstName = name.split(/\s+/)[0] || 'there';

  const html = welcomeHtml({ firstName });
  const text = welcomeText({ firstName });

  const res = await fetchResend(env, 'POST', '/emails', {
    from: FROM,
    to: [email],
    reply_to: REPLY_TO,
    subject: "You're on the list: Build Your AI Agent Operating System",
    html,
    text,
    tags: [{ name: 'kind', value: 'welcome' }, { name: 'series', value: SERIES_ID }],
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('resend_error', res.status, err);
    return { ok: false };
  }
  return { ok: true };
}

async function sendInternalRegistrationNotification({ env, name, email, businessOwner }) {
  const registeredAt = new Date().toISOString();
  const subject = `New Codex Masterclass registration: ${name}`;
  const text = `New Codex Masterclass registration

Name: ${name}
Email: ${email}
Business owner: ${businessOwner}
Registered at: ${registeredAt}
Event: ${SERIES_NAME}
Time: announced with the next dates

Registration page:
${SITE}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>New registration</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827;line-height:1.5;margin:0;padding:24px;background:#ffffff;">
  <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;">New Codex Masterclass registration</h1>
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;">
    <tr><td style="font-weight:700;padding:4px 16px 4px 0;">Name</td><td style="padding:4px 0;">${escapeHtml(name)}</td></tr>
    <tr><td style="font-weight:700;padding:4px 16px 4px 0;">Email</td><td style="padding:4px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
    <tr><td style="font-weight:700;padding:4px 16px 4px 0;">Business owner</td><td style="padding:4px 0;">${escapeHtml(businessOwner)}</td></tr>
    <tr><td style="font-weight:700;padding:4px 16px 4px 0;">Registered</td><td style="padding:4px 0;">${escapeHtml(registeredAt)}</td></tr>
    <tr><td style="font-weight:700;padding:4px 16px 4px 0;">Event</td><td style="padding:4px 0;">${escapeHtml(SERIES_NAME)}</td></tr>
    <tr><td style="font-weight:700;padding:4px 16px 4px 0;">Time</td><td style="padding:4px 0;">announced with the next dates</td></tr>
  </table>
  <p style="margin:18px 0 0;"><a href="${SITE}" style="color:#005BFF;font-weight:700;">Open registration page</a></p>
</body></html>`;

  const res = await fetchResend(env, 'POST', '/emails', {
    from: FROM,
    to: INTERNAL_NOTIFICATION_TO,
    reply_to: email,
    subject,
    html,
    text,
    tags: [{ name: 'kind', value: 'internal-registration-notification' }, { name: 'series', value: SERIES_ID }],
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('resend_internal_notification_error', res.status, err);
    return { ok: false };
  }
  return { ok: true };
}

async function syncRegistrationContact({ env, name, email, businessOwner }) {
  try {
    await ensureContactProperties(env, RESEND_SIGNAL_PROPERTIES);
    const existingContact = await getExistingContact(env, email);
    const existingProperties = existingContact?.properties || {};
    const customerSignal = await getCustomerSignal(env, email);
    const segmentNames = [
      ...RESEND_SIGNAL_SEGMENTS,
      ...(customerSignal ? HIGH_VALUE_CUSTOMER_SEGMENTS : []),
      ...productSegments(customerSignal?.products_paid_for || propertyValue(existingProperties.products_paid_for)),
    ];
    const segmentIds = await getOrCreateSegments(env, uniqueValues(segmentNames));
    const registeredAt = new Date().toISOString();
    const firstName = name.split(/\s+/)[0] || '';
    const lastName = name.split(/\s+/).slice(1).join(' ');
    const sourceSignals = customerSignal
      ? 'current_codex_masterclass_july_2026, event_registered, customer_gt25, previous_high_value_customer'
      : 'current_codex_masterclass_july_2026, event_registered';
    const customerEvidence = customerSignal
      ? `High-value customer: $${Math.round(customerSignal.customer_lifetime_value)} CLV; ${customerSignal.products_paid_for || 'products on file'}`
      : '';
    const payload = {
      email,
      first_name: firstName,
      last_name: lastName,
      unsubscribed: false,
      segments: segmentIds.map((id) => ({ id })),
      properties: {
        signal_score: '100',
        signal_tier: 'hot_now',
        timeliness_band: 'now_current_event',
        next_best_offer: 'AI Community / Codex Masterclass follow-up',
        primary_interest: 'AI/Codex',
        all_interests: mergeCsv(propertyValue(existingProperties.all_interests), 'AI/Codex'),
        source_signals: mergeCsv(
          propertyValue(existingProperties.source_signals),
          sourceSignals
        ),
        value_tier: customerSignal?.value_tier || propertyValue(existingProperties.value_tier) || 'non_customer',
        customer_lifetime_value: String(
          customerSignal?.customer_lifetime_value ||
          propertyValue(existingProperties.customer_lifetime_value) ||
          ''
        ),
        products_paid_for: customerSignal?.products_paid_for || propertyValue(existingProperties.products_paid_for) || '',
        latest_signal_date: registeredAt.slice(0, 10),
        current_masterclass_registered_at: registeredAt,
        business_owner: businessOwner,
        followup_angle: customerSignal
          ? 'High-value customer just joined the Codex Masterclass waitlist. Prioritize personal follow-up and AI community invitation.'
          : 'Timely: just joined the Codex Masterclass waitlist. Follow up and invite to the AI community.',
        evidence_summary: appendEvidence(
          appendEvidence(propertyValue(existingProperties.evidence_summary), customerEvidence),
          `Registered for ${SERIES_NAME}`
        ),
      },
    };

    const created = await resend(env, 'POST', '/contacts', payload);
    const createdOk = created.ok || [400, 409, 422].includes(created.status);
    if (!createdOk) {
      console.error('resend_contact_create_error', created.status, JSON.stringify(created.data));
      return { ok: false };
    }

    if (!created.ok) {
      const updated = await resend(env, 'PATCH', `/contacts/${encodeURIComponent(email)}`, payload);
      if (!updated.ok) {
        console.error('resend_contact_update_error', updated.status, JSON.stringify(updated.data));
        return { ok: false };
      }
    }

    for (const segmentId of segmentIds) {
      const segmented = await resend(env, 'POST', `/contacts/${encodeURIComponent(email)}/segments/${segmentId}`);
      if (!segmented.ok && ![400, 409, 422].includes(segmented.status)) {
        console.error('resend_contact_segment_error', segmented.status, JSON.stringify(segmented.data));
        return { ok: false };
      }
    }
    return { ok: true };
  } catch (error) {
    console.error('resend_signal_sync_error', error?.message || String(error));
    return { ok: false };
  }
}

async function getCustomerSignal(env, email) {
  try {
    return await env.DB.prepare(
      `SELECT
         customer_lifetime_value,
         value_tier,
         products_paid_for,
         source_signals,
         evidence_summary
       FROM customer_signals
       WHERE email = ?1
         AND customer_lifetime_value > 25
       LIMIT 1`
    ).bind(email).first();
  } catch (error) {
    console.error('customer_signal_lookup_error', error?.message || String(error));
    return null;
  }
}

function productSegments(products) {
  const text = String(products || '');
  return PRODUCT_SEGMENT_RULES
    .filter(([, pattern]) => pattern.test(text))
    .map(([segment]) => segment);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

async function getExistingContact(env, email) {
  const existing = await resend(env, 'GET', `/contacts/${encodeURIComponent(email)}`);
  if (existing.ok) return existing.data;
  if (existing.status === 404) return null;
  throw new Error(`Could not retrieve contact ${email}: ${existing.status}`);
}

function propertyValue(property) {
  if (!property) return '';
  if (typeof property === 'string') return property;
  return String(property.value || '').trim();
}

function mergeCsv(existing, additions) {
  const values = new Map();
  for (const item of `${existing || ''},${additions || ''}`.split(',')) {
    const value = item.trim();
    if (value) values.set(value.toLowerCase(), value);
  }
  return [...values.values()].join(', ');
}

function appendEvidence(existing, addition) {
  const text = [existing, addition].filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim();
  return text.length > 1600 ? `${text.slice(0, 1597)}...` : text;
}

async function ensureContactProperties(env, keys) {
  const listed = await resend(env, 'GET', '/contact-properties');
  if (!listed.ok) throw new Error(`Could not list contact properties: ${listed.status}`);
  const existing = new Set((listed.data.data || []).map((property) => property.key));
  for (const key of keys) {
    if (existing.has(key)) continue;
    const created = await resend(env, 'POST', '/contact-properties', {
      key,
      type: 'string',
      fallbackValue: '',
    });
    if (!created.ok && ![400, 409, 422].includes(created.status) && !JSON.stringify(created.data).toLowerCase().includes('exist')) {
      throw new Error(`Could not create contact property ${key}: ${created.status}`);
    }
  }
}

async function getOrCreateSegments(env, names) {
  const listed = await resend(env, 'GET', '/segments');
  if (!listed.ok) throw new Error(`Could not list segments: ${listed.status}`);
  const byName = new Map((listed.data.data || []).map((segment) => [segment.name, segment.id]));
  const ids = [];
  for (const name of names) {
    if (!byName.has(name)) {
      const created = await resend(env, 'POST', '/segments', { name });
      if (!created.ok) throw new Error(`Could not create segment ${name}: ${created.status}`);
      byName.set(name, created.data.id);
    }
    ids.push(byName.get(name));
  }
  return ids.filter(Boolean);
}

async function resend(env, method, path, body) {
  const res = await fetchResend(env, method, path, body);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function fetchResend(env, method, path, body, attempt = 1) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      'authorization': `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status !== 429 || attempt >= 4) return res;

  const retryAfter = Number(res.headers.get('retry-after') || 0);
  await sleep(retryAfter > 0 ? retryAfter * 1000 : 750 * attempt);
  return fetchResend(env, method, path, body, attempt + 1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function welcomeText({ firstName }) {
  return `Hi ${firstName},

You're registered for the free 3-day Build Your AI Agent Operating System masterclass.

You're on the list for the next live session. You'll get the dates first, along with the live link and reminders.

What you'll learn:
  Day 1 — Your Business Context
  Day 2 — Your Follow-Up Engine
  Day 3 — Your Command Center

While you wait, watch recent live trainings: https://www.growthacademy.global/events

Know one business owner who uses ChatGPT and should learn how to put Codex to work?
Send them this registration page:
${REFERRAL_URL}

I'll send reminders before we start and during the series.

See you there.
Shanee Moret
${SITE}`;
}

function welcomeHtml({ firstName }) {
  // Blog-DNA brand system (matches masterclass.growthacademy.global + /blog):
  // #050505 paper, cobalt #0a72ff -> #1fb6ff, Inter Tight, monospace uppercase
  // chrome, hard edges (no rounded corners, no pills), '+' register marks,
  // hairline 1px rules. Email-client-safe: table layout, inline styles, web-safe
  // mono stack, all-caps via text-transform. Logic/URLs/dates unchanged.
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  const disp = "'Inter Tight',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>You're in.</title>
</head>
<body style="margin:0;padding:0;background:#050505;font-family:${disp};color:#ffffff;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">You're on the list for the free 3-day Build Your AI Agent Operating System masterclass. You'll get the next live dates first.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;">
  <tr><td align="center" style="padding:0 0 40px 0;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f10;border-bottom:1px solid #373737;">
      <tr><td align="center" style="padding:13px 16px;color:#1fb6ff;font-family:${mono};font-size:12px;line-height:1.3;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Live Masterclass &nbsp;|&nbsp; Next dates announced soon</td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
      <tr><td style="padding:36px 20px 0 20px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#101010;border:1px solid #373737;">
          <tr><td style="padding:14px 30px 0 30px;">
            <div style="font-family:${mono};font-size:18px;line-height:1;color:#1fb6ff;">+</div>
          </td></tr>
          <tr><td style="padding:14px 30px 34px 30px;">

            <div style="font-family:${mono};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1fb6ff;margin:0 0 16px 0;">/ You're registered</div>

            <h1 style="font-family:${disp};font-size:46px;line-height:0.92;font-weight:600;letter-spacing:-0.01em;color:#ffffff;margin:0 0 20px 0;">Hi ${escapeHtml(firstName)}.<br>You're <span style="color:#1fb6ff;border-bottom:3px solid #0a72ff;">in</span>.</h1>

            <p style="color:#ffffff;font-size:18px;line-height:1.4;margin:0 0 18px 0;font-weight:500;">Your seat is saved for the free 3-day <span style="color:#1fb6ff;font-weight:700;">Build Your AI Agent Operating System</span> masterclass.</p>
            <p style="color:#b8b8c0;font-size:15px;line-height:1.6;margin:0 0 30px 0;">You're first in line for the next live dates. As soon as they're set, you'll get them here, along with the live link and reminders before each session.</p>

            <div style="font-family:${mono};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#1fb6ff;padding-bottom:12px;border-bottom:1px solid #373737;margin-bottom:0;">What you'll learn</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px 0;">
              <tr><td style="padding:18px 0;border-bottom:1px solid #252525;">
                <div style="font-family:${mono};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7f8590;margin-bottom:7px;">Day 1</div>
                <div style="font-family:${disp};color:#ffffff;font-size:21px;line-height:1.1;font-weight:600;">Your Business Context</div>
              </td></tr>
              <tr><td style="padding:18px 0;border-bottom:1px solid #252525;">
                <div style="font-family:${mono};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7f8590;margin-bottom:7px;">Day 2</div>
                <div style="font-family:${disp};color:#ffffff;font-size:21px;line-height:1.1;font-weight:600;">Your Follow-Up Engine</div>
              </td></tr>
              <tr><td style="padding:18px 0;">
                <div style="font-family:${mono};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7f8590;margin-bottom:7px;">Day 3</div>
                <div style="font-family:${disp};color:#ffffff;font-size:21px;line-height:1.1;font-weight:600;">Your Command Center</div>
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px 0;background:#0c0f16;border:1px solid #373737;"><tr><td style="padding:18px 22px;color:#b8b8c0;font-size:14px;line-height:1.6;">While you wait: watch recent live trainings on the replay hub at <a href="https://www.growthacademy.global/events" style="color:#1fb6ff;text-decoration:none;">growthacademy.global/events</a>.</td></tr></table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px 0;background:#0c0f16;border:1px solid #373737;">
              <tr><td style="padding:24px 22px;">
                <div style="font-family:${mono};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1fb6ff;margin-bottom:10px;">/ Bring one qualified owner</div>
                <div style="font-family:${disp};color:#ffffff;font-size:19px;line-height:1.2;font-weight:600;margin-bottom:12px;">Know an owner who uses ChatGPT and should learn to put Codex to work?</div>
                <p style="color:#b8b8c0;font-size:14px;line-height:1.6;margin:0 0 18px 0;">Send this to one founder, agency owner, consultant, coach, or service-business operator who already uses ChatGPT and needs the next step: AI helping with lead follow-up, content, websites, tools, and operations.</p>
                <a href="${REFERRAL_URL}" style="display:inline-block;color:#1fb6ff;text-decoration:none;font-family:${mono};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #0a72ff;padding-bottom:4px;">Share the free masterclass &rarr;</a>
              </td></tr>
            </table>

            <p style="color:#b8b8c0;font-size:14px;line-height:1.65;margin:0 0 8px 0;">I'll send reminders before we start and during the series. The live link will be in those.</p>
            <p style="color:#b8b8c0;font-size:14px;line-height:1.65;margin:0;">Reply to this email with any questions. It comes straight to me.</p>

            <div style="margin-top:32px;padding-top:22px;border-top:1px solid #373737;">
              <div style="font-family:${disp};font-size:18px;color:#ffffff;font-weight:600;">Shanee Moret</div>
              <div style="font-family:${mono};color:#7f8590;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-top:5px;font-weight:600;">Founder &middot; Growth Academy Global</div>
            </div>

          </td></tr>
          <tr><td style="padding:0 30px 16px 30px;" align="right">
            <div style="font-family:${mono};font-size:18px;line-height:1;color:#1fb6ff;">+</div>
          </td></tr>
        </table>

        <div style="font-family:${mono};color:#7f8590;font-size:11px;margin-top:20px;letter-spacing:0.06em;text-transform:uppercase;">&copy; 2026 Growth Academy Global &nbsp;|&nbsp; <a href="${SITE}" style="color:#7f8590;text-decoration:underline;">masterclass.growthacademy.global</a></div>

      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
