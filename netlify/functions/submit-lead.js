// Unshakeable Financial Partners — GoHighLevel Lead Integration
// Receives form submissions from the website and creates contacts in GoHighLevel CRM

// The CRM key lives in Netlify (Site configuration > Environment variables > GHL_API_KEY),
// never in this public file. If it is missing, leads are still saved by Netlify Forms
// (see js/lead-backup.js), just not pushed into the CRM.
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'gRqC0BILHXJDWDulti0D';
const GHL_API_URL = 'https://services.leadconnectorhq.com';

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
    body: JSON.stringify(detail ? { success: true, crm, detail } : { success: true, crm }),
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

    // 3. Add to a pipeline, only if a pipeline and stage are set in Netlify
    //    (GHL_PIPELINE_ID and GHL_PIPELINE_STAGE_ID); GHL requires both.
    let pipeline = 'not_set';
    if (process.env.GHL_PIPELINE_ID && process.env.GHL_PIPELINE_STAGE_ID) {
      const oRes = await fetch(`${GHL_API_URL}/opportunities/`, {
        method: 'POST', headers,
        body: JSON.stringify({
          locationId: GHL_LOCATION_ID,
          pipelineId: process.env.GHL_PIPELINE_ID,
          pipelineStageId: process.env.GHL_PIPELINE_STAGE_ID,
          name: `${contact.firstName} ${contact.lastName} — ${sourceTagMap[formName] || formName}`.trim(),
          contactId,
          status: 'open',
          source: 'Website Form',
        }),
      }).catch(() => null);
      pipeline = oRes && oRes.ok ? 'added' : `error ${oRes ? oRes.status : 'network'}`;
      if (!(oRes && oRes.ok)) console.warn('Opportunity not created:', pipeline);
    }

    return reply(crm, `note ${noteOk ? 'ok' : 'failed'}; pipeline ${pipeline}`);
  } catch (err) {
    console.error('Function error:', err.message);
    return reply('error', `network: ${String(err.message).slice(0, 120)}`);
  }
};
