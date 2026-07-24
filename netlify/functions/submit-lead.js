// Unshakeable Financial Partners — GoHighLevel Lead Integration
// Receives form submissions from the website and creates contacts in GoHighLevel CRM

const GHL_API_KEY = 'pit-e901fbdf-01ec-405e-9eff-a0b4acf40b21';
const GHL_LOCATION_ID = 'gRqC0BlLHXJDWDulti0D';
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

  // "What matters most" priority widget selections
  if (data['priorities'])      notes.push(`Top Priorities: ${data['priorities']}`);

  // Source page tag
  const sourceTagMap = {
    'policy-audit-request':      'policy-audit',
    'wealthy-family-guide':      'guide-download',
    'retirement-readiness-quiz': 'tax-quiz',
    'tax-assessment':            'tax-assessment',
    'agent-interest':            'agent-inquiry',
  };
  if (sourceTagMap[formName]) {
    contact.tags.push(sourceTagMap[formName]);
  }

  if (notes.length > 0) {
    contact.customFields.push({
      id: 'notes',
      field_value: notes.join('\n'),
    });
  }

  // ── Create contact in GoHighLevel ───────────────────────────────────────
  try {
    const ghlRes = await fetch(`${GHL_API_URL}/contacts/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contact),
    });

    const ghlData = await ghlRes.json();

    if (ghlRes.ok) {
      console.log(`✓ Contact created: ${ghlData.contact?.id} | Form: ${formName} | Email: ${contact.email}`);

      // ── Add to pipeline opportunity ──────────────────────────────────────
      if (ghlData.contact?.id) {
        await fetch(`${GHL_API_URL}/opportunities/`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            locationId: GHL_LOCATION_ID,
            name: `${contact.firstName} ${contact.lastName} — ${sourceTagMap[formName] || formName}`,
            contactId: ghlData.contact.id,
            status: 'open',
            source: 'Website Form',
          }),
        }).catch(e => console.warn('Opportunity creation skipped:', e.message));
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };

    } else {
      // GHL returned an error — log it but still tell the user it worked
      // so they don't get confused by error messages
      console.error('GHL API error:', JSON.stringify(ghlData));
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };
    }

  } catch (err) {
    console.error('Function error:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  }
};
