// ── PROFESSIONAL MRANTI CORE SYSTEM SHELL ──
    const CRM_CONTACTS_DATA_URL = 'https://mrantidata.app.n8n.cloud/webhook/crm-contacts-data-test';
    const CRM_RECORD_MUTATION_URL = 'https://mrantidata.app.n8n.cloud/webhook/crm-record-mutation-test';
    const CRM_RELATIONSHIP_PAGE_URL = 'https://mrantidata.app.n8n.cloud/webhook/crm-relationships-page-test';
    const CRM_PREFERENCES_KEY = 'mranti_crm_preferences_v1';

    const SYSTEM_ROUTES = {
      dashboard: { title: 'Dashboard', subtitle: 'Your meetings, context and relationship activity' },
      contacts: { title: 'Context', subtitle: 'Organisation-wide relationship records and meeting history' },
      'my-records': { title: 'My Entries', subtitle: 'Edit, archive and restore records uploaded using your account' },
      relationships: { title: 'Relationship Intelligence', subtitle: 'Explore MRANTI relationship context and network connections' },
      profile: { title: 'My Profile', subtitle: 'Account information and CORE workspace preferences' },
      help: { title: 'Help & Support', subtitle: 'Guidance for common MRANTI CORE tasks' }
    };

    let crmRecords = [];
    let crmSelectedIndex = -1;
    let mySelectedIndex = -1;
    let myActiveTab = 'details';
    let myEditMode = false;
    let myDraftRecord = null;
    let myMoreFiltersOpen = false;
    let mySavingRecord = false;
    let crmEditingRecordIndex = -1;
    let crmContactsLoaded = false;
    let crmContactsLoading = false;
    let crmContactsLoadPromise = null;
    const pendingRecordMutations = new Map();
    let crmPendingRecordKey = '';
    let systemEmbeddedLoaded = { relationships: false };
    let crmContactGroupsDirty = true;

    function systemHashState() {
      const raw = String(window.location.hash || '').replace(/^#/, '').trim();
      const separatorIndex = raw.search(/[?&]/);
      const routePart = (separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw).toLowerCase();
      const queryPart = separatorIndex >= 0 ? raw.slice(separatorIndex + 1) : '';
      return {
        route: SYSTEM_ROUTES[routePart] ? routePart : 'dashboard',
        params: new URLSearchParams(queryPart)
      };
    }

    function systemRouteFromHash() { return systemHashState().route; }
    function systemRecordKeyFromHash() { return systemHashState().params.get('recordId') || ''; }

    function systemNavigate(route, options = {}) {
      const target = SYSTEM_ROUTES[route] ? route : 'dashboard';
      systemCloseSidebar();
      systemCloseUserMenu();
      let hash = '#' + target;
      if (target === 'contacts' && options.recordKey) hash += '?recordId=' + encodeURIComponent(options.recordKey);
      if (window.location.hash !== hash) window.location.hash = hash;
      else showAuthenticatedRoute();
      if (options.focusSearch) setTimeout(() => document.getElementById('crmContactsSearch')?.focus(), 120);
    }

    function coreSelectedContextGroup() {
      try { if (typeof crmBuildContactGroups === 'function') crmBuildContactGroups(); } catch (error) {}
      try {
        const selected = typeof crmCurrentContactGroup === 'function' ? crmCurrentContactGroup() : null;
        const visible = Array.isArray(crmFilteredContactGroups) ? crmFilteredContactGroups : [];
        if (visible.length === 1) return visible[0];
        if (selected && (!visible.length || visible.some(group => group.key === selected.key))) return selected;
        return visible[0] || selected || null;
      } catch (error) { return null; }
    }

    function coreShareUrl(route) {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = route === 'relationships' ? '#relationships' : '#contacts';
      return url.toString();
    }

    function coreShareClean(value) {
      return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function coreSharePdfSafe(value) {
      return coreShareClean(value)
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\u2022/g, '-')
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
    }

    function coreShareDate(record) {
      const candidates = [record?.meetingDate, record?.startDateTime, record?.startTime, record?.timeUploaded, record?.submittedAt, record?.createdAt, record?.lastUpdated];
      for (const candidate of candidates) {
        if (!candidate) continue;
        let parsed = new Date(candidate);
        if (Number.isNaN(parsed.getTime())) parsed = new Date(String(candidate).replace(/^[A-Za-z]{3,9},\s*/, ''));
        if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      return 'Date not recorded';
    }

    const CORE_PDF_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
    let corePdfLibraryPromise = null;

    function coreEnsurePdfLibrary() {
      if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
      if (corePdfLibraryPromise) return corePdfLibraryPromise;
      corePdfLibraryPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-core-pdf-library="true"]');
        const finish = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library did not initialise.'));
        if (existing) {
          existing.addEventListener('load', finish, { once: true });
          existing.addEventListener('error', () => reject(new Error('Unable to load PDF library.')), { once: true });
          setTimeout(finish, 0);
          return;
        }
        const script = document.createElement('script');
        script.src = CORE_PDF_LIBRARY_URL;
        script.async = true;
        script.dataset.corePdfLibrary = 'true';
        script.onload = finish;
        script.onerror = () => reject(new Error('Unable to load PDF library.'));
        document.head.appendChild(script);
      }).catch(error => { corePdfLibraryPromise = null; throw error; });
      return corePdfLibraryPromise;
    }

    function corePdfFileName(name) {
      const safe = coreSharePdfSafe(name || 'Context')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'Context';
      return `${safe}_CORE_Context.pdf`;
    }

    function corePdfSnapshotData(group) {
      const activeEntries = Array.isArray(group?.activeRecords) ? group.activeRecords : [];
      const records = activeEntries.map(entry => entry?.record || entry || {}).filter(Boolean);
      const actions = Array.isArray(group?.actions) ? group.actions.filter(item => item?.isActive !== false) : [];
      const documents = Array.isArray(group?.documents) ? group.documents : [];
      const latest = records[0] || group?.latest || {};
      return {
        name: coreShareClean(group?.name) || 'Unnamed person',
        company: coreShareClean(group?.company) || 'Organisation not recorded',
        role: coreShareClean(group?.jobTitle),
        email: coreShareClean(group?.email),
        phone: coreShareClean(group?.phone),
        location: coreShareClean(group?.location),
        latest,
        records,
        actions,
        documents
      };
    }

    async function coreGenerateContextPdf(group) {
      const JsPDF = await coreEnsurePdfLibrary();
      const data = corePdfSnapshotData(group);
      const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pageWidth = 210;
      const margin = 16;
      const contentWidth = pageWidth - (margin * 2);
      const pageBottom = 281;
      const blue = [37, 99, 235];
      const navy = [15, 23, 42];
      const slate = [100, 116, 139];
      const border = [219, 234, 254];
      let y = 20;

      doc.setProperties({
        title: `${data.name} - CORE Context`,
        subject: 'MRANTI CORE Context Snapshot',
        author: 'MRANTI CORE',
        creator: 'MRANTI CORE'
      });

      function drawPageChrome() {
        doc.setFillColor(248, 251, 255);
        doc.rect(0, 0, pageWidth, 12, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...blue);
        doc.text('MRANTI CORE', margin, 8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...slate);
        doc.text('INTERNAL CONTEXT SNAPSHOT', pageWidth - margin, 8, { align: 'right' });
      }

      function newPage() {
        doc.addPage();
        drawPageChrome();
        y = 22;
      }

      function ensure(height = 10) {
        if (y + height > pageBottom) newPage();
      }

      function writeWrapped(text, options = {}) {
        const value = coreSharePdfSafe(text);
        if (!value) return;
        const x = options.x ?? margin;
        const width = options.width ?? contentWidth;
        const fontSize = options.fontSize ?? 9;
        const lineHeight = options.lineHeight ?? 4.6;
        const color = options.color ?? navy;
        const fontStyle = options.bold ? 'bold' : 'normal';
        doc.setFont('helvetica', fontStyle);
        doc.setFontSize(fontSize);
        doc.setTextColor(...color);
        const lines = doc.splitTextToSize(value, width);
        lines.forEach(line => {
          ensure(lineHeight + 1);
          doc.text(line, x, y);
          y += lineHeight;
        });
      }

      function metaLabel(label, value) {
        const clean = coreSharePdfSafe(value);
        if (!clean) return;
        ensure(10);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(...slate);
        doc.text(coreSharePdfSafe(label).toUpperCase(), margin, y);
        y += 4;
        writeWrapped(clean, { fontSize: 9.2, lineHeight: 4.7 });
        y += 2;
      }

      function section(title, subtitle = '') {
        ensure(16);
        y += 2;
        doc.setDrawColor(...blue);
        doc.setLineWidth(0.6);
        doc.line(margin, y, margin + 8, y);
        y += 5.5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(...navy);
        doc.text(coreSharePdfSafe(title), margin, y);
        y += 5;
        if (subtitle) {
          writeWrapped(subtitle, { fontSize: 7.8, lineHeight: 4, color: slate });
          y += 1;
        }
      }

      function divider() {
        ensure(4);
        doc.setDrawColor(...border);
        doc.setLineWidth(0.25);
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
      }

      drawPageChrome();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(...navy);
      doc.text(coreSharePdfSafe(data.name), margin, y);
      y += 7;
      doc.setFontSize(11);
      doc.setTextColor(...blue);
      doc.text(coreSharePdfSafe(data.company), margin, y);
      y += 7;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...slate);
      doc.text(`Generated ${new Date().toLocaleString('en-MY')}`, margin, y);
      y += 9;

      section('Overview', 'Identity and latest relationship context currently recorded in CORE.');
      metaLabel('Role', data.role);
      metaLabel('Email', data.email);
      metaLabel('Phone', data.phone);
      metaLabel('Location', data.location);
      metaLabel('Relationship history', `${data.records.length} ${data.records.length === 1 ? 'meeting' : 'meetings'} recorded`);
      metaLabel('Last engaged', coreShareDate(data.latest));
      if (data.latest?.meetingTitle) metaLabel('Latest interaction', data.latest.meetingTitle);
      if (data.latest?.reason) metaLabel('Purpose', data.latest.reason);
      if (data.latest?.meetingNotes) metaLabel('Latest notes', data.latest.meetingNotes);
      if (data.latest?.uploaderName || data.latest?.uploaderEmail) metaLabel('Last met by MRANTI', data.latest.uploaderName || data.latest.uploaderEmail);

      section('Relationship History', 'Chronological meeting context linked to this person.');
      if (!data.records.length) {
        writeWrapped('No active relationship history is currently recorded.', { color: slate });
      } else {
        data.records.forEach((record, index) => {
          ensure(22);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.8);
          doc.setTextColor(...navy);
          doc.text(`${index + 1}. ${coreSharePdfSafe(record.meetingTitle || 'Untitled meeting')}`, margin, y);
          y += 5;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.6);
          doc.setTextColor(...slate);
          doc.text(coreSharePdfSafe(coreShareDate(record)), margin, y);
          y += 5;
          if (record.reason) metaLabel('Purpose', record.reason);
          if (record.meetingNotes) metaLabel('Meeting notes', record.meetingNotes);
          if (record.attendees) metaLabel('Attendees', record.attendees);
          if (record.uploaderName || record.uploaderEmail) metaLabel('MRANTI owner', record.uploaderName || record.uploaderEmail);
          if (index < data.records.length - 1) divider();
        });
      }

      section('Action Items', 'All active action items and current statuses associated with this context.');
      if (!data.actions.length) {
        writeWrapped('No active action items are currently recorded.', { color: slate });
      } else {
        data.actions.forEach((item, index) => {
          ensure(18);
          writeWrapped(`${index + 1}. ${item?.action || 'Action not recorded'}`, { bold: true, fontSize: 9.2, lineHeight: 4.6 });
          writeWrapped(`Owner: ${item?.owner || 'Owner not recorded'}   |   Due: ${item?.dueDate || 'Due date not recorded'}   |   Status: ${item?.status || 'Open'}`, { fontSize: 7.8, lineHeight: 4, color: slate });
          y += 3;
        });
      }

      section('Documents', 'Documents linked to this person across recorded meetings.');
      if (!data.documents.length) {
        writeWrapped('No linked documents are currently recorded.', { color: slate });
      } else {
        data.documents.forEach((document, index) => {
          ensure(15);
          writeWrapped(`${index + 1}. ${document?.name || `Document ${index + 1}`}`, { bold: true, fontSize: 9.2, lineHeight: 4.6 });
          const details = [document?._meetingTitle, document?._dateAdded, document?._source].map(coreShareClean).filter(Boolean).join(' | ');
          if (details) writeWrapped(details, { fontSize: 7.8, lineHeight: 4, color: slate });
          if (document?.url) writeWrapped(document.url, { fontSize: 7.2, lineHeight: 3.8, color: blue });
          y += 3;
        });
      }

      const totalPages = doc.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        doc.setPage(pageNumber);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...slate);
        doc.text('MRANTI INTERNAL - Generated from CORE', margin, 291);
        doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, 291, { align: 'right' });
      }

      return { blob: doc.output('blob'), fileName: corePdfFileName(data.name), title: `${data.name} - CORE Context` };
    }

    function coreDownloadPdf(blob, fileName) {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }

    function coreShareFeedback(button, message) {
      const original = button?.dataset?.originalLabel || button?.textContent || 'Share';
      if (button) {
        button.dataset.originalLabel = original;
        button.textContent = message;
        button.disabled = true;
        setTimeout(() => { button.textContent = original; button.disabled = false; }, 1800);
      }
      const status = document.getElementById('dashboardInlineNotice');
      if (status) status.textContent = message;
    }

    async function shareCoreView(route, button) {
      if (route === 'contacts') {
        const group = coreSelectedContextGroup();
        if (!group) {
          coreShareFeedback(button, 'Select a person');
          return;
        }
        try {
          if (button) { button.disabled = true; button.textContent = 'Preparing PDF...'; }
          const snapshot = await coreGenerateContextPdf(group);
          const file = new File([snapshot.blob], snapshot.fileName, { type: 'application/pdf' });
          if (navigator.share && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            if (button) { button.disabled = false; button.textContent = button.dataset.originalLabel || 'Share'; }
            await navigator.share({ files: [file], title: snapshot.title, text: 'MRANTI CORE Context Snapshot' });
            coreShareFeedback(button, 'Shared');
            return;
          }
          coreDownloadPdf(snapshot.blob, snapshot.fileName);
          coreShareFeedback(button, 'PDF downloaded');
        } catch (error) {
          if (error?.name === 'AbortError') {
            if (button) { button.disabled = false; button.textContent = button.dataset.originalLabel || 'Share'; }
            return;
          }
          console.error('CORE Context PDF share failed:', error);
          coreShareFeedback(button, 'PDF failed');
        }
        return;
      }

      const url = coreShareUrl(route);
      const title = 'CORE Relationship Intelligence';
      try {
        if (navigator.share) {
          await navigator.share({ title, text: 'Open CORE Relationship Intelligence in MRANTI CORE.', url });
          coreShareFeedback(button, 'Shared');
          return;
        }
        await navigator.clipboard.writeText(url);
        coreShareFeedback(button, 'Link copied');
      } catch (error) {
        if (error?.name === 'AbortError') return;
        coreShareFeedback(button, 'Unable to share');
      }
    }

    function showAuthenticatedRoute() {
      if (!currentUser) return;
      const route = systemRouteFromHash();
      if (route === 'contacts') {
        const routedRecordKey = systemRecordKeyFromHash();
        if (routedRecordKey) crmPendingRecordKey = routedRecordKey;
      }
      document.body.classList.toggle('crm-relationship-mode', route === 'relationships');
      const app = document.getElementById('appScreen');
      app.style.display = 'block';
      app.setAttribute('aria-hidden', 'false');
      document.querySelectorAll('.system-page').forEach(page => page.classList.toggle('active', page.dataset.page === route));
      document.querySelectorAll('.system-nav-item[data-route]').forEach(item => item.classList.toggle('active', item.dataset.route === route));
      const meta = SYSTEM_ROUTES[route];
      document.getElementById('systemTopTitle').textContent = meta.title;
      document.getElementById('systemTopSubtitle').textContent = meta.subtitle;
      document.title = `${meta.title} · MRANTI CORE`;
      requestAnimationFrame(() => window.scrollTo(0, 0));
      systemApplyPreferences();
      if (!crmContactsLoaded && !crmContactsLoading) crmLoadContacts(false);
      if (route === 'relationships') systemLoadEmbeddedPage('relationships');
      if (route === 'profile') systemRenderProfile();
    }

    function openContactsView() { systemNavigate('contacts'); }
    function closeContactsView() { systemNavigate('dashboard'); }

    window.addEventListener('hashchange', () => { if (currentUser) showAuthenticatedRoute(); });

    function systemToggleSidebar() {
      document.getElementById('systemSidebar').classList.toggle('open');
      document.getElementById('systemSidebarOverlay').classList.toggle('show');
    }
    function systemCloseSidebar() {
      document.getElementById('systemSidebar')?.classList.remove('open');
      document.getElementById('systemSidebarOverlay')?.classList.remove('show');
    }
    function systemToggleUserMenu() { document.getElementById('systemUserMenu').classList.toggle('show'); }
    function systemCloseUserMenu() { document.getElementById('systemUserMenu')?.classList.remove('show'); }
    document.addEventListener('click', event => {
      const menu = document.getElementById('systemUserMenu');
      if (!menu?.classList.contains('show')) return;
      if (event.target.closest('.system-user-menu') || event.target.closest('.system-user-button') || event.target.closest('.system-account-card')) return;
      systemCloseUserMenu();
    });

    function systemSyncUserIdentity(user, firstName) {
      const name = user.displayName || user.email || 'MRANTI User';
      const email = user.email || '';
      const initial = String(firstName || name || 'M').charAt(0).toUpperCase();
      document.getElementById('systemTopInitial').textContent = initial;
      document.getElementById('systemTopUserName').textContent = name;
      document.getElementById('systemMenuName').textContent = name;
      document.getElementById('systemMenuEmail').textContent = email;
      document.getElementById('profileName').textContent = name;
      document.getElementById('profileEmail').textContent = email;
      document.getElementById('profileInitial').textContent = initial;
      const profilePhoto = document.getElementById('profilePhoto');
      if (user.photoURL) { profilePhoto.src = user.photoURL; profilePhoto.style.display = 'block'; document.getElementById('profileInitial').style.display = 'none'; }
      else { profilePhoto.style.display = 'none'; document.getElementById('profileInitial').style.display = 'flex'; }
    }

    function systemGlobalSearchKey(event) {
      if (event.key !== 'Enter') return;
      const query = event.target.value.trim();
      systemNavigate('contacts');
      setTimeout(() => {
        const input = document.getElementById('crmContactsSearch');
        input.value = query;
        crmFilterRecords();
        input.focus();
      }, 120);
    }

    function systemOpenActionItems() {
      myActiveTab = 'actions';
      systemNavigate('my-records');
      setTimeout(() => myFilterRecords(), 100);
    }

    function crmEscape(value) {
      return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function crmNormalize(value) { return CoreSearch.normalize(value); }
    function crmUserEmail() { return String(currentUser?.email || '').trim().toLowerCase(); }
    function crmIsOwned(record) { return Boolean(record && crmUserEmail() && String(record.uploaderEmail || '').trim().toLowerCase() === crmUserEmail()); }
    function crmActionItemId(prefix = 'AI') {
      if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
      return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
    }
    function crmNormalizeActionStatus(value) {
      const normalized = crmNormalize(value);
      if (/(completed|complete|done|closed|resolved)/.test(normalized)) return 'Completed';
      if (/(in progress|progress|ongoing|underway|started)/.test(normalized)) return 'In Progress';
      return 'Open';
    }
    function crmIsOpenActionStatus(value) { return crmNormalizeActionStatus(value) !== 'Completed'; }
    function crmLooksLikeExpressionPayload(value) {
      const text = String(value || '').trim();
      if (!text) return false;
      return /(?:^\s*=\s*\{|\{\{|\}\}|\$json|\$\(|=>|\bconst\b|\blet\b|\breturn\b|\bfunction\b|\bString\s*\(|\bArray\s*\.|\.toLowerCase\s*\(|\.replace\s*\(|\.trim\s*\(|\.filter\s*\(|\.map\s*\(|\.join\s*\(|new\s+Set\s*\(|seen\.|item\.json|Map Meeting Data1|===|\|\|)/i.test(text);
    }
    function crmAttendeeParts(value) {
      if (Array.isArray(value)) return value.flatMap(crmAttendeeParts);
      const text = String(value || '').trim();
      if (!text) return [];
      if (/^\s*=\s*\{/.test(text) || /^\s*\{\{/.test(text)) return [];
      return text.split(/\r?\n|;|,/).map(item => item.trim()).filter(item => item && !crmLooksLikeExpressionPayload(item));
    }
    function crmCleanAttendeeList(value, recordOrOrganisations = {}) {
      const organisations = Array.isArray(recordOrOrganisations)
        ? recordOrOrganisations
        : [
            recordOrOrganisations?.companyName,
            recordOrOrganisations?.company,
            recordOrOrganisations?.organisation,
            recordOrOrganisations?.organization,
            recordOrOrganisations?.organisationName,
            recordOrOrganisations?.externalCompany,
            recordOrOrganisations?.contactOrganisation,
            recordOrOrganisations?.department,
            recordOrOrganisations?.team,
            recordOrOrganisations?.unit
          ];
      const organisationKeys = new Set(organisations.map(crmNormalize).filter(Boolean));
      organisationKeys.add('mranti data team');
      const seen = new Set();
      return crmAttendeeParts(value).filter(person => {
        const key = crmNormalize(person);
        if (!key || organisationKeys.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    function crmCleanAttendeeText(value, recordOrOrganisations = {}) { return crmCleanAttendeeList(value, recordOrOrganisations).join(', '); }
    function crmHasAction(record) { return crmIntelActionEntries(record, crmRecords.indexOf(record)).length > 0; }
    function crmHasDocuments(record) { return Array.isArray(record?.meetingDocuments) && record.meetingDocuments.length > 0; }
    function crmStatus(record) { return String(record?.recordStatus || 'Active').trim() || 'Active'; }
    function crmSortRecords(records) {
      return records.slice().sort((a,b) => {
        const ad = crmRecordOrderingScore(a);
        const bd = crmRecordOrderingScore(b);
        return bd - ad;
      });
    }

    function crmRecordOrderingScore(record) { return CoreSearch.recordOrderingScore(record); }

    function crmSetBanner(message, type = 'info') {
      const banner = document.getElementById('crmContactsBanner');
      if (!banner) return;
      banner.textContent = message || '';
      banner.className = 'crm-contacts-banner ' + type + (message ? ' show' : '');
    }

    async function crmPost(url, payload = {}) {
      if (!currentUser) throw new Error('Your CORE session has expired. Please sign in again.');
      const idToken = await currentUser.getIdToken(false);
      const response = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ ...payload, idToken })
      });
      const text = await response.text();
      let data = {};
      try { data = JSON.parse(text); } catch (error) { throw new Error(text || 'The CORE service returned an invalid response.'); }
      if (!response.ok || data.success === false) throw new Error(data.error || data.message || 'The CORE request failed.');
      return data;
    }

    async function crmFetchHtml(url) {
      if (!currentUser) throw new Error('Your CORE session has expired. Please sign in again.');
      const idToken = await currentUser.getIdToken(false);
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ idToken }) });
      const text = await response.text();
      if (!response.ok) {
        let message = text;
        try { message = JSON.parse(text).error || message; } catch (error) {}
        throw new Error(message || 'Unable to load this CORE module.');
      }
      return text;
    }

    function crmRecordId(record) { return String(record?.recordId || '').trim(); }

    function crmMergePendingMutation(record) {
      const recordId = crmRecordId(record);
      const pending = recordId ? pendingRecordMutations.get(recordId) : null;
      if (!pending) return record;
      const serverStatus = crmNormalize(crmStatus(record));
      const expectedStatus = crmNormalize(pending.expectedStatus);
      if (serverStatus === expectedStatus) {
        pendingRecordMutations.delete(recordId);
        return record;
      }
      return {
        ...record,
        recordStatus: pending.expectedStatus,
        lastUpdated: pending.lastUpdated || record.lastUpdated,
        updatedBy: pending.updatedBy || record.updatedBy
      };
    }

    function crmApplyOptimisticStatus(recordId, expectedStatus, response = {}) {
      const index = crmRecords.findIndex(record => crmRecordId(record) === recordId);
      if (index < 0) return -1;
      const now = response.lastUpdated || new Date().toISOString();
      const updatedBy = response.updatedBy || currentUser?.email || crmRecords[index].updatedBy || '';
      crmRecords[index] = {
        ...crmRecords[index],
        recordStatus: expectedStatus,
        lastUpdated: now,
        updatedBy
      };
      crmContactGroupsDirty = true;
      pendingRecordMutations.set(recordId, {
        recordId,
        expectedStatus,
        timestamp: Date.now(),
        lastUpdated: now,
        updatedBy
      });
      return index;
    }

    async function crmLoadContacts(force = false, options = {}) {
      const silent = Boolean(options.silent);
      if (crmContactsLoadPromise) return crmContactsLoadPromise;
      if (crmContactsLoaded && !force) { crmApplyPendingRecordSelection(); return; }
      const selectedMyKey = crmRecordRouteKey(crmRecords[mySelectedIndex] || {});
      const selectedContactKey = crmSelectedContactKey;
      const selectedMeetingKey = crmRecordRouteKey(crmRecords[crmSelectedMeetingIndex] || {});
      crmContactsLoading = true;
      if (!silent) crmSetBanner('Loading CORE context…', 'info');
      crmContactsLoadPromise = (async () => {
        try {
          const data = await crmPost(CRM_CONTACTS_DATA_URL, { action: 'list', _ts: Date.now() });
          const loaded = Array.isArray(data.records) ? data.records.map((record,index) => {
            const attendeesRaw = record?.attendees ?? '';
            const cleaned = { ...record, attendeesRaw, attendees: crmCleanAttendeeText(attendeesRaw, record), _clientIndex:index };
            return crmMergePendingMutation(cleaned);
          }) : [];
          crmRecords = loaded;
          crmContactGroupsDirty = true;
          crmContactsLoaded = true;
          if (selectedMyKey) {
            const restoredMyIndex = crmFindRecordIndexByRouteKey(selectedMyKey);
            if (restoredMyIndex >= 0) mySelectedIndex = restoredMyIndex;
          }
          if (selectedContactKey) crmSelectedContactKey = selectedContactKey;
          if (selectedMeetingKey) {
            const restoredMeetingIndex = crmFindRecordIndexByRouteKey(selectedMeetingKey);
            if (restoredMeetingIndex >= 0) {
              crmSelectedMeetingIndex = restoredMeetingIndex;
              crmSelectedIndex = restoredMeetingIndex;
            }
          }
          const legacyCount = crmRecords.filter(record => !record.recordId).length;
          if (!silent) crmSetBanner(legacyCount ? `${legacyCount} legacy record${legacyCount===1?' is':'s are'} view-only until Record ID is populated.` : '', 'info');
          systemRenderAllCRMViews();
          crmApplyPendingRecordSelection();
        } catch (error) {
          if (!silent) {
            crmRecords = [];
            crmSetBanner(error.message || 'Unable to load CORE context.', 'error');
            document.getElementById('crmContactsList').innerHTML = '<div class="crm-contacts-empty">Unable to load CORE context. Use Refresh to try again.</div>';
            document.getElementById('myRecordsList').innerHTML = '<div class="crm-contacts-empty">Unable to load your CORE entries.</div>';
          }
          throw error;
        } finally {
          crmContactsLoading = false;
          crmContactsLoadPromise = null;
        }
      })();
      return crmContactsLoadPromise;
    }

    async function crmReconcileRecordMutation(recordId) {
      for (const waitMs of [300, 600, 900]) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
        if (!pendingRecordMutations.has(recordId)) return;
        try { await crmLoadContacts(true, { silent: true }); } catch (error) { console.warn('CRM reconciliation retry failed', error); }
        if (!pendingRecordMutations.has(recordId)) return;
      }
    }

    function systemRenderAllCRMViews() {
      crmFilterRecords();
      myFilterRecords();
      systemRenderDashboardCRM();
      systemRenderProfile();
    }

    function crmRecordSearchText(record) {
      return crmNormalize([
        record.personName,record.companyName,record.email,record.phone,record.jobTitle,record.meetingTitle,record.meetingDate,
        record.attendees,record.reason,record.meetingNotes,crmIntelActionEntries(record).map(item=>[item.action,item.owner,item.dueDate,item.status].join(' ')).join(' '),record.uploaderName,record.uploaderEmail,record.searchIndex,
        (record.meetingDocuments||[]).map(doc=>doc.name).join(' ')
      ].join(' '));
    }

    function crmRecordSearchScore(record, query) {
      return CoreSearch.recordScore(record, query);
    }

    function crmLegacyRecordComposite(record) {
      return crmNormalize([
        record.uploaderEmail, record.meetingTitle, record.meetingDate, record.email, record.companyName, record.personName
      ].join('|'));
    }

    function crmRecordRouteKey(record) {
      const recordId = String(record?.recordId || '').trim();
      return recordId ? `id:${recordId}` : `legacy:${crmLegacyRecordComposite(record || {})}`;
    }

    function crmFindRecordIndexByRouteKey(recordKey) {
      const key = String(recordKey || '').trim();
      if (!key) return -1;
      if (key.startsWith('id:')) {
        const recordId = key.slice(3);
        return crmRecords.findIndex(record => String(record.recordId || '').trim() === recordId);
      }
      if (key.startsWith('legacy:')) {
        const composite = key.slice(7);
        return crmRecords.findIndex(record => !record.recordId && crmLegacyRecordComposite(record) === composite);
      }
      return crmRecords.findIndex(record => String(record.recordId || '').trim() === key);
    }



    function crmRecordCard(record,index,selected,handler) {
      const flags = `${crmHasAction(record)?'<span class="record-badge action">Action items</span>':''}${crmHasDocuments(record)?`<span class="record-badge docs">${record.meetingDocuments.length} document${record.meetingDocuments.length===1?'':'s'}</span>`:''}`;
      return `<button class="record-card ${selected?'active':''}" type="button" data-record-index="${index}" data-record-key="${crmEscape(crmRecordRouteKey(record))}" onclick="${handler}(${index})">
        <div><div class="record-card-name">${crmEscape(record.personName||'Unnamed contact')}</div><div class="record-card-company">${crmEscape(record.companyName||'No company recorded')}</div><div class="record-card-meeting">${crmEscape(record.meetingTitle||'No meeting title')}</div><div class="record-card-purpose">${crmEscape(record.reason||'No purpose recorded')}</div>${flags?`<div class="record-card-badges">${flags}</div>`:''}</div>
        <div class="record-card-date">${crmEscape(record.meetingDate||'No date')}</div>
      </button>`;
    }


    function crmSetText(id,value,fallback='Not recorded') { const el=document.getElementById(id); if(el) el.textContent=value||fallback; }
    function crmSetEmail(id,email) { const el=document.getElementById(id); if(!el)return; el.innerHTML=email?`<a href="mailto:${crmEscape(email)}">${crmEscape(email)}</a>`:'No email recorded'; }
    function crmRenderDocuments(containerId,sectionId,record) {
      const documents=Array.isArray(record?.meetingDocuments)?record.meetingDocuments:[];
      document.getElementById(containerId).innerHTML=documents.map((doc,i)=>`<a class="record-doc" target="_blank" rel="noopener" href="${crmEscape(doc.url)}">View ${crmEscape(doc.name||`Document ${i+1}`)}</a>`).join('');
      document.getElementById(sectionId).style.display=documents.length?'block':'none';
    }




    function myOwnedIndices(){
      const email=crmUserEmail();
      return crmRecords.map((record,index)=>({record,index})).filter(entry=>String(entry.record.uploaderEmail||'').trim().toLowerCase()===email).map(entry=>entry.index);
    }

    function myRecordDateMatches(record, filter) {
      if (!filter || filter === 'All') return true;
      const date = crmIntelDateValue(record);
      if (!date) return false;
      const now = new Date();
      const ageDays = (now.getTime() - date.getTime()) / 86400000;
      if (filter === '30') return ageDays >= 0 && ageDays <= 30;
      if (filter === '90') return ageDays >= 0 && ageDays <= 90;
      if (filter === 'Year') return date.getFullYear() === now.getFullYear();
      if (filter === 'Older') return date.getFullYear() < now.getFullYear();
      return true;
    }

    function myVisibleIndices(){
      const query=String(document.getElementById('myRecordsSearch')?.value||'').trim();
      const sort=document.getElementById('myRecordsSort')?.value||'meeting-desc';
      const scores = new Map();
      const visible=myOwnedIndices().filter(index=>{const score=query?crmRecordSearchScore(crmRecords[index],query):1;scores.set(index,score);return score>0;});
      const meetingScore=index=>crmRecordOrderingScore(crmRecords[index]);
      const updatedScore=index=>Date.parse(crmRecords[index]?.lastUpdated||'')||meetingScore(index);
      visible.sort((a,b)=>{
        if(query&&scores.get(a)!==scores.get(b))return scores.get(b)-scores.get(a);
        if(sort==='meeting-asc')return meetingScore(a)-meetingScore(b);
        if(sort==='updated-desc')return updatedScore(b)-updatedScore(a);
        if(sort==='title-asc')return String(crmRecords[a]?.meetingTitle||'').localeCompare(String(crmRecords[b]?.meetingTitle||''),undefined,{sensitivity:'base'});
        if(sort==='contact-asc')return String(crmRecords[a]?.personName||'').localeCompare(String(crmRecords[b]?.personName||''),undefined,{sensitivity:'base'});
        return meetingScore(b)-meetingScore(a);
      });
      return visible;
    }

    function myRecordDirectoryMarkup(record,index,selected){
      const date=crmIntelShortDate(record);
      const time=crmIntelTimeRange(record);
      const actionCount=crmIntelActionEntries(record,index).length;
      const flags=[];
      if(actionCount)flags.push(`<span class="my-record-row-flag-v2">${actionCount} action item${actionCount===1?'':'s'}</span>`);
      if(crmHasDocuments(record))flags.push(`<span class="my-record-row-flag-v2">${record.meetingDocuments.length} document${record.meetingDocuments.length===1?'':'s'}</span>`);
      return `<button class="my-record-row-v2 ${selected?'active':''}" type="button" data-record-index="${index}" onclick="mySelectRecord(${index})" aria-pressed="${selected}">
        <span class="my-record-row-main-v2">
          <span class="my-record-row-head-v2">
            <span class="my-record-row-title-v2">${crmEscape(record.meetingTitle||'Untitled meeting')}</span>
            <span class="my-record-row-date-v2">${crmEscape(date)}<br>${crmEscape(time)}</span>
          </span>
          <span class="my-record-row-contact-v2">${crmEscape(record.personName||'Contact not recorded')}</span>
          <span class="my-record-row-org-v2">${crmEscape(record.companyName||'Organisation not recorded')}</span>
          ${flags.length?`<span class="my-record-row-footer-v2"><span class="my-record-row-flags-v2">${flags.join('')}</span></span>`:''}
        </span>
      </button>`;
    }

    function myFilterRecords(){
      const owned=myOwnedIndices();
      const visible=myVisibleIndices();
      const last=crmSortRecords(owned.map(i=>crmRecords[i]))[0];
      const lastUpdated=document.getElementById('myLastUpdated');
      if(lastUpdated)lastUpdated.textContent=last?(last.lastUpdated||last.meetingDate||'—'):'—';
      const count=document.getElementById('myRecordsCount');
      if(count)count.textContent=`${owned.length} record${owned.length===1?'':'s'}`;
      const list=document.getElementById('myRecordsList');
      if(!list)return;
      if(!owned.length){
        list.innerHTML='<div class="my-records-empty-v2"><strong>No records uploaded yet</strong><span>Log a meeting to create your first CORE entry.</span><button class="system-btn primary" onclick="openManualModal()" type="button">Log a meeting</button></div>';
        mySelectedIndex=-1;myEditMode=false;myDraftRecord=null;myClearDetail('empty');return;
      }
      if(!visible.length){
        list.innerHTML='<div class="my-records-empty-v2"><strong>No matching records</strong><span>Adjust the search to see your entries.</span><button class="system-btn subtle" onclick="myClearFilters()" type="button">Clear search</button></div>';
        mySelectedIndex=-1;myEditMode=false;myDraftRecord=null;myClearDetail('filtered');return;
      }
      if(!visible.includes(mySelectedIndex)){
        mySelectedIndex=visible[0];
        myEditMode=false;
        myDraftRecord=null;
        myActiveTab='details';
      }
      list.innerHTML=visible.map(index=>myRecordDirectoryMarkup(crmRecords[index],index,index===mySelectedIndex)).join('');
      myRenderDetail();
    }

    function myClearFilters(){
      const search=document.getElementById('myRecordsSearch');if(search)search.value='';
      const sort=document.getElementById('myRecordsSort');if(sort)sort.value='meeting-desc';
      myFilterRecords();
    }

    function mySelectRecord(index){
      if(!crmRecords[index]||!crmIsOwned(crmRecords[index]))return;
      mySelectedIndex=index;myEditMode=false;myDraftRecord=null;myActiveTab='details';myFilterRecords();
      requestAnimationFrame(()=>document.querySelector(`#myRecordsList .my-record-row-v2[data-record-index="${index}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    }

    function myClearDetail(state='select'){
      const title=document.getElementById('myRecordTitle');if(title)title.textContent=state==='empty'?'No records uploaded yet':'Select a meeting record';
      const meta=document.getElementById('myRecordMeta');if(meta)meta.innerHTML='';
      const uploader=document.getElementById('myRecordUploader');if(uploader)uploader.textContent='';
      const updated=document.getElementById('myRecordUpdated');if(updated)updated.textContent='';
      const permission=document.getElementById('myRecordPermission');if(permission){permission.hidden=true;permission.textContent='';}
      ['myEditBtn','myArchiveBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=true;});
      const restore=document.getElementById('myRestoreBtn');if(restore)restore.style.display='none';
      const save=document.getElementById('mySaveBtn');if(save)save.style.display='none';
      const cancel=document.getElementById('myCancelBtn');if(cancel)cancel.style.display='none';
      const content=document.getElementById('myRecordTabContent');
      if(content)content.innerHTML=state==='empty'?'<div class="my-record-no-selection-v2"><strong>No records uploaded yet</strong><span>Log a meeting to create your first CORE entry.</span></div>':'<div class="my-record-no-selection-v2"><strong>Select a meeting record</strong><span>Choose a record from My Records to review or manage its details.</span></div>';
      myUpdateTabs();
    }

    function myParsePeopleList(value, record = crmRecords[mySelectedIndex] || {}){
      return crmCleanAttendeeList(value, record);
    }

    function mySafeValue(value,fallback='Not recorded'){
      const clean=String(value==null?'':value).trim();return clean||fallback;
    }

    function myDraftField(key){
      return myEditMode&&myDraftRecord?myDraftRecord[key]:crmRecords[mySelectedIndex]?.[key];
    }

    function myUpdateDraftField(key,value){
      if(!myEditMode||!myDraftRecord)return;
      myDraftRecord[key]=value;
      if(key==='meetingDateDate'||key==='meetingDateTime')myDraftRecord.meetingDate=myComposeMeetingDate(myDraftRecord.meetingDateDate,myDraftRecord.meetingDateTime,myDraftRecord.meetingDate);
    }

    function myDateInputParts(value){
      const parsed=crmIntelDateValue({meetingDate:value});
      if(!parsed)return{date:'',time:''};
      const date=`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
      const hasTime=/T\d{2}:\d{2}|\b\d{1,2}:\d{2}|\b\d{1,2}\s*(?:am|pm)/i.test(String(value||''));
      const time=hasTime?`${String(parsed.getHours()).padStart(2,'0')}:${String(parsed.getMinutes()).padStart(2,'0')}`:'';
      return{date,time};
    }

    function myComposeMeetingDate(dateValue,timeValue,fallback){
      if(!dateValue)return fallback||'';
      const parts=dateValue.split('-').map(Number);
      if(parts.length!==3||parts.some(Number.isNaN))return fallback||dateValue;
      const timeParts=String(timeValue||'00:00').split(':').map(Number);
      const date=new Date(parts[0],parts[1]-1,parts[2],timeParts[0]||0,timeParts[1]||0);
      if(Number.isNaN(date.getTime()))return fallback||dateValue;
      const dateLabel=date.toLocaleDateString('en-MY',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
      if(!timeValue)return dateLabel;
      const timeLabel=date.toLocaleTimeString('en-MY',{hour:'numeric',minute:'2-digit',hour12:true});
      return `${dateLabel}, ${timeLabel}`;
    }

    function myReadOnlyField(label,value,full=false,html=false){
      return `<div class="my-field-v2 ${full?'full':''}"><span class="my-field-label-v2">${crmEscape(label)}</span><div class="my-field-value-v2">${html?value:crmEscape(mySafeValue(value))}</div></div>`;
    }

    function myEditField(label,key,value,full=false,type='text',extraClass=''){
      const safe=crmEscape(value||'');
      const control=type==='textarea'?`<textarea class="my-edit-textarea-v2 ${extraClass}" oninput="myUpdateDraftField('${key}',this.value)">${safe}</textarea>`:`<input class="my-edit-input-v2" type="${type}" value="${safe}" oninput="myUpdateDraftField('${key}',this.value)"/>`;
      return `<div class="my-field-v2 ${full?'full':''}"><label>${crmEscape(label)}</label>${control}</div>`;
    }

    function myDetailsMarkup(record){
      const draft=myEditMode&&myDraftRecord?myDraftRecord:record;
      const people=myParsePeopleList(draft.attendees,draft);
      const dateParts=myEditMode?{date:draft.meetingDateDate||'',time:draft.meetingDateTime||''}:myDateInputParts(record.meetingDate);
      const location=record.meetingLocation||record.location||'';
      const meetingFields=myEditMode
        ? myEditField('Meeting Title','meetingTitle',draft.meetingTitle,true)
        : myReadOnlyField('Meeting Title',record.meetingTitle,true);
      const peopleFields=myEditMode
        ? myEditField('Contact','personName',draft.personName)+myEditField('Organisation','companyName',draft.companyName)+myEditField('Email','email',draft.email)+myEditField('Phone','phone',draft.phone)+myEditField('Job Title','jobTitle',draft.jobTitle,true)+myEditField('Attendees','attendees',draft.attendees,true,'textarea')
        : myReadOnlyField('Contact',record.personName)+myReadOnlyField('Organisation',record.companyName)+myReadOnlyField('Email',record.email||'No email recorded')+myReadOnlyField('Phone',record.phone||'No phone recorded')+myReadOnlyField('Job Title',record.jobTitle||'Not recorded',true)+myReadOnlyField('Attendees',people.length?`<div class="my-chip-list-v2">${people.map(person=>`<span class="my-chip-v2">${crmEscape(person)}</span>`).join('')}</div>`:'No attendees recorded',true,true);
      const scheduleFields=myEditMode
        ? myEditField('Meeting Date','meetingDateDate',dateParts.date,false,'date')+myEditField('Meeting Time','meetingDateTime',dateParts.time,false,'time')+myReadOnlyField('Location',location||'Not recorded',true)
        : myReadOnlyField('Meeting Date',crmIntelFullDate(record))+myReadOnlyField('Meeting Time',crmIntelTimeRange(record))+myReadOnlyField('Location',location||'Not recorded',true);
      return `<div class="my-tab-stack-v2">
        <section class="my-form-section-v2"><div class="my-form-section-head-v2">MEETING</div><div class="my-field-grid-v2">${meetingFields}</div></section>
        <section class="my-form-section-v2"><div class="my-form-section-head-v2">PEOPLE</div><div class="my-field-grid-v2">${peopleFields}</div></section>
        <section class="my-form-section-v2"><div class="my-form-section-head-v2">SCHEDULE</div><div class="my-field-grid-v2">${scheduleFields}</div></section>
        <section class="my-form-section-v2"><div class="my-form-section-head-v2">CONTENT</div><div class="my-field-grid-v2">${myEditMode?myEditField('Purpose','reason',draft.reason,true,'textarea'):myReadOnlyField('Purpose',record.reason||'No purpose recorded',true)}</div></section>
      </div>`;
    }

    function myNotesMarkup(record){
      if(myEditMode){
        return `<div class="my-tab-stack-v2"><section class="my-form-section-v2"><div class="my-form-section-head-v2">MEETING NOTES</div>${myEditField('Full meeting notes','meetingNotes',myDraftRecord.meetingNotes,true,'textarea','notes')}</section></div>`;
      }
      const notes=String(record.meetingNotes||'').trim();
      return notes?`<div class="my-content-panel-v2">${crmEscape(notes)}</div>`:'<div class="my-content-empty-v2">No meeting notes recorded.</div>';
    }

    function crmDateInputValue(value){
      const raw=String(value||'').trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
      const parsed=new Date(raw);
      if(Number.isNaN(parsed.getTime()))return'';
      return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
    }

    function myDraftActionItems(){
      if(!myDraftRecord)return[];
      if(!Array.isArray(myDraftRecord.structuredActionItems))myDraftRecord.structuredActionItems=crmIntelActionEntries(myDraftRecord,mySelectedIndex).map(item=>({...item}));
      return myDraftRecord.structuredActionItems;
    }

    function myUpdateActionItem(index,key,value){
      const items=myDraftActionItems();
      if(!items[index])return;
      items[index][key]=key==='status'?crmNormalizeActionStatus(value):value;
    }

    function myAddActionItem(){
      if(!myEditMode||!myDraftRecord)return;
      myDraftActionItems().push({actionItemId:crmActionItemId(),recordId:myDraftRecord.recordId||'',action:'',owner:'',dueDate:'',status:'Open',isActive:true,isNew:true});
      myRenderActiveTab(crmRecords[mySelectedIndex]);
    }

    function myRemoveActionItem(index){
      if(!myEditMode||!myDraftRecord)return;
      myDraftActionItems().splice(index,1);
      myRenderActiveTab(crmRecords[mySelectedIndex]);
    }

    function myActionStatusClass(status){
      const normalized=crmNormalizeActionStatus(status);
      return normalized==='Completed'?'completed':normalized==='In Progress'?'in-progress':'';
    }

    function myFormatActionDueDate(value){
      const raw=String(value||'').trim();
      if(!raw||raw==='Due date not recorded')return'Due date not recorded';
      const input=crmDateInputValue(raw);
      if(!input)return raw;
      const [year,month,day]=input.split('-').map(Number);
      const date=new Date(year,month-1,day);
      return Number.isNaN(date.getTime())?raw:date.toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'});
    }

    function myActionsMarkup(record){
      const actions=myEditMode?myDraftActionItems():crmIntelActionEntries(record,mySelectedIndex);
      if(myEditMode){
        const rows=actions.map((item,index)=>`<tr>
          <td data-label="Action"><textarea aria-label="Action" class="my-action-editor-v2" oninput="myUpdateActionItem(${index},'action',this.value)">${crmEscape(item.action||'')}</textarea></td>
          <td data-label="Owner"><input aria-label="Owner" class="my-action-editor-v2" type="text" value="${crmEscape(item.owner==='Owner not recorded'?'':item.owner||'')}" oninput="myUpdateActionItem(${index},'owner',this.value)"/></td>
          <td data-label="Due date"><input aria-label="Due date" class="my-action-editor-v2" type="date" value="${crmEscape(crmDateInputValue(item.dueDate))}" oninput="myUpdateActionItem(${index},'dueDate',this.value)"/></td>
          <td data-label="Status"><select aria-label="Status" class="my-action-editor-v2" onchange="myUpdateActionItem(${index},'status',this.value)">${['Open','In Progress','Completed'].map(status=>`<option value="${status}" ${crmNormalizeActionStatus(item.status)===status?'selected':''}>${status}</option>`).join('')}</select></td>
          <td data-label="Remove"><button aria-label="Remove action item" class="my-action-remove-v2" onclick="myRemoveActionItem(${index})" title="Remove action item" type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg></button></td>
        </tr>`).join('');
        return `<div class="my-tab-stack-v2"><section class="my-form-section-v2"><div class="my-form-section-head-v2">ACTION ITEMS</div>
          ${actions.length?`<table class="my-action-table-v2 editing"><thead><tr><th>Action</th><th>Owner</th><th>Due date</th><th>Status</th><th aria-label="Remove"></th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="my-content-empty-v2">No action items recorded. Add one below.</div>'}
          <button class="my-action-add-v2" onclick="myAddActionItem()" type="button">+ Add action item</button>
        </section></div>`;
      }
      if(!actions.length)return'<div class="my-content-empty-v2">No action items recorded.</div>';
      const rows=actions.map(item=>`<tr><td data-label="Action">${crmEscape(item.action)}</td><td data-label="Owner">${crmEscape(item.owner||'Owner not recorded')}</td><td data-label="Due date">${crmEscape(myFormatActionDueDate(item.dueDate))}</td><td data-label="Status"><span class="my-action-status-v2 ${myActionStatusClass(item.status)}">${crmEscape(crmNormalizeActionStatus(item.status))}</span></td></tr>`).join('');
      return `<table class="my-action-table-v2"><thead><tr><th style="width:52%">Action</th><th style="width:20%">Owner</th><th style="width:18%">Due date</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function myDocumentsMarkup(record){
      const documents=Array.isArray(record.meetingDocuments)?record.meetingDocuments:[];
      if(!documents.length)return'<div class="my-content-empty-v2">No documents are linked to this meeting.</div>';
      const source=record.inputMethod||record.recordSource||record.source||'Meeting record';
      return `<div class="my-document-list-v2">${documents.map((doc,index)=>{
        const name=doc?.name||doc?.filename||`Document ${index+1}`;
        const type=doc?.type||doc?.mimeType||name.split('.').pop()?.toUpperCase()||'File';
        const url=String(doc?.url||doc?.webViewLink||doc?.downloadUrl||'').trim();
        const meta=[type,source,record.lastUpdated||record.meetingDate].filter(Boolean).join(' · ');
        if(!url)return`<div class="my-document-row-v2 my-document-unavailable-v2"><div><div class="my-document-name-v2">${crmEscape(name)}</div><div class="my-document-meta-v2">${crmEscape(meta)}</div></div><span class="my-document-open-v2 my-document-unavailable-v2">File link unavailable</span></div>`;
        return`<a class="my-document-row-v2" href="${crmEscape(url)}" target="_blank" rel="noopener noreferrer"><div><div class="my-document-name-v2">${crmEscape(name)}</div><div class="my-document-meta-v2">${crmEscape(meta)}</div></div><span class="my-document-open-v2">Open file ↗</span></a>`;
      }).join('')}</div>`;
    }

    function myHistoryMarkup(record){
      const items=[];
      const created=record.createdAt||record.createdDate||'';
      if(created)items.push({title:'Record created',meta:`${created}${record.uploaderName||record.uploaderEmail?` · ${record.uploaderName||record.uploaderEmail}`:''}`});
      if(record.lastUpdated)items.push({title:'Record updated',meta:`${record.lastUpdated}${record.updatedBy?` · ${record.updatedBy}`:''}`});
      if(!items.length)return'<div class="my-content-empty-v2">No record history is available beyond the current record metadata.</div>';
      return `<div class="my-history-list-v2">${items.map(item=>`<div class="my-history-item-v2"><div class="my-history-title-v2">${crmEscape(item.title)}</div><div class="my-history-meta-v2">${crmEscape(item.meta)}</div></div>`).join('')}</div>`;
    }

    function myUpdateTabs(){
      document.querySelectorAll('#myRecordTabs [data-my-tab]').forEach(button=>{
        const active=button.dataset.myTab===myActiveTab;
        button.classList.toggle('active',active);
        button.setAttribute('aria-selected',String(active));
        button.tabIndex=active?0:-1;
      });
    }

    function myRenderActiveTab(record){
      const content=document.getElementById('myRecordTabContent');if(!content)return;
      if(myActiveTab==='notes')content.innerHTML=myNotesMarkup(record);
      else if(myActiveTab==='actions')content.innerHTML=myActionsMarkup(record);
      else if(myActiveTab==='documents')content.innerHTML=myDocumentsMarkup(record);
      else if(myActiveTab==='history')content.innerHTML=myHistoryMarkup(record);
      else content.innerHTML=myDetailsMarkup(record);
      myUpdateTabs();
    }

    function myRenderDetail(){
      const record=crmRecords[mySelectedIndex];
      if(!record||!crmIsOwned(record)){myClearDetail();return;}
      const title=document.getElementById('myRecordTitle');if(title)title.textContent=record.meetingTitle||'Untitled meeting';
      const meta=document.getElementById('myRecordMeta');if(meta)meta.innerHTML=[record.personName||'Contact not recorded',record.companyName||'Organisation not recorded',crmIntelFullDate(record),crmIntelTimeRange(record)].map(value=>`<span>${crmEscape(value)}</span>`).join('');
      const uploader=document.getElementById('myRecordUploader');if(uploader)uploader.textContent=`Uploaded by ${record.uploaderName||record.uploaderEmail||'Unknown uploader'}`;
      const updated=document.getElementById('myRecordUpdated');if(updated)updated.textContent=`Last edited ${record.lastUpdated||'not recorded'}`;
      const owned=crmIsOwned(record);const legacy=!record.recordId;const archived=crmStatus(record).toLowerCase()==='archived';
      const permission=document.getElementById('myRecordPermission');
      if(permission){
        permission.hidden=owned&&!legacy;
        permission.textContent=legacy?'This legacy record is read-only until a unique Record ID is available.':owned?'':`Read-only. Only ${record.uploaderEmail||'the uploader'} may modify this record.`;
      }
      const edit=document.getElementById('myEditBtn');const save=document.getElementById('mySaveBtn');const cancel=document.getElementById('myCancelBtn');const archive=document.getElementById('myArchiveBtn');const restore=document.getElementById('myRestoreBtn');
      if(edit){edit.disabled=!owned||legacy||archived||myEditMode;edit.style.display=myEditMode?'none':'inline-flex';}
      if(save){save.style.display=myEditMode?'inline-flex':'none';save.disabled=mySavingRecord;}
      if(cancel){cancel.style.display=myEditMode?'inline-flex':'none';cancel.disabled=mySavingRecord;}
      if(archive){archive.disabled=!owned||legacy||archived||myEditMode;archive.style.display=!archived&&!myEditMode?'inline-flex':'none';}
      if(restore){restore.style.display=archived&&!legacy&&!myEditMode?'inline-flex':'none';restore.disabled=!owned||mySavingRecord;}
      myRenderActiveTab(record);
    }

    function mySwitchRecordTab(tab){
      if(!['details','notes','actions','documents','history'].includes(tab))return;
      myActiveTab=tab;
      const record=crmRecords[mySelectedIndex];
      if(record)myRenderActiveTab(record);else myUpdateTabs();
    }

    function myRecordTabKeydown(event){
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const tabs=Array.from(document.querySelectorAll('#myRecordTabs [data-my-tab]'));
      if(!tabs.length)return;
      let index=tabs.indexOf(event.currentTarget);
      if(event.key==='Home')index=0;
      else if(event.key==='End')index=tabs.length-1;
      else index=(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      event.preventDefault();tabs[index].focus();mySwitchRecordTab(tabs[index].dataset.myTab);
    }

    function myOpenEdit(){
      const record=crmRecords[mySelectedIndex];
      if(!record?.recordId||!crmIsOwned(record)||crmStatus(record).toLowerCase()==='archived')return;
      const parts=myDateInputParts(record.meetingDate);
      myEditMode=true;
      myDraftRecord={...record,attendees:crmCleanAttendeeText(record.attendees,record),meetingDateDate:parts.date,meetingDateTime:parts.time,structuredActionItems:crmIntelActionEntries(record,mySelectedIndex).map(item=>({...item}))};
      myRenderDetail();
    }

    function myCancelEdit(){
      if(mySavingRecord)return;
      myEditMode=false;myDraftRecord=null;myRenderDetail();
    }

    async function mySaveChanges(){
      const record=crmRecords[mySelectedIndex];
      if(mySavingRecord||!record?.recordId||!crmIsOwned(record)||!myEditMode||!myDraftRecord)return;
      const actionItems=myDraftActionItems().map(item=>({
        actionItemId:String(item.actionItemId||crmActionItemId()).trim(),
        action:String(item.action||'').trim(),
        owner:String(item.owner||'').trim(),
        dueDate:String(item.dueDate||'').trim(),
        status:crmNormalizeActionStatus(item.status),
        isActive:item.isActive!==false
      }));
      const invalidIndex=actionItems.findIndex(item=>!item.action);
      if(invalidIndex>=0){window.alert(`Action item ${invalidIndex+1} requires an Action value.`);myActiveTab='actions';myRenderActiveTab(record);return;}
      const fields={};
      ['personName','companyName','email','phone','jobTitle','meetingTitle','meetingDate','reason','meetingNotes','meetingDocumentsRaw'].forEach(key=>fields[key]=String(myDraftRecord[key]??'').trim());
      fields.attendees=crmCleanAttendeeText(myDraftRecord.attendees,myDraftRecord);
      fields.actionItems=actionItems.map((item,index)=>`${index+1}) ${item.action}`).join(' ');
      const recordKey=crmRecordRouteKey(record);
      const button=document.getElementById('mySaveBtn');
      mySavingRecord=true;if(button){button.disabled=true;button.querySelector('span').textContent='Saving…';}
      try{
        await crmPost(CRM_RECORD_MUTATION_URL,{action:'edit',recordId:record.recordId,record:fields,actionItems});
        myEditMode=false;myDraftRecord=null;crmContactsLoaded=false;await crmLoadContacts(true);
        const refreshed=crmFindRecordIndexByRouteKey(recordKey);if(refreshed>=0)mySelectedIndex=refreshed;myFilterRecords();
      }catch(error){window.alert(error.message||'Unable to save the record.');}
      finally{mySavingRecord=false;if(button){button.disabled=false;button.querySelector('span').textContent='Save Changes';}myRenderDetail();}
    }
    function crmEditField(label,key,value,type='text',full=false){const control=type==='textarea'?`<textarea class="crm-edit-textarea" data-key="${key}">${crmEscape(value)}</textarea>`:`<input class="crm-edit-input" data-key="${key}" type="text" value="${crmEscape(value)}" />`;return `<div class="crm-edit-field ${full?'full':''}"><label>${label}</label>${control}</div>`;}
    function crmCloseEditModal(){document.getElementById('crmEditModal').style.display='none';crmEditingRecordIndex=-1;}
    async function crmSaveRecordEdit(){const record=crmRecords[crmEditingRecordIndex];if(!record?.recordId||!crmIsOwned(record))return;const fields={};document.querySelectorAll('#crmEditFields [data-key]').forEach(el=>fields[el.dataset.key]=el.value.trim());const button=document.getElementById('crmSaveEditBtn');const errorBox=document.getElementById('crmEditError');button.disabled=true;button.textContent='Saving…';errorBox.className='crm-contacts-banner error';errorBox.textContent='';try{await crmPost(CRM_RECORD_MUTATION_URL,{action:'edit',recordId:record.recordId,record:fields});crmCloseEditModal();crmContactsLoaded=false;await crmLoadContacts(true);}catch(error){errorBox.textContent=error.message||'Unable to save the record.';errorBox.className='crm-contacts-banner error show';}finally{button.disabled=false;button.textContent='Save Changes';}}
    async function myMutateStatus(action){
      const record=crmRecords[mySelectedIndex];
      if(!record?.recordId||!crmIsOwned(record)||mySavingRecord)return;
      const verb=action==='archive'?'archive':'restore';
      if(!window.confirm(`${verb.charAt(0).toUpperCase()+verb.slice(1)} this CORE record?`))return;
      const recordId=String(record.recordId).trim();
      const selectedKey=crmRecordRouteKey(record);
      mySavingRecord=true;
      try{
        const response=await crmPost(CRM_RECORD_MUTATION_URL,{action,recordId});
        const expectedStatus=response.recordStatus||(action==='archive'?'Archived':'Active');
        const optimisticIndex=crmApplyOptimisticStatus(recordId,expectedStatus,response);
        if(optimisticIndex>=0)mySelectedIndex=optimisticIndex;
        const selectedIndex=crmFindRecordIndexByRouteKey(selectedKey);
        if(selectedIndex>=0)mySelectedIndex=selectedIndex;
        systemRenderAllCRMViews();
        void crmReconcileRecordMutation(recordId);
      }catch(error){
        window.alert(error.message||`Unable to ${verb} the record.`);
      }finally{
        mySavingRecord=false;
        myRenderDetail();
      }
    }
    function myArchiveSelected(){myMutateStatus('archive');}
    function myRestoreSelected(){myMutateStatus('restore');}
    document.getElementById('crmEditModal').addEventListener('click',event=>{if(event.target.id==='crmEditModal')crmCloseEditModal();});

    function dashboardParseRecordDate(value){
      if(!value)return null;
      const raw=String(value).trim();
      let parsed=new Date(raw);
      if(!Number.isNaN(parsed.getTime()))return parsed;
      const withoutWeekday=raw.replace(/^[A-Za-z]{3,9},\s*/,'');
      parsed=new Date(withoutWeekday);
      if(!Number.isNaN(parsed.getTime()))return parsed;
      const numeric=raw.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
      if(numeric){const day=Number(numeric[1]),month=Number(numeric[2])-1,year=Number(numeric[3]);const result=new Date(year,month,day);if(!Number.isNaN(result.getTime()))return result;}
      return null;
    }
    function dashboardMonthKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;}
    function dashboardBuildMeetingWeeks(active) {
      const now = new Date();
      const currentKey = dashboardMonthKey(now);
      const recordsByDate = new Map();
      (Array.isArray(active) ? active : []).forEach(record => {
        const date = dashboardParseRecordDate(record.meetingDate);
        if (!date || dashboardMonthKey(date) !== currentKey) return;
        const dateKey = ymdKey(date);
        const entries = recordsByDate.get(dateKey) || [];
        entries.push(record);
        recordsByDate.set(dateKey, entries);
      });

      const calendarItems = [];
      Object.entries(calendarEventsByDate || {}).forEach(([dateKey, events]) => {
        if (!dateKey.startsWith(currentKey + '-')) return;
        (Array.isArray(events) ? events : []).forEach(event => calendarItems.push({ dateKey, event }));
      });

      const weeks = [[], [], [], [], []];
      if (calendarItems.length) {
        calendarItems.forEach(({ dateKey, event }, index) => {
          const startRaw = event.start?.dateTime || event.start?.date || dateKey;
          const parsed = event.start?.dateTime ? new Date(event.start.dateTime) : new Date(dateKey + 'T00:00:00');
          const day = Number(dateKey.slice(-2));
          const weekIndex = Math.min(4, Math.max(0, Math.floor((day - 1) / 7)));
          const match = dashboardFindCalendarRecord(recordsByDate.get(dateKey), event);
          const attendees = dashboardExternalAttendees(event).map(item => item.displayName || item.email).filter(Boolean);
          const eventKey = `dashboardCalendarMeeting_${weekIndex}_${index}`;
          window._eventsCache[eventKey] = event;
          const parts = dashboardMeetingDateParts(startRaw);
          const meetingTitle = dashboardCleanDisplayText(event.summary, '') || dashboardCleanDisplayText(match?.meetingTitle, '') || 'Untitled meeting';
          const organisation = dashboardRecordOrganisation(match) || dashboardParsedExternalOrganisation(event) || 'Organisation not recorded';
          const contact = dashboardCleanDisplayText(match?.personName, '') || dashboardCleanDisplayText(match?.externalContact, '') || dashboardPrimaryExternalContact(event) || 'External contact not recorded';
          const purpose = dashboardSanitiseMeetingText(match?.reason || match?.meetingNotes || event.description || '', meetingTitle);
          const location = dashboardCleanDisplayText(event.location, '') || dashboardCleanDisplayText(match?.location, '') || dashboardCleanDisplayText(match?.meetingLocation, '');
          weeks[weekIndex].push({
            recordId: match?.recordId || '', eventKey,
            organisation,
            title: meetingTitle,
            contact,
            dateLabel: parts.date, timeLabel: parts.time,
            purpose,
            location,
            attendeeCount: attendees.length || dashboardAttendeeCount(match?.attendees),
            sortTime: parsed.getTime()
          });
        });
      } else {
        (Array.isArray(active) ? active : []).forEach(record => {
          const parsed = dashboardParseRecordDate(record.meetingDate);
          if (!parsed || dashboardMonthKey(parsed) !== currentKey) return;
          const weekIndex = Math.min(4, Math.max(0, Math.floor((parsed.getDate() - 1) / 7)));
          const parts = dashboardMeetingDateParts(record.meetingDate);
          const meetingTitle = dashboardCleanDisplayText(record.meetingTitle, 'Untitled meeting');
          weeks[weekIndex].push({
            recordId: record.recordId || '', eventKey: '',
            organisation: dashboardRecordOrganisation(record) || 'Organisation not recorded',
            title: meetingTitle,
            contact: dashboardCleanDisplayText(record.personName || record.externalContact, 'External contact not recorded'),
            dateLabel: parts.date, timeLabel: parts.time,
            purpose: dashboardSanitiseMeetingText(record.reason || record.meetingNotes || '', meetingTitle),
            location: dashboardCleanDisplayText(record.location || record.meetingLocation || '', ''),
            attendeeCount: dashboardAttendeeCount(record.attendees),
            sortTime: parsed.getTime()
          });
        });
      }
      weeks.forEach(items => items.sort((a, b) => a.sortTime - b.sortTime));
      dashboardMeetingWeeks = weeks;
      dashboardResetInlineMeetingCards();
      return weeks;
    }

    function dashboardRenderMeetingVisual(active = []){
      const now=new Date();
      const currentKey=dashboardMonthKey(now);
      const previousDate=new Date(now.getFullYear(),now.getMonth()-1,1);
      const previousKey=dashboardMonthKey(previousDate);
      const detailWeeks=dashboardBuildMeetingWeeks(active);
      const weeks=detailWeeks.map(items=>items.length);
      const currentTotal=weeks.reduce((sum,count)=>sum+count,0);
      const previousEvents=Array.isArray(monthCache?.[previousKey])?monthCache[previousKey]:null;
      const trend=document.getElementById('dashboardMeetingsTrend');
      if(trend){
        if(previousEvents){
          const difference=currentTotal-previousEvents.length;
          trend.textContent=difference===0?'Same as last month':difference>0?`+${difference} compared with last month`:`${Math.abs(difference)} fewer than last month`;
        }else if(currentTotal){
          const activeWeeks=weeks.filter(Boolean).length;
          trend.textContent=`Activity across ${activeWeeks} calendar week${activeWeeks===1?'':'s'}`;
        }else{
          trend.textContent=googleAccessToken?'No meetings recorded this month':'Connect Calendar to populate activity';
        }
      }
      const totalElement=document.getElementById('dashboardMeetingsMonth');
      if(totalElement)totalElement.textContent=currentTotal;
      const max=Math.max(1,...weeks);
      const bars=document.getElementById('dashboardMeetingsWeeklyBars');
      if(bars){
        bars.innerHTML=weeks.map((count,index)=>`<button class="weekly-bar" type="button" onclick="dashboardOpenMeetingWeek(${index})" aria-label="Open week ${index+1}, ${count} meeting${count===1?'':'s'}"><span class="weekly-bar-value">${count}</span><span class="weekly-bar-track"><span class="weekly-bar-fill" style="height:${count?Math.max(10,Math.round(count/max*100)):4}%"></span></span><span class="weekly-bar-label">W${index+1}</span></button>`).join('');
        bars.setAttribute('aria-label',`Weekly meeting distribution: ${weeks.map((count,index)=>`week ${index+1}, ${count}`).join('; ')}`);
      }
      if(dashboardExpandedCards.meetings){const details=document.getElementById('dashboardMeetingsDetails');if(details)details.innerHTML=dashboardMeetingDetailMarkup();}
    }

    function dashboardRenderOrganisationVisual(active){
      const now=new Date();
      const currentMonthStart=new Date(now.getFullYear(),now.getMonth(),1);
      const nextMonthStart=new Date(now.getFullYear(),now.getMonth()+1,1);
      const historyByOrganisation=new Map();
      active.forEach(record=>{
        const name=String(record.companyName||'').trim();
        const date=dashboardParseRecordDate(record.meetingDate);
        if(!name||!date)return;
        const key=name.toLowerCase();
        const entry=historyByOrganisation.get(key)||{name,engagements:[]};
        entry.engagements.push({date,record});
        historyByOrganisation.set(key,entry);
      });
      const rows=[];
      historyByOrganisation.forEach(entry=>{
        const monthEngagements=entry.engagements.filter(item=>item.date>=currentMonthStart&&item.date<nextMonthStart).sort((a,b)=>b.date-a.date);
        if(!monthEngagements.length)return;
        const hadEarlierEngagement=entry.engagements.some(item=>item.date<currentMonthStart);
        const latest=monthEngagements[0];
        rows.push({
          name:entry.name,
          status:hadEarlierEngagement?'returning':'new',
          recordId:latest.record?.recordId||'',
          latestDate:latest.date,
          latestLabel:latest.date.toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}),
          latestMeetingTitle:latest.record?.meetingTitle||'Latest meeting title not recorded'
        });
      });
      rows.sort((a,b)=>b.latestDate-a.latestDate||a.name.localeCompare(b.name));
      dashboardOrganisationRows=rows;
      const fresh=rows.filter(item=>item.status==='new').length;
      const returning=rows.filter(item=>item.status==='returning').length;
      const total=fresh+returning;
      dashboardOrganisationTotals={total,fresh,returning};
      const freshPercent=total?fresh/total*100:0;
      const returningPercent=total?returning/total*100:0;
      const totalElement=document.getElementById('dashboardCompaniesCount');
      const freshElement=document.getElementById('dashboardOrgNewCount');
      const returningElement=document.getElementById('dashboardOrgReturningCount');
      const freshSegment=document.getElementById('dashboardOrganisationNewSegment');
      const returningSegment=document.getElementById('dashboardOrganisationReturningSegment');
      const bar=document.getElementById('dashboardOrganisationBar');
      if(totalElement)totalElement.textContent=total;
      if(freshElement)freshElement.textContent=fresh;
      if(returningElement)returningElement.textContent=returning;
      if(freshSegment)freshSegment.style.width=`${freshPercent}%`;
      if(returningSegment)returningSegment.style.width=`${returningPercent}%`;
      if(bar)bar.setAttribute('aria-label',`${total} organisations engaged this month: ${fresh} new and ${returning} returning`);
      if(dashboardExpandedCards.organisations){const details=document.getElementById('dashboardOrganisationsDetails');if(details)details.innerHTML=dashboardOrganisationDetailMarkup();}
    }

    function dashboardAttendeeCount(value){
      if(Array.isArray(value))return value.filter(Boolean).length;
      const raw=String(value||'').trim();
      if(!raw)return 0;
      return raw.split(/[,;\n]+/).map(item=>item.trim()).filter(Boolean).length;
    }

    function dashboardMeetingDateParts(value){
      const parsed=dashboardParseRecordDate(value);
      if(!parsed)return{date:'Date not recorded',time:'Time not recorded'};
      const date=parsed.toLocaleDateString('en-MY',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
      const raw=String(value||'');
      const hasTime=/T\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm)/i.test(raw);
      const time=hasTime?parsed.toLocaleTimeString('en-MY',{hour:'numeric',minute:'2-digit',hour12:true}):'Time not recorded';
      return{date,time};
    }

    function dashboardRecentMeetingCard(record){
      const recordKey=crmRecordRouteKey(record);
      const parts=dashboardMeetingDateParts(record.meetingDate);
      const parsedMeetingDate=dashboardParseRecordDate(record.meetingDate);
      const fullDate=parsedMeetingDate?parsedMeetingDate.toLocaleDateString('en-MY',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):parts.date;
      const organisation=record.companyName||'Organisation not recorded';
      const preview=record.meetingNotes||crmIntelActionEntries(record).map(item=>item.action).join(' ')||record.reason||'No meeting notes recorded.';
      const category=record.reason||'Meeting';
      const attendeeCount=dashboardAttendeeCount(record.attendees);
      return `<button class="dashboard-meeting-card" type="button" data-record-key="${crmEscape(recordKey)}" onclick="systemOpenRecordFromDashboard(this.dataset.recordKey)">
        <div class="dashboard-meeting-title">${crmEscape(record.meetingTitle||'Untitled meeting')}</div>
        <div class="dashboard-meeting-meta">
          <div class="dashboard-meeting-meta-line"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg><span>${crmEscape(fullDate)}</span></div>
          <div class="dashboard-meeting-meta-line"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg><span>${crmEscape(parts.time)}</span></div>
        </div>
        <div class="dashboard-meeting-company">${crmEscape(organisation)}</div>
        <div class="dashboard-meeting-preview">${crmEscape(preview)}</div>
        <div class="dashboard-meeting-footer"><span class="dashboard-meeting-tag">${crmEscape(category)}</span><span>${attendeeCount} attendee${attendeeCount===1?'':'s'}</span></div>
      </button>`;
    }

    function systemRenderDashboardCRM(){
      const active=crmRecords.filter(record=>crmStatus(record).toLowerCase()!=='archived');
      const my=active.filter(crmIsOwned);
      const actions=my.filter(crmHasAction);
      const actionBadge=document.getElementById('systemActionBadge');
      if(actionBadge){actionBadge.textContent=actions.length;actionBadge.classList.toggle('show',actions.length>0);}
      dashboardRenderMeetingVisual(active);
      dashboardRenderOrganisationVisual(active);
      const recent=crmSortRecords(active).slice(0,3);
      const recentContainer=document.getElementById('dashboardRecentActivity');
      if(recentContainer)recentContainer.innerHTML=recent.length?recent.map(dashboardRecentMeetingCard).join(''):'<div class="dashboard-empty">No meetings recorded yet.</div>';
    }
    function systemOpenRecordFromDashboard(recordKey){const key=String(recordKey||'').trim();if(!key){systemNavigate('contacts');return;}crmPendingRecordKey=key;systemNavigate('contacts',{recordKey:key});}
    function systemOpenMyRecord(recordId){const index=crmRecords.findIndex(record=>record.recordId===recordId);if(index>=0)mySelectedIndex=index;systemNavigate('my-records');setTimeout(myFilterRecords,50);}

    async function systemLoadEmbeddedPage(type, force=false) {
      if (type !== 'relationships') return;
      if (systemEmbeddedLoaded.relationships && !force) return;

      const frame = document.getElementById('relationshipFrame');
      const loading = document.getElementById('relationshipLoading');
      if (!frame || !loading) return;

      frame.style.display = 'none';
      loading.style.display = 'flex';
      loading.textContent = 'Loading Relationship Intelligence…';

      try {
        let html = await crmFetchHtml(CRM_RELATIONSHIP_PAGE_URL);
        const integratedStyles = `<style id="mrantiIntegratedRelationshipStyles">
          *,*::before,*::after{box-sizing:border-box}
          html,body{width:100%!important;height:100%!important;min-height:100%!important;margin:0!important;overflow:hidden!important;background:transparent!important}
          body{padding:0!important;font-family:Inter,Segoe UI,sans-serif!important}
          .top-nav,.page-head{display:none!important}
          .shell{width:100%!important;max-width:none!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;gap:10px!important;display:flex!important;flex-direction:column!important;box-sizing:border-box!important;overflow:hidden!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important}
          .filter-row{flex:0 0 auto!important;width:100%!important;gap:10px!important;margin:0!important;align-items:end!important}
          .legend-row{flex:0 0 auto!important;width:100%!important;margin:0!important;padding:0 2px!important}
          .main-workspace{flex:1 1 auto!important;min-height:620px!important;height:auto!important;display:grid!important;grid-template-columns:minmax(0,1fr) minmax(350px,380px)!important;gap:16px!important;align-items:stretch!important;overflow:hidden!important;background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important}
          .graph-panel,.detail-panel{width:100%!important;height:100%!important;min-height:0!important;min-width:0!important;margin:0!important;box-sizing:border-box!important;border-radius:18px!important}
          .graph-panel{overflow:hidden!important}
          .detail-panel{min-width:350px!important;padding:16px!important;overflow-x:hidden!important;overflow-y:auto!important;scrollbar-gutter:stable!important}
          .detail-panel *{min-width:0;box-sizing:border-box}
          .detail-panel p,.detail-panel div,.detail-panel span,.detail-panel strong,.detail-panel button{overflow-wrap:anywhere!important;word-break:normal!important}
          .detail-panel [class*="meeting"],.detail-panel [class*="history"],.detail-panel [class*="staff"]{max-width:100%!important}
          #graphSvg{display:block!important;width:100%!important;height:100%!important;min-height:620px!important}
          @media(max-width:1050px){html,body{height:auto!important;min-height:100%!important;overflow:auto!important}.shell{height:auto!important;overflow:visible!important}.filter-row{flex-wrap:wrap!important}.main-workspace{height:auto!important;min-height:0!important;grid-template-columns:1fr!important;overflow:visible!important}.graph-panel{min-height:640px!important;height:640px!important}.detail-panel{min-width:0!important;min-height:520px!important;height:auto!important;overflow:visible!important}#graphSvg{min-height:640px!important;height:640px!important}}
          @media(max-width:620px){.filter-row{display:grid!important;grid-template-columns:1fr!important}.graph-panel{min-height:520px!important;height:520px!important}.detail-panel{padding:14px!important}#graphSvg{min-height:520px!important;height:520px!important}}
        </style>`;
        html = html.replace('</head>', integratedStyles + '</head>');
        frame.srcdoc = html;
        frame.style.display = 'block';
        loading.style.display = 'none';
        systemEmbeddedLoaded.relationships = true;
      } catch (error) {
        loading.textContent = error.message || 'Unable to load Relationship Intelligence.';
      }
    }
    function systemReloadEmbeddedPage(type) {
      if (type !== 'relationships') return;
      systemEmbeddedLoaded.relationships = false;
      systemLoadEmbeddedPage('relationships', true);
    }

    function systemGetPreferences(){try{return JSON.parse(localStorage.getItem(CRM_PREFERENCES_KEY)||'{}');}catch(error){return {};}}
    function systemApplyPreferences(){const prefs=systemGetPreferences();document.body.classList.toggle('crm-density-compact',prefs.density==='compact');const density=document.getElementById('profileDensity');const defaultPage=document.getElementById('profileDefaultPage');if(density)density.value=prefs.density||'comfortable';if(defaultPage)defaultPage.value=prefs.defaultPage||'dashboard';}
    function systemSavePreferences(){const prefs={defaultPage:document.getElementById('profileDefaultPage').value,density:document.getElementById('profileDensity').value};localStorage.setItem(CRM_PREFERENCES_KEY,JSON.stringify(prefs));systemApplyPreferences();const status=document.getElementById('profilePreferenceStatus');status.textContent='Preferences saved.';setTimeout(()=>status.textContent='',2200);}
    function systemRenderProfile(){if(!currentUser)return;const owned=myOwnedIndices().map(i=>crmRecords[i]);const actions=owned.filter(crmHasAction);const archived=owned.filter(r=>crmStatus(r).toLowerCase()==='archived');const last=crmSortRecords(owned)[0];document.getElementById('profileUploadedCount').textContent=owned.length;document.getElementById('profileActionCount').textContent=actions.length;document.getElementById('profileArchivedCount').textContent=archived.length;document.getElementById('profileLastActivity').textContent=last?(last.lastUpdated||last.meetingDate||'—'):'—';systemApplyPreferences();}
