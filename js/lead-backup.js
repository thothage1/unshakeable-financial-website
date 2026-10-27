/* Unshakeable Financial — lead backup.
   Every time a page sends a lead to /.netlify/functions/submit-lead (the CRM),
   this also saves a copy in Netlify Forms ("website-lead-backup"), so no lead is
   lost if the CRM is down. Netlify can email you each new submission. */
(function () {
  if (!window.fetch || window.__ufLeadBackup) return;
  window.__ufLeadBackup = true;
  var origFetch = window.fetch;
  var core = ['form-name', 'first-name', 'last-name', 'firstName', 'lastName', 'email', 'phone'];
  window.fetch = function (url, opts) {
    try {
      var u = typeof url === 'string' ? url : (url && url.url) || '';
      if (u.indexOf('/.netlify/functions/submit-lead') !== -1 && opts && typeof opts.body === 'string') {
        var src = new URLSearchParams(opts.body);
        var details = [];
        src.forEach(function (v, k) { if (core.indexOf(k) === -1 && v) details.push(k + ': ' + v); });
        var backup = new URLSearchParams({
          'form-name': 'website-lead-backup',
          'source-form': src.get('form-name') || '',
          'page': window.location.pathname,
          'first-name': src.get('first-name') || src.get('firstName') || '',
          'last-name': src.get('last-name') || src.get('lastName') || '',
          'email': src.get('email') || '',
          'phone': src.get('phone') || '',
          'details': details.join('\n')
        });
        origFetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: backup.toString()
        }).catch(function () {});
      }
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };
})();
