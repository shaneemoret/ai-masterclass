// GET /api/dashboard
// Live dashboard counts and campaign engagement for the Codex Masterclass.

const CAMPAIGNS = [
  {
    name: 'Email 1 - High Probability Segment',
    broadcastId: '0d42ac4c-1fdc-4316-a3bc-0879873fbd57',
    subject: 'Codex may be worth $50,000+ to your business',
    sentAt: '2026-05-07T14:48:31.543Z',
    audience: 1500,
    trackingIds: ['codex-masterclass-may-2026-email-1'],
  },
  {
    name: 'Email 1 A/B Test A - Money Outcome',
    broadcastId: '5cd54e27-2524-4167-83d2-e1668f473a92',
    subject: 'Codex may be worth $50,000+ to your business',
    sentAt: '2026-05-07T15:59:16.460Z',
    audience: 249,
  },
  {
    name: 'Email 1 A/B Test B - Paid Work Pain',
    broadcastId: '9bacf97a-9b0b-4602-a192-f8a9174e0cc2',
    subject: 'The AI work most business owners are still paying people for',
    sentAt: '2026-05-07T15:58:49.437Z',
    audience: 250,
  },
  {
    name: 'Email 1 A/B Test C - Execution Pain',
    broadcastId: 'ba40ada6-ae87-41ba-b8e4-f31ec539c64c',
    subject: 'Your AI agent should be doing the work by now',
    sentAt: '2026-05-07T17:31:00.000Z',
    audience: 250,
  },
  {
    name: 'Email 1 A/B Test D - Employee Replacement',
    broadcastId: '1d11d5a9-cb94-4ce8-a28d-394302debb6c',
    subject: 'The employee you need may already be in Codex',
    sentAt: '2026-05-07T17:31:00.000Z',
    audience: 250,
  },
  {
    name: 'Email 1 A/B Test E 500 - Paid Work Control',
    broadcastId: '24124bd9-b6fd-451f-b890-c263bf3be682',
    subject: 'The AI work most business owners are still paying people for',
    sentAt: '2026-05-07T17:43:46.000Z',
    audience: 500,
  },
  {
    name: 'Email 1 A/B Test F 500 - Next Hire Agent',
    broadcastId: 'ea0f9565-04ea-4c1f-8f59-75750f592aa5',
    subject: 'Your next hire might be an AI agent',
    sentAt: '2026-05-07T17:43:46.000Z',
    audience: 500,
  },
  {
    name: 'Email 1 Batch 3 1000 - Winner D',
    broadcastId: '46db9e56-d944-40fa-8c6c-3f45d0b41703',
    subject: 'The employee you need may already be in Codex',
    sentAt: '2026-05-07T18:46:02.000Z',
    audience: 1000,
  },
  {
    name: 'Email 1 Click Test G - System Proof CTA',
    broadcastId: '2fbe412c-09c5-4207-a0cf-b7f61f0c0d6c',
    subject: 'I replaced Kajabi with Codex + Cloudflare',
    sentAt: '2026-05-07T21:20:30.000Z',
    audience: 263,
    trackingIds: ['codex-masterclass-may-2026-clicktest-g-system-proof'],
  },
  {
    name: 'Email 1 Click Test H - Employee Pain CTA',
    broadcastId: '80f8851f-9754-4383-8072-1253c19aebe2',
    subject: 'The employee you need may already be an AI agent',
    sentAt: '2026-05-07T21:20:42.000Z',
    audience: 263,
    trackingIds: ['codex-masterclass-may-2026-clicktest-h-employee-pain'],
  },
];

