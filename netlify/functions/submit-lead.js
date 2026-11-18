// Unshakeable Financial Partners — GoHighLevel Lead Integration
// Receives form submissions from the website and creates contacts in GoHighLevel CRM

// The CRM key lives in Netlify (Site configuration > Environment variables > GHL_API_KEY),
// never in this public file. If it is missing, leads are still saved by Netlify Forms
// (see js/lead-backup.js), just not pushed into the CRM.
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'gRqC0BILHXJDWDulti0D';
const GHL_API_URL = 'https://services.leadconnectorhq.com';

// Instant lead email. Set these in Netlify (Environment variables), never in this public file:
//   RESEND_API_KEY   - API key from resend.com (free plan is enough)
//   LEAD_NOTIFY_EMAIL - where new leads are emailed (comma-separate for several)
//   LEAD_FROM_EMAIL  - optional; defaults to Resend's test sender, which can only email the
//                      address that owns the Resend account. Use a verified-domain address
//                      (e.g. leads@yourdomain.com) to send anywhere.
// This runs before the CRM step, so a lead reaches your inbox even if the CRM or Netlify's
// spam filter drops it. A failure here never blocks the lead from being saved elsewhere.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const LEAD_NOTIFY_EMAIL = process.env.LEAD_NOTIFY_EMAIL || '';
const LEAD_FROM_EMAIL = process.env.LEAD_FROM_EMAIL || 'Website Leads <onboarding@resend.dev>';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function emailLead(formName, data) {
  if (!RESEND_API_KEY || !LEAD_NOTIFY_EMAIL) return 'not_configured';
  const first = data['first-name'] || data['firstName'] || data['name'] || '';
  const last = data['last-name'] || data['lastName'] || '';
  const who = `${first} ${last}`.trim() || data['email'] || data['phone'] || 'new visitor';
  const rows = Object.entries(data)
    .filter(([k, v]) => v && k !== 'form-name' && k !== 'bot-field')
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555"><b>${esc(k)}</b></td><td style="padding:4px 0">${esc(v)}</td></tr>`)
    .join('');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: LEAD_FROM_EMAIL,
        to: LEAD_NOTIFY_EMAIL.split(',').map((s) => s.trim()).filter(Boolean),
        reply_to: data['email'] || undefined,
        subject: `New lead (${formName}): ${who}`,
        html: `<h3>New website lead: ${esc(formName)}</h3><table>${rows}</table>` +
              `<p style="color:#888;font-size:12px">Sent instantly by the website. Call or text promptly.</p>`,
      }),
    });
    if (!res.ok) {
      console.error('Lead email failed:', res.status);
      return `error ${res.status}`;
    }
    return 'sent';
  } catch (e) {
    console.error('Lead email error:', e.name === 'AbortError' ? 'timeout' : e.message);
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse form data
  let data = {};
  try {
    const contentType = event.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      data = JSON.parse(event.body);
    } else {
      const params = new URLSearchParams(event.body);
      data = Object.fromEntries(params.entries());
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid form data' }) };
  }

  const formName = data['form-name'] || 'website-form';

  // Email the lead right away (never throws; see emailLead above)
  const emailStatus = await emailLead(formName, data);

  // ── Map form fields to GoHighLevel contact ──────────────────────────────
  const contact = {
    locationId: GHL_LOCATION_ID,
    firstName: data['first-name'] || data['firstName'] || '',
    lastName:  data['last-name']  || data['lastName']  || '',
    email:     data['email'] || '',
    phone:     data['phone'] || '',
    source:    'Website',
    tags:      [formName, 'website-lead'],
    customFields: [],
  };

  // Add form-specific fields as notes + custom fields
  const notes = [];

  // Policy Audit form fields
  if (data['carrier'])    notes.push(`Carrier: ${data['carrier']}`);
  if (data['years-held']) notes.push(`Years held: ${data['years-held']}`);
  if (data['concern'])    notes.push(`Concern: ${data['concern']}`);

  // Quiz / tax assessment fields
  if (data['tax-risk-score'])  notes.push(`Tax Risk Score: ${data['tax-risk-score']}`);
  if (data['primary-concern']) notes.push(`Primary Concern: ${data['primary-concern']}`);
  if (data['score'])           notes.push(`Assessment Score: ${data['score']}`);
  if (data['grade'])           notes.push(`Grade: ${data['grade']}`);

  // Contact form + annuity / rate review fields
  if (data['state'])       notes.push(`State: ${data['state']}`);
  if (data['interest'])    notes.push(`Interested in: ${data['interest']}`);
  if (data['coming-due'])  notes.push(`Coming due: ${data['coming-due']}`);
  if (data['timing'])      notes.push(`When: ${data['timing']}`);
  if (data['amount'])      notes.push(`Approx. amount: ${data['amount']}`);
  if (data['message'])     notes.push(`Message: ${data['message']}`);
  if (data['consent'])     notes.push(`Call/text consent: ${data['consent']}`);

  // "What matters most" priority widget selections
  if (data['priorities'])      notes.push(`Top Priorities: ${data['priorities']}`);

  // Source page tag
  const sourceTagMap = {
    'policy-audit-request':      'policy-audit',
    'wealthy-family-guide':      'guide-download',
    'retirement-readiness-quiz': 'tax-quiz',
    'tax-assessment':            'tax-assessment',
    'agent-interest':            'agent-inquiry',
    'rate-review':               'rate-review',
    'contact-form':              'contact-form',
  };
  if (sourceTagMap[formName]) {
    contact.tags.push(sourceTagMap[formName]);
  }

  const headers = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  };
  // Reply tells the page (and anyone testing) whether the CRM really saved the lead.
  // It never includes the key or the lead's details.
  const reply = (crm, detail) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(detail ? { success: true, crm, email: emailStatus, detail } : { success: true, crm, email: emailStatus }),
  });
  const short = (o) => String((o && (o.message || o.error)) || '').slice(0, 160);

  if (!GHL_API_KEY) {
    console.warn(`GHL_API_KEY not set; lead kept in Netlify Forms only | Form: ${formName}`);
    return reply('not_configured');
  }

  try {
    // 1. Create the contact (or find the existing one if this email/phone is already in the CRM)
    const ghlRes = await fetch(`${GHL_API_URL}/contacts/`, { method: 'POST', headers, body: JSON.stringify(contact) });
    const ghlData = await ghlRes.json().catch(() => ({}));
    let contactId = ghlData.contact && ghlData.contact.id;
    let crm = 'saved';
    if (!ghlRes.ok) {
      contactId = ghlData.meta && ghlData.meta.contactId; // duplicate contact: GHL returns the existing id
      if (!contactId) {
        console.error('GHL contact error:', ghlRes.status, JSON.stringify(ghlData));
        return reply('error', `contact ${ghlRes.status}: ${short(ghlData)}`);
      }
      crm = 'existing_contact_updated';
      // Add this form's tags to the existing contact
      await fetch(`${GHL_API_URL}/contacts/${contactId}/tags`, { method: 'POST', headers, body: JSON.stringify({ tags: contact.tags }) })
        .catch(e => console.warn('Tagging skipped:', e.message));
    }
    console.log(`Contact ${crm}: ${contactId} | Form: ${formName}`);

    // 2. Add the form answers as a note on the contact
    let noteOk = true;
    if (notes.length > 0) {
      const nRes = await fetch(`${GHL_API_URL}/contacts/${contactId}/notes`, {
        method: 'POST', headers, body: JSON.stringify({ body: `Website form: ${formName}\n` + notes.join('\n') }),
      }).catch(() => null);
      noteOk = !!(nRes && nRes.ok);
      if (!noteOk) console.warn('Note not added:', nRes && nRes.status);
    }

    // 3. Add to the right pipeline, matched by its name in Voice CRM, at its first stage:
    //    annuity rate reviews -> "Annuities", agent applications -> "Recruitment",
    //    everything else -> "IUL / FlexMethod". (GHL_PIPELINE_ID + GHL_PIPELINE_STAGE_ID in
    //    Netlify override this, if ever set.)
    let pipeline = 'not_set';
    try {
      let pipelineId = process.env.GHL_PIPELINE_ID, stageId = process.env.GHL_PIPELINE_STAGE_ID, pName = 'env';
      if (!pipelineId || !stageId) {
        const want = formName === 'rate-review' ? 'annuit' : formName === 'agent-interest' ? 'recruit' : 'iul';
        const pRes = await fetch(`${GHL_API_URL}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, { headers });
        const pData = await pRes.json().catch(() => ({}));
        const list = (pData && pData.pipelines) || [];
        const match = list.find(p => String(p.name || '').toLowerCase().includes(want));
        const first = match && (match.stages || []).slice().sort((x, y) => (x.position || 0) - (y.position || 0))[0];
        if (match && first) { pipelineId = match.id; stageId = first.id; pName = `${match.name} / ${first.name}`; }
        else pipeline = `no pipeline named like "${want}" (${pRes.status})`;
      }
      if (pipelineId && stageId) {
        const oRes = await fetch(`${GHL_API_URL}/opportunities/`, {
          method: 'POST', headers,
          body: JSON.stringify({
            locationId: GHL_LOCATION_ID,
            pipelineId,
            pipelineStageId: stageId,
            name: `${contact.firstName} ${contact.lastName} — ${sourceTagMap[formName] || formName}`.trim(),
            contactId,
            status: 'open',
            source: 'Website Form',
          }),
        });
        const oData = await oRes.json().catch(() => ({}));
        pipeline = oRes.ok ? `added to ${pName}` : `error ${oRes.status}: ${short(oData)}`;
      }
    } catch (e) {
      pipeline = `error: ${String(e.message).slice(0, 80)}`;
    }
    if (!pipeline.startsWith('added')) console.warn('Pipeline step:', pipeline);

    return reply(crm, `note ${noteOk ? 'ok' : 'failed'}; pipeline ${pipeline}`);
  } catch (err) {
    console.error('Function error:', err.message);
    return reply('error', `network: ${String(err.message).slice(0, 120)}`);
  }
};
