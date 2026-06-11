/**
 * Lightweight browser tracking script served at /track.js by apps/api.
 * Privacy notes:
 * - respects navigator.doNotTrack
 * - visitor id is a random UUID in localStorage (no fingerprinting)
 * - session id is a random UUID in sessionStorage
 */
export function buildTrackingScript(endpoint = '/track'): string {
  return `(function () {
  'use strict';
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      'xxxx-xxxx-xxxx'.replace(/x/g, function () {
        return Math.floor(Math.random() * 16).toString(16);
      });
  }

  function getId(storage, key) {
    try {
      var id = storage.getItem(key);
      if (!id) { id = uuid(); storage.setItem(key, id); }
      return id;
    } catch (e) { return uuid(); }
  }

  var visitorId = getId(window.localStorage, 'rota_visitor_id');
  var sessionId = getId(window.sessionStorage, 'rota_session_id');

  function send(eventName, properties) {
    var body = JSON.stringify({
      eventName: eventName,
      pageUrl: location.pathname + location.search,
      referrer: document.referrer || undefined,
      properties: properties || undefined,
      sessionId: sessionId,
      visitorId: visitorId
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('${endpoint}', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('${endpoint}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    }
  }

  window.rota = window.rota || {};
  window.rota.track = function (eventName, properties) { send(eventName, properties); };

  send('page_view');
})();`;
}
