// PickGauge — Vercel Web Analytics bootstrap.
//
// The analytics intake itself is served by Vercel from the same origin at
// /_vercel/insights/script.js.  Keep this tiny bootstrap in a separate file
// because PickGauge's CSP intentionally disallows arbitrary inline scripts.
//
// Privacy guard: PickGauge has no need to analyze URL query strings or hashes,
// and auth providers can legitimately use them for transient state. Strip both
// before Vercel receives a page-view event.
(function () {
  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };

  window.va('beforeSend', function (event) {
    try {
      var url = new URL(event.url);
      url.search = '';
      url.hash = '';
      return Object.assign({}, event, { url: url.toString() });
    } catch (_) {
      return event;
    }
  });
})();