const CAMPAIGN_METRICS_TTL_MS = 5 * 60 * 1000;
const UNIQUE_VISITOR_EXPR = `COALESCE(
  visitor_id,
  visitor_key,
  COALESCE(user_agent, '') || '|' || COALESCE(country, '') || '|' || COALESCE(referrer, '') || '|' || COALESCE(campaign_source, '') || '|' || COALESCE(campaign_id, '')
)`;
const UNIQUE_VISITOR_EXPR_P = `COALESCE(
  p.visitor_id,
  p.visitor_key,
  COALESCE(p.user_agent, '') || '|' || COALESCE(p.country, '') || '|' || COALESCE(p.referrer, '') || '|' || COALESCE(p.campaign_source, '') || '|' || COALESCE(p.campaign_id, '')
)`;
const RESEND_EMAIL_PAGE_LIMIT = 100;
const MAX_RESEND_EMAIL_PAGES = Math.min(
  50,
  Math.ceil(CAMPAIGNS.reduce((sum, campaign) => sum + Number(campaign.audience || 0), 0) / RESEND_EMAIL_PAGE_LIMIT) + 5
);
const RESEND_PAGE_DELAY_MS = 650;
let campaignMetricsCache = null;
let campaignMetricsPromise = null;
let campaignRecipientCache = null;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const includeCampaigns = url.searchParams.get('campaigns') === '1';
  const [
    registrationResult,
    registrationBreakdownResult,
    registrationRowsResult,
    blockedResult,
    visitResult,
    trackingStartResult,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT
         COUNT(*) AS registrations,
         MAX(registered_at) AS latest_registration_at
       FROM registrations`
    ).first(),
    env.DB.prepare(
      `SELECT
         COUNT(*) AS active_total,
         SUM(CASE
           WHEN email LIKE 'hello+confirm-test-%@growthacademy.global' OR email = 'hello@growthacademy.global'
           THEN 1 ELSE 0
         END) AS test_or_self,
         SUM(CASE
           WHEN NOT (email LIKE 'hello+confirm-test-%@growthacademy.global' OR email = 'hello@growthacademy.global')
           THEN 1 ELSE 0
         END) AS real_active
       FROM registrations`
    ).first(),
    env.DB.prepare(
      `SELECT
         r.name,
         LOWER(r.email) AS email,
         r.registered_at,
         r.campaign_id,
         r.campaign_source,
         COALESCE(r.landing_variant, 'unknown') AS landing_variant,
         CASE
           WHEN r.email LIKE 'hello+confirm-test-%@growthacademy.global' OR r.email = 'hello@growthacademy.global'
           THEN 1 ELSE 0
         END AS is_test_or_self,
         COALESCE(c.customer_lifetime_value, 0) AS customer_lifetime_value,
         COALESCE(c.value_tier, '') AS value_tier
       FROM registrations r
       LEFT JOIN customer_signals c ON LOWER(r.email) = c.email`
    ).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS blocked_total
       FROM blocked_emails`
    ).first(),
    env.DB.prepare(
      `SELECT
         COUNT(DISTINCT ${UNIQUE_VISITOR_EXPR}) AS landing_page_visits,
         COUNT(*) AS raw_landing_page_visits,
         MAX(visited_at) AS latest_visit_at
       FROM page_visits
       WHERE path IN ('/', '/index.html')`
    ).first(),
    env.DB.prepare(
      `SELECT MIN(visited_at) AS tracking_started_at
       FROM page_visits
       WHERE path IN ('/', '/index.html')`
    ).first(),
  ]);

  const registrationRows = registrationRowsResult?.results || [];
  const campaignMetricsResult = includeCampaigns
    ? await getCampaignMetricsBlocking(env, registrationRows)
    : getCachedCampaignMetrics(env, registrationRows);
  const attributedRegistrationRows = attributeRegistrationRows(registrationRows, campaignRecipientCache);

  const trackingStartedAt = trackingStartResult?.tracking_started_at || null;
  const [
    registrationsSinceTrackingResult,
    landingVariantRows,
    landingVariantRegistrationRows,
    trafficSourceRows,
  ] = await Promise.all([
    trackingStartedAt
      ? env.DB.prepare(
        `SELECT COUNT(*) AS registrations_since_tracking
         FROM registrations
         WHERE registered_at >= ?1`
      ).bind(trackingStartedAt).first()
      : Promise.resolve({ registrations_since_tracking: 0 }),
    env.DB.prepare(
      `SELECT COALESCE(landing_variant, 'unknown') AS variant, COUNT(DISTINCT ${UNIQUE_VISITOR_EXPR}) AS visits
       FROM page_visits
       WHERE path IN ('/', '/index.html')
       GROUP BY COALESCE(landing_variant, 'unknown')`
    ).all(),
    trackingStartedAt
      ? env.DB.prepare(
        `SELECT COALESCE(landing_variant, 'unknown') AS variant, COUNT(*) AS registrations
         FROM registrations
         WHERE registered_at >= ?1
         GROUP BY COALESCE(landing_variant, 'unknown')`
      ).bind(trackingStartedAt).all()
      : Promise.resolve({ results: [] }),
    trackingStartedAt
      ? env.DB.prepare(
        `SELECT
           COALESCE(NULLIF(p.campaign_source, ''), 'direct') AS source,
           COUNT(DISTINCT ${UNIQUE_VISITOR_EXPR_P}) AS visits,
           (SELECT COUNT(*) FROM registrations r
              WHERE COALESCE(NULLIF(r.campaign_source, ''), 'direct') = COALESCE(NULLIF(p.campaign_source, ''), 'direct')
                AND r.registered_at >= ?1) AS registrations
         FROM page_visits p
         WHERE p.visited_at >= ?1
         GROUP BY source
         ORDER BY visits DESC
         LIMIT 12`
      ).bind(trackingStartedAt).all()
      : Promise.resolve({ results: [] }),
  ]);

  const landingVariants = mergeLandingVariants(
    landingVariantRows?.results || [],
    landingVariantRegistrationRows?.results || []
  );

  // --- Trend, timeline, and goal-progress derivations ---
  // These power the registration timeline chart, goal-progress bar, and
  // conversion-trend cards on the live event dashboard. All derived from rows
  // already loaded above; one extra small query for per-day visit volume.
  const REG_GOAL = 1000;
  const EVENT_START_ISO = '2026-05-12T16:15:00.000Z'; // 12:15pm ET == 16:15 UTC
  const nowMs = Date.now();
  const dailyVisitWindowStart = new Date(nowMs - 4 * 24 * 60 * 60 * 1000).toISOString();
  const dailyVisitsResult = await env.DB.prepare(
    `SELECT visited_at, ${UNIQUE_VISITOR_EXPR} AS visitor_key FROM page_visits
     WHERE path IN ('/', '/index.html')
       AND visited_at >= ?1`
  ).bind(dailyVisitWindowStart).all();
  const hourlyRegistrations = buildHourlyRegistrations(registrationRows, nowMs, 48);
  const goalProgress = buildGoalProgress(Number(registrationResult?.registrations || 0), REG_GOAL, EVENT_START_ISO, nowMs);
  const conversionTrend = buildConversionTrend(registrationRows, dailyVisitsResult?.results || [], nowMs);
  const trafficSources = buildTrafficSources(trafficSourceRows?.results || []);
  const broadcastRegistrations = buildBroadcastRegistrations(attributedRegistrationRows);
  const anomalies = buildAnomalies({
    registrationRows,
    conversionTrend,
    nowMs,
  });

  return json({
    ok: true,
    registrations: Number(registrationResult?.registrations || 0),
    registrationBreakdown: {
      activeTotal: Number(registrationBreakdownResult?.active_total || 0),
      realActive: Number(registrationBreakdownResult?.real_active || 0),
      testOrSelf: Number(registrationBreakdownResult?.test_or_self || 0),
      blocked: Number(blockedResult?.blocked_total || 0),
    },
    registrationsSinceTracking: Number(registrationsSinceTrackingResult?.registrations_since_tracking || 0),
    landingPageVisits: Number(visitResult?.landing_page_visits || 0),
    rawLandingPageVisits: Number(visitResult?.raw_landing_page_visits || 0),
    trackingStartedAt,
    landingVariants,
    latestRegistrationAt: registrationResult?.latest_registration_at || null,
    registrationAttributionSummary: summarizeRegistrationAttributions(attributedRegistrationRows),
    unattributedRegistrations: attributedRegistrationRows
      .filter((row) => !row.isTestOrSelf && row.attributionMethod === 'unknown')
      .sort((a, b) => Date.parse(b.registeredAt || '') - Date.parse(a.registeredAt || ''))
      .slice(0, 30)
      .map((row) => ({
        name: row.name || '',
        email: row.email || '',
        registeredAt: row.registeredAt || null,
        landingVariant: row.landingVariant || 'unknown',
        customerLifetimeValue: Number(row.customerLifetimeValue || 0),
        attributionLabel: row.attributionLabel || 'Unknown/direct',
        attributionConfidence: row.attributionConfidence || 'needs_review',
      })),
    recentRegistrations: attributedRegistrationRows
      .sort((a, b) => Date.parse(b.registeredAt || '') - Date.parse(a.registeredAt || ''))
      .slice(0, 12)
      .map((row) => ({
      name: row.name || '',
      email: row.email || '',
      registeredAt: row.registeredAt || null,
      landingVariant: row.landingVariant || 'unknown',
      campaignId: row.campaignId || '',
      campaignSource: row.campaignSource || '',
      attributedCampaignId: row.attributedCampaignId || '',
      attributedCampaignName: row.attributedCampaignName || '',
      attributedCampaignSubject: row.attributedCampaignSubject || '',
      attributionMethod: row.attributionMethod || 'unknown',
      attributionLabel: row.attributionLabel || 'Unknown/direct',
      attributionConfidence: row.attributionConfidence || '',
      customerLifetimeValue: Number(row.customerLifetimeValue || 0),
      isTestOrSelf: Boolean(row.isTestOrSelf),
    })),
    latestVisitAt: visitResult?.latest_visit_at || null,
    campaignMetrics: campaignMetricsResult.metrics,
    campaignMetricsSource: campaignMetricsResult.source,
    campaignMetricsUpdatedAt: campaignMetricsResult.updatedAt,
    campaignMetricsError: campaignMetricsResult.error || null,
    hourlyRegistrations,
    goalProgress,
    conversionTrend,
    trafficSources,
    broadcastRegistrations,
    anomalies,
    lastUpdated: new Date().toISOString(),
  });
}

