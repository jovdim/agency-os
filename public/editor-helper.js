(function() {
  'use strict';

  // Listen for scroll commands from the dashboard editor
  // Dashboard sends the content.json section ID (e.g. "services_grid_1")
  // HTML may use a clean anchor ID (e.g. "services") with data-section="services_grid_1"
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'SCROLL_TO_SECTION') {
      var sectionId = event.data.sectionId;

      // Try multiple selectors in priority order:
      // 1. Exact data-section match (most reliable — matches content.json ID)
      // 2. Exact id match (works if HTML uses same ID as content.json)
      // 3. Partial type match (e.g. "services_grid_1" matches id starting with "services")
      var el = document.querySelector('[data-section="' + sectionId + '"]')
            || document.getElementById(sectionId)
            || document.querySelector('section[id^="' + sectionId.replace(/_\d+$/, '') + '"]');

      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
})();