function mergeLandingVariants(visitRows, registrationRows) {
  const byVariant = new Map();
  for (const row of visitRows) {
    const variant = row.variant || 'unknown';
    byVariant.set(variant, {
      variant,
      visits: Number(row.visits || 0),
      registrations: 0,
      conversionRate: 0,
    });
  }
  for (const row of registrationRows) {
    const variant = row.variant || 'unknown';
    const current = byVariant.get(variant) || {
      variant,
      visits: 0,
      registrations: 0,
      conversionRate: 0,
    };
    current.registrations = Number(row.registrations || 0);
    byVariant.set(variant, current);
  }
  return [...byVariant.values()]
    .map((row) => {
      // Sanity guard: more registrations than visits means stale localStorage
      // variant attribution from a previous build is leaking into newer
      // registrations. Don't display a conversion rate the team will read as
      // real — flag the row and let the UI render a "needs review" badge.
      const attributionWarning = Number(row.registrations || 0) > Number(row.visits || 0);
      return {
        ...row,
        conversionRate: attributionWarning ? null : (row.visits ? row.registrations / row.visits : 0),
        attributionWarning,
      };
    })
    .sort((a, b) => (b.visits || 0) - (a.visits || 0));
}

function getCachedCampaignMetrics(env, registrationRows) {
  if (!env.RESEND_API_KEY) {
    return {
      metrics: {},
      source: 'unavailable',
      updatedAt: null,
      error: 'missing_resend_api_key',
    };
  }

  const now = Date.now();
  if (campaignMetricsCache && now - campaignMetricsCache.fetchedAt < CAMPAIGN_METRICS_TTL_MS) {
    return {
      metrics: addRegistrationCounts(campaignMetricsCache.metrics, campaignRecipientCache, registrationRows),
      source: 'resend_emails_last_event_cached',
      updatedAt: campaignMetricsCache.updatedAt,
    };
  }

  if (campaignMetricsCache) {
    return {
      metrics: addRegistrationCounts(campaignMetricsCache.metrics, campaignRecipientCache, registrationRows),
      source: 'resend_emails_last_event_stale',
      updatedAt: campaignMetricsCache.updatedAt,
    };
  }

  return {
    metrics: {},
    source: 'resend_emails_last_event_refreshing',
    updatedAt: null,
  };
}

async function getCampaignMetricsBlocking(env, registrationRows) {
  if (!env.RESEND_API_KEY) {
    return {
      metrics: addRegistrationCounts({}, campaignRecipientCache, registrationRows),
      source: 'unavailable',
      updatedAt: null,
      error: 'missing_resend_api_key',
    };
  }

  const now = Date.now();
  if (campaignMetricsCache && now - campaignMetricsCache.fetchedAt < CAMPAIGN_METRICS_TTL_MS) {
    return {
      metrics: addRegistrationCounts(campaignMetricsCache.metrics, campaignRecipientCache, registrationRows),
      source: 'resend_emails_last_event_cached',
      updatedAt: campaignMetricsCache.updatedAt,
    };
  }

  try {
    const cache = await queueCampaignMetricsRefresh(env);
    return {
      metrics: addRegistrationCounts(cache.metrics, campaignRecipientCache, registrationRows),
      source: 'resend_emails_last_event',
      updatedAt: cache.updatedAt,
    };
  } catch (error) {
    console.error('campaign_metrics_error', error?.message || String(error));
    return {
      metrics: addRegistrationCounts(campaignMetricsCache?.metrics || {}, campaignRecipientCache, registrationRows),
      source: campaignMetricsCache ? 'resend_emails_last_event_stale' : 'unavailable',
      updatedAt: campaignMetricsCache?.updatedAt || null,
      error: 'campaign_metrics_unavailable',
    };
  }
}

function queueCampaignMetricsRefresh(env) {
  if (!campaignMetricsPromise) {
    const fetchedAt = Date.now();
    campaignMetricsPromise = fetchCampaignMetricsFromResend(env)
      .then((result) => {
        campaignRecipientCache = result.recipientsByCampaign;
        campaignMetricsCache = {
          metrics: result.metrics,
          fetchedAt,
          updatedAt: new Date(fetchedAt).toISOString(),
        };
        return campaignMetricsCache;
      })
      .catch((error) => {
        console.error('campaign_metrics_error', error?.message || String(error));
        throw error;
      })
      .finally(() => {
        campaignMetricsPromise = null;
      });
  }

  return campaignMetricsPromise;
}

async function fetchCampaignMetricsFromResend(env) {
  const accumulator = Object.fromEntries(CAMPAIGNS.map((campaign) => [
    campaign.broadcastId,
    {
      observed: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      failed: 0,
      lastEventAt: null,
    },
  ]));
  const recipientsByCampaign = Object.fromEntries(CAMPAIGNS.map((campaign) => [
    campaign.broadcastId,
    new Set(),
  ]));

  const earliestCampaignTime = Math.min(...CAMPAIGNS.map((campaign) => Date.parse(campaign.sentAt)));
  const stopBefore = earliestCampaignTime - 30 * 60 * 1000;
  let after = null;

  for (let page = 0; page < MAX_RESEND_EMAIL_PAGES; page += 1) {
    if (page > 0) await sleep(RESEND_PAGE_DELAY_MS);
    const params = new URLSearchParams({ limit: String(RESEND_EMAIL_PAGE_LIMIT) });
    if (after) params.set('after', after);

    const payload = await resend(env, `/emails?${params.toString()}`);
    const emails = Array.isArray(payload.data) ? payload.data : [];
    if (!emails.length) break;

    for (const email of emails) {
      const createdAt = Date.parse(email.created_at || '');
      if (!Number.isFinite(createdAt)) continue;
      if (createdAt < stopBefore) continue;

      const campaign = matchCampaign(email, createdAt);
      if (!campaign) continue;

      const row = accumulator[campaign.broadcastId];
      const recipients = normalizeRecipients(email.to);
      const lastEvent = String(email.last_event || '').toLowerCase();
      row.observed += 1;
      row.lastEventAt = newerIso(row.lastEventAt, email.created_at);
      for (const recipient of recipients) {
        recipientsByCampaign[campaign.broadcastId].add(recipient);
      }

      if (['delivered', 'opened', 'clicked'].includes(lastEvent)) row.delivered += 1;
      if (['opened', 'clicked'].includes(lastEvent)) row.opened += 1;
      if (lastEvent === 'clicked') row.clicked += 1;
      if (lastEvent === 'bounced') row.bounced += 1;
      if (lastEvent === 'complained') row.complained += 1;
      if (lastEvent === 'failed') row.failed += 1;
    }

    const oldest = emails
      .map((email) => Date.parse(email.created_at || ''))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];

    if (!payload.has_more || !Number.isFinite(oldest) || oldest < stopBefore) break;
    after = emails[emails.length - 1].id;
  }

  const metrics = Object.fromEntries(CAMPAIGNS.map((campaign) => {
    const row = accumulator[campaign.broadcastId];
    const denominator = campaign.audience || row.observed || 1;
    return [
      campaign.broadcastId,
      {
        ...row,
        audience: campaign.audience,
        openRate: row.opened / denominator,
        clickRate: row.clicked / denominator,
      },
    ];
  }));

  return { metrics, recipientsByCampaign };
}

function addRegistrationCounts(metrics, recipientsByCampaign, registrationRows) {
  const rows = attributeRegistrationRows(registrationRows, recipientsByCampaign);
  const next = { ...metrics };

  for (const campaign of CAMPAIGNS) {
    const campaignRows = rows.filter((row) => row.attributedCampaignId === campaign.broadcastId);
    const registeredEmails = new Set();
    const trackedRegistrationEmails = new Set();
    const recipientMatchedRegistrationEmails = new Set();
    const qualityRegistrationEmails = new Set();

    for (const row of campaignRows) {
      const email = String(row.email || '').trim().toLowerCase();
      if (!email) continue;
      if (row.attributionMethod === 'tracked_link') {
        trackedRegistrationEmails.add(email);
      }
      if (row.attributionMethod === 'recipient_match') {
        recipientMatchedRegistrationEmails.add(email);
      }
      registeredEmails.add(email);
      if (Number(row.customerLifetimeValue || 0) > 25) {
        qualityRegistrationEmails.add(email);
      }
    }

    const base = next[campaign.broadcastId] || {};
    const registered = registeredEmails.size;
    const attributionMethods = new Set(campaignRows.map((row) => row.attributionMethod));
    next[campaign.broadcastId] = {
      ...base,
      audience: campaign.audience || base.audience || 0,
      registered,
      registeredTracked: trackedRegistrationEmails.size,
      registeredRecipientMatched: recipientMatchedRegistrationEmails.size,
      registeredQualityProspects: qualityRegistrationEmails.size,
      qualityProspectRate: campaign.audience ? qualityRegistrationEmails.size / campaign.audience : 0,
      registrationRate: campaign.audience ? registered / campaign.audience : 0,
      registrationAttribution:
        attributionMethods.has('tracked_link')
          ? (attributionMethods.has('recipient_match') ? 'tracked_and_recipient_match' : 'tracked_link')
          : (attributionMethods.has('recipient_match') ? 'recipient_match_only' : (recipientsByCampaign?.[campaign.broadcastId] ? 'recipient_match_available' : 'link_attribution_only')),
    };
  }

  return next;
}

function attributeRegistrationRows(registrationRows, recipientsByCampaign) {
  const rows = Array.isArray(registrationRows) ? registrationRows : [];
  return rows.map((row) => {
    const email = String(row.email || '').trim().toLowerCase();
    const registeredAt = row.registered_at || row.registeredAt || null;
    const campaignId = normalizeCampaignId(row.campaign_id || row.campaignId);
    const testOrSelf = Boolean(row.is_test_or_self || row.isTestOrSelf || isTestOrSelfEmail(email));
    const customerLifetimeValue = Number(row.customer_lifetime_value || row.customerLifetimeValue || 0);
    const base = {
      name: row.name || '',
      email,
      registeredAt,
      landingVariant: row.landing_variant || row.landingVariant || 'unknown',
      campaignId: campaignId || '',
      campaignSource: row.campaign_source || row.campaignSource || '',
      isTestOrSelf: testOrSelf,
      customerLifetimeValue,
      valueTier: row.value_tier || row.valueTier || '',
      attributedCampaignId: '',
      attributedCampaignName: '',
      attributedCampaignSubject: '',
      attributionMethod: testOrSelf ? 'test_self' : 'unknown',
      attributionLabel: testOrSelf ? 'Test/self' : 'Unknown/direct',
      attributionConfidence: testOrSelf ? 'excluded' : 'needs_review',
    };

    if (testOrSelf) return base;

    const trackedCampaign = campaignId
      ? CAMPAIGNS.find((campaign) => campaignTrackingIds(campaign).has(campaignId))
      : null;
    if (trackedCampaign) {
      return {
        ...base,
        attributedCampaignId: trackedCampaign.broadcastId,
        attributedCampaignName: trackedCampaign.name || campaignShortName(trackedCampaign),
        attributedCampaignSubject: trackedCampaign.subject,
        attributionMethod: 'tracked_link',
        attributionLabel: 'Tracked campaign link',
        attributionConfidence: 'confirmed',
      };
    }

    const recipientCampaign = findRecipientMatchedCampaign(email, registeredAt, recipientsByCampaign);
    if (recipientCampaign) {
      return {
        ...base,
        attributedCampaignId: recipientCampaign.broadcastId,
        attributedCampaignName: recipientCampaign.name || campaignShortName(recipientCampaign),
        attributedCampaignSubject: recipientCampaign.subject,
        attributionMethod: 'recipient_match',
        attributionLabel: 'Recipient match after send',
        attributionConfidence: 'probable',
      };
    }

    return base;
  });
}

function findRecipientMatchedCampaign(email, registeredAt, recipientsByCampaign) {
  const registeredTime = Date.parse(registeredAt || '');
  if (!email || !Number.isFinite(registeredTime) || !recipientsByCampaign) return null;

  return CAMPAIGNS
    .filter((campaign) => {
      const sentAt = Date.parse(campaign.sentAt);
      const recipients = recipientsByCampaign[campaign.broadcastId];
      return recipients && recipients.has(email) && Number.isFinite(sentAt) && registeredTime >= sentAt;
    })
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))[0] || null;
}

function summarizeRegistrationAttributions(rows) {
  const summary = {
    total: rows.length,
    campaignLinked: 0,
    tracked: 0,
    recipientMatched: 0,
    unknown: 0,
    testSelf: 0,
    qualityProspects: 0,
  };

  for (const row of rows) {
    if (row.isTestOrSelf) {
      summary.testSelf += 1;
      continue;
    }
    if (row.customerLifetimeValue > 25) summary.qualityProspects += 1;
    if (row.attributedCampaignId) summary.campaignLinked += 1;
    if (row.attributionMethod === 'tracked_link') summary.tracked += 1;
    if (row.attributionMethod === 'recipient_match') summary.recipientMatched += 1;
    if (row.attributionMethod === 'unknown') summary.unknown += 1;
  }

  return summary;
}

function isTestOrSelfEmail(email) {
  return email === 'hello@growthacademy.global' || email.startsWith('hello+confirm-test-');
}

function campaignShortName(campaign) {
  return `Email ${CAMPAIGNS.findIndex((row) => row.broadcastId === campaign.broadcastId) + 1}`;
}

function campaignTrackingIds(campaign) {
  return new Set([
    campaign.broadcastId,
    ...(campaign.trackingIds || []),
  ].map(normalizeCampaignId).filter(Boolean));
}

function normalizeCampaignId(value) {
  const id = String(value || '').trim().toLowerCase().slice(0, 120);
  if (!id) return '';
  return id.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) return value.map(normalizeRecipient).filter(Boolean);
  const recipient = normalizeRecipient(value);
  return recipient ? [recipient] : [];
}

function normalizeRecipient(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchCampaign(email, createdAt) {
  const candidates = CAMPAIGNS.filter((campaign) => campaign.subject === email.subject);
  if (!candidates.length) return null;

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const campaign of candidates) {
    const distance = Math.abs(createdAt - Date.parse(campaign.sentAt));
    if (distance < bestDistance) {
      best = campaign;
      bestDistance = distance;
    }
  }

  return bestDistance <= 12 * 60 * 60 * 1000 ? best : null;
}

function newerIso(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

async function resend(env, path) {
  const response = await fetch(`https://api.resend.com${path}`, {
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Resend ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return data;
}

function buildHourlyRegistrations(registrationRows, nowMs, hours) {
  const buckets = new Map();
  const startMs = nowMs - hours * 60 * 60 * 1000;
  for (let i = 0; i < hours; i += 1) {
    const bucketMs = startMs + i * 60 * 60 * 1000;
    const bucketHourMs = Math.floor(bucketMs / (60 * 60 * 1000)) * 60 * 60 * 1000;
    buckets.set(bucketHourMs, 0);
  }
  for (const row of registrationRows || []) {
    const t = Date.parse(row.registered_at || row.registeredAt || '');
    if (!Number.isFinite(t) || t < startMs || t > nowMs) continue;
    const bucketHourMs = Math.floor(t / (60 * 60 * 1000)) * 60 * 60 * 1000;
    buckets.set(bucketHourMs, (buckets.get(bucketHourMs) || 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, count]) => ({ hour: new Date(ms).toISOString(), count }));
}

function buildGoalProgress(currentRegistrations, goal, eventStartIso, nowMs) {
  const eventStartMs = Date.parse(eventStartIso);
  const remainingMs = Math.max(0, eventStartMs - nowMs);
  const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const gap = Math.max(0, goal - currentRegistrations);
  const neededPerDay = gap > 0 ? Math.ceil(gap / daysRemaining) : 0;
  const percent = goal > 0 ? Math.min(100, (currentRegistrations / goal) * 100) : 0;
  return {
    goal,
    current: currentRegistrations,
    gap,
    percent,
    daysRemaining,
    neededPerDay,
    eventStart: eventStartIso,
  };
}

function buildConversionTrend(registrationRows, visitRows, nowMs) {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = nowMs - dayMs;
  const yesterdayStart = nowMs - 2 * dayMs;
  const threeDayStart = nowMs - 3 * dayMs;

  const countInWindow = (rows, key, from, to) => {
    let n = 0;
    for (const row of rows || []) {
      const t = Date.parse(row[key] || '');
      if (Number.isFinite(t) && t >= from && t < to) n += 1;
    }
    return n;
  };
  const countUniqueVisitorsInWindow = (rows, from, to) => {
    const seen = new Set();
    for (const row of rows || []) {
      const t = Date.parse(row.visited_at || '');
      if (!Number.isFinite(t) || t < from || t >= to) continue;
      seen.add(row.visitor_key || `visit:${row.visited_at}`);
    }
    return seen.size;
  };

  const regsToday = countInWindow(registrationRows, 'registered_at', todayStart, nowMs);
  const regsYesterday = countInWindow(registrationRows, 'registered_at', yesterdayStart, todayStart);
  const regsRolling3 = countInWindow(registrationRows, 'registered_at', threeDayStart, nowMs);

  const visitsToday = countUniqueVisitorsInWindow(visitRows, todayStart, nowMs);
  const visitsYesterday = countUniqueVisitorsInWindow(visitRows, yesterdayStart, todayStart);
  const visitsRolling3 = countUniqueVisitorsInWindow(visitRows, threeDayStart, nowMs);

  const rate = (regs, visits) => (visits > 0 ? regs / visits : null);

  const today = rate(regsToday, visitsToday);
  const yesterday = rate(regsYesterday, visitsYesterday);
  const rolling3 = rate(regsRolling3, visitsRolling3);

  const deltaVsYesterday = (today != null && yesterday != null) ? today - yesterday : null;
  const deltaVsRolling3 = (today != null && rolling3 != null) ? today - rolling3 : null;

  return {
    today: { registrations: regsToday, visits: visitsToday, conversionRate: today },
    yesterday: { registrations: regsYesterday, visits: visitsYesterday, conversionRate: yesterday },
    rolling3Day: { registrations: regsRolling3, visits: visitsRolling3, conversionRate: rolling3 },
    deltaVsYesterday,
    deltaVsRolling3,
  };
}

function buildTrafficSources(rows) {
  return (rows || []).map((row) => {
    const source = String(row.source || 'direct');
    const visits = Number(row.visits || 0);
    const registrations = Number(row.registrations || 0);
    const attributionWarning = registrations > visits;
    return {
      source,
      visits,
      registrations,
      conversionRate: attributionWarning ? null : (visits > 0 ? registrations / visits : 0),
      attributionWarning,
    };
  });
}

function buildBroadcastRegistrations(attributedRows) {
  const byCampaign = new Map();
  for (const row of attributedRows || []) {
    const id = row.attributedCampaignId;
    if (!id) continue;
    if (row.isTestOrSelf) continue;
    if (!byCampaign.has(id)) byCampaign.set(id, new Set());
    const email = String(row.email || '').trim().toLowerCase();
    if (email) byCampaign.get(id).add(email);
  }
  return CAMPAIGNS.map((campaign) => {
    const set = byCampaign.get(campaign.broadcastId);
    const registrations = set ? set.size : 0;
    const audienceSize = Number(campaign.audience || 0);
    return {
      broadcastId: campaign.broadcastId,
      name: campaign.name,
      subject: campaign.subject,
      sentAt: campaign.sentAt,
      audienceSize,
      registrations,
      registrationRate: audienceSize > 0 ? registrations / audienceSize : 0,
    };
  });
}

function buildAnomalies({ registrationRows, conversionTrend, nowMs }) {
  const anomalies = [];
  const hourMs = 60 * 60 * 1000;

  // Determine ET hour (handle EST/EDT roughly via May = EDT, UTC-4)
  const etOffsetHours = isUsEasternDaylight(nowMs) ? -4 : -5;
  const etHour = new Date(nowMs + etOffsetHours * hourMs).getUTCHours();
  const lowExpectedBaseline = etHour >= 0 && etHour < 7;

  // slow_registrations: last hour < 30% of rolling 6-hour avg
  if (!lowExpectedBaseline) {
    const lastHourCount = countRegistrationsBetween(registrationRows, nowMs - hourMs, nowMs);
    const last6hCount = countRegistrationsBetween(registrationRows, nowMs - 6 * hourMs, nowMs);
    const avgPerHour = last6hCount / 6;
    if (avgPerHour >= 3 && lastHourCount < 0.3 * avgPerHour) {
      anomalies.push({
        kind: 'slow_registrations',
        severity: 'warning',
        message: `Registrations slowed in the last hour (${lastHourCount} vs avg ${avgPerHour.toFixed(1)}/hr over the last 6 hours).`,
        evidence: {
          lastHourCount,
          avgPerHour: Number(avgPerHour.toFixed(2)),
          windowHours: 6,
        },
      });
    }
  }

  // conversion_drop: today's tracked rate < 50% of yesterday's
  if (conversionTrend && typeof conversionTrend.today?.conversionRate === 'number'
      && typeof conversionTrend.yesterday?.conversionRate === 'number'
      && conversionTrend.yesterday.conversionRate > 0
      && conversionTrend.today.visits >= 25) {
    const todayRate = conversionTrend.today.conversionRate;
    const yestRate = conversionTrend.yesterday.conversionRate;
    if (todayRate < 0.5 * yestRate) {
      anomalies.push({
        kind: 'conversion_drop',
        severity: 'warning',
        message: `Today's visit-to-registration rate (${(todayRate * 100).toFixed(1)}%) is below half of yesterday's (${(yestRate * 100).toFixed(1)}%).`,
        evidence: {
          todayRate: Number(todayRate.toFixed(4)),
          yesterdayRate: Number(yestRate.toFixed(4)),
          todayVisits: conversionTrend.today.visits,
          yesterdayVisits: conversionTrend.yesterday.visits,
        },
      });
    }
  }

  return anomalies;
}

function countRegistrationsBetween(rows, fromMs, toMs) {
  let count = 0;
  for (const row of rows || []) {
    const t = Date.parse(row.registered_at || row.registeredAt || '');
    if (Number.isFinite(t) && t >= fromMs && t < toMs) count += 1;
  }
  return count;
}

function isUsEasternDaylight(ms) {
  // US DST: second Sunday of March through first Sunday of November.
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const dstStart = nthSundayOfMonth(year, 2, 2); // March (month 2), 2nd Sunday
  const dstEnd = nthSundayOfMonth(year, 10, 1); // November (month 10), 1st Sunday
  return ms >= dstStart && ms < dstEnd;
}

function nthSundayOfMonth(year, monthIndex, n) {
  // n=1 means first Sunday, n=2 second, etc. Returns ms at 07:00 UTC (~02:00 ET) on that day.
  const first = new Date(Date.UTC(year, monthIndex, 1, 7, 0, 0));
  const dow = first.getUTCDay();
  const offset = (7 - dow) % 7 + (n - 1) * 7;
  return Date.UTC(year, monthIndex, 1 + offset, 7, 0, 0);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json',
    },
  });
}
