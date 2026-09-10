// CONTACT-CENTRIC RELATIONSHIP INTELLIGENCE WORKSPACE
    let crmContactGroups = [];
    let crmFilteredContactGroups = [];
    let crmSelectedContactKey = '';
    let crmSelectedMeetingIndex = -1;
    let crmActiveContactTab = 'overview';
    let crmContactRenderLimit = 12;
    let crmHistoryBackToOverview = false;
    let crmHistoryBackTab = '';
    let crmHistoryFocusSection = '';
    let crmHistoryHighlightAction = '';
    let crmActionItemsFilter = '';
    let crmLatestDocumentFilter = false;
    let crmMobileDirectoryScrollTop = 0;
    let crmMobileContactFilterDraft = null;

    function crmUsesMobileMasterDetail() {
      return window.matchMedia('(max-width: 680px)').matches;
    }

    function crmOpenMobileContactDetail(captureScroll = true) {
      if (!crmUsesMobileMasterDetail()) return;
      const list = document.getElementById('crmContactsList');
      if (captureScroll && list) crmMobileDirectoryScrollTop = list.scrollTop;
      document.getElementById('pageContacts')?.classList.add('mobile-contact-detail');
      requestAnimationFrame(() => {
        document.querySelector('.contact-tab.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        document.querySelector('#pageContacts .contact-workspace-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    function crmMobileBackToContacts() {
      const page = document.getElementById('pageContacts');
      if (!page) return;
      page.classList.remove('mobile-contact-detail');
      requestAnimationFrame(() => {
        const list = document.getElementById('crmContactsList');
        if (list) list.scrollTop = crmMobileDirectoryScrollTop;
        document.querySelector('#pageContacts .contact-intel-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    function crmIntelText(value, fallback = '') {
      const raw = String(value == null ? '' : value)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return raw || fallback;
    }

    function crmIntelDateValue(record) {
      const candidates = [record?.meetingDate, record?.startDateTime, record?.startTime, record?.timeUploaded, record?.submittedAt, record?.createdAt, record?.createdDate, record?.lastUpdated];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) return parsed;
        const withoutWeekday = String(candidate).replace(/^[A-Za-z]{3,9},\s*/, '');
        const fallback = new Date(withoutWeekday);
        if (!Number.isNaN(fallback.getTime())) return fallback;
      }
      return null;
    }

    function crmIntelDateScore(record) {
      return crmRecordOrderingScore(record);
    }

    function crmIntelFullDate(record) {
      const date = crmIntelDateValue(record);
      return date ? date.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not recorded';
    }

    function crmIntelShortDate(record) {
      const date = crmIntelDateValue(record);
      return date ? date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded';
    }

    function crmIntelTimeRange(record) {
      const startCandidate = record?.startDateTime || record?.startTime || record?.meetingDate || '';
      const endCandidate = record?.endDateTime || record?.endTime || '';
      const parseTime = value => {
        if (!value) return '';
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()) && /T\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm)/i.test(String(value))) {
          return parsed.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true });
        }
        const match = String(value).match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/i);
        return match ? match[1].toUpperCase().replace(/\s+/g, ' ') : '';
      };
      const start = parseTime(startCandidate);
      const end = parseTime(endCandidate);
      if (start && end && start !== end) return `${start}–${end}`;
      return start || end || 'Time not recorded';
    }

    function crmIntelInitials(name) {
      const parts = crmIntelText(name, 'Contact').split(/\s+/).filter(Boolean);
      return (parts.slice(0, 2).map(part => part.charAt(0)).join('') || 'C').toUpperCase();
    }

    function crmIntelFirstName(name) {
      const clean = crmIntelText(name, 'this contact').replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, '');
      return clean.split(/\s+/)[0] || 'this contact';
    }

    function crmIntelContactKey(record) {
      const email = crmNormalize(record?.email || '');
      if (email) return `email:${email}`;
      return `person:${crmNormalize(record?.personName || '')}|company:${crmNormalize(record?.companyName || '')}`;
    }

    function crmIntelRecordValue(records, fields, fallback = '') {
      for (const record of records) {
        for (const field of fields) {
          const value = crmIntelText(record?.[field] || '');
          if (value) return value;
        }
      }
      return fallback;
    }

    function crmIntelStatusClass(status) {
      const value = crmNormalize(status);
      if (value.includes('archive')) return 'archived';
      if (value.includes('follow') || value.includes('pending')) return 'follow';
      return '';
    }

    function crmIntelActionStatus(value) {
      return crmNormalizeActionStatus(value);
    }

    function crmIntelActionFragments(value) {
      const raw = String(value == null ? '' : value)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r/g, '')
        .trim();
      if (!raw) return [];

      const fragments = [];
      const numberedMarker = /(^|\s+)(?=\d{1,2}[.)]\s+(?!(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b))/gi;
      raw.split(/\n+/).forEach(line => {
        const markerSplit = line
          .replace(numberedMarker, '\n')
          .replace(/(^|\s+)(?=[•*-]\s+)/g, '\n')
          .split(/\n+/)
          .map(item => item.trim())
          .filter(Boolean);

        markerSplit.forEach(piece => {
          const semicolonParts = piece.split(/\s*;\s*/).map(item => item.trim()).filter(Boolean);
          const useSemicolons = semicolonParts.length > 1 && semicolonParts.every(item => item.length >= 12 && /[A-Za-z]/.test(item));
          (useSemicolons ? semicolonParts : [piece]).forEach(item => {
            const cleaned = crmIntelText(item.replace(/^\s*(?:\d{1,2}[.)]|[•*-])\s*/, ''));
            if (cleaned) fragments.push(cleaned);
          });
        });
      });

      const seen = new Set();
      return fragments.filter(item => {
        const key = crmNormalize(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function crmIntelActionEntries(record, recordIndex = -1) {
      const source=record?.actionItems;
      let rawItems=[];
      if(Array.isArray(source))rawItems=source;
      else if(source&&typeof source==='object')rawItems=[source];
      else rawItems=[source];
      const fallbackOwner = crmIntelText(record?.actionOwner || record?.actionOwnerName || record?.assignee || '');
      const fallbackDueDate = crmIntelText(record?.actionDueDate || record?.dueDate || record?.deadline || '');
      const fallbackStatus = crmIntelText(record?.actionStatus || record?.followUpStatus || '');
      const resolvedIndex = Number.isInteger(recordIndex) && recordIndex >= 0 ? recordIndex : crmRecords.indexOf(record);
      const entries = [];

      rawItems.forEach((item,itemIndex) => {
        const objectItem = item && typeof item === 'object' && !Array.isArray(item) ? item : null;
        if(objectItem && (objectItem.isActive===false || /^(false|0|no)$/i.test(String(objectItem.isActive||''))))return;
        const textValue = objectItem ? (objectItem.action || objectItem.text || objectItem.item || objectItem.description || '') : item;
        const ownerRaw=crmIntelText(objectItem?.owner || objectItem?.assignee || objectItem?.assignedTo || fallbackOwner);
        const dueRaw=crmIntelText(objectItem?.dueDate || objectItem?.deadline || objectItem?.targetDate || fallbackDueDate);
        const status = crmNormalizeActionStatus(objectItem?.status || objectItem?.state || fallbackStatus);
        const fragments=objectItem?[crmIntelText(textValue)].filter(Boolean):crmIntelActionFragments(textValue);
        fragments.forEach((action,fragmentIndex) => {
          const generatedKey=`${crmRecordRouteKey(record)}::action::${crmNormalize(action)}`;
          entries.push({
            actionItemId:String(objectItem?.actionItemId || objectItem?.id || generatedKey).trim(),
            recordId:String(objectItem?.recordId || record?.recordId || '').trim(),
            action,
            owner:ownerRaw||'Owner not recorded',
            dueDate:dueRaw||'Due date not recorded',
            status,
            isActive:true,
            createdBy:String(objectItem?.createdBy||'').trim(),
            createdAt:String(objectItem?.createdAt||'').trim(),
            updatedBy:String(objectItem?.updatedBy||'').trim(),
            updatedAt:String(objectItem?.updatedAt||'').trim(),
            recordIndex: resolvedIndex, record, key:objectItem?.actionItemId||generatedKey, itemIndex, fragmentIndex
          });
        });
      });

      const seen = new Set();
      return entries.filter(item => {
        const key = item.actionItemId ? `id:${item.actionItemId}` : `text:${crmNormalize(item.action)}`;
        if (!crmNormalize(item.action) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function crmIntelActionLines(record) {
      return crmIntelActionEntries(record).map(item => item.action);
    }

    function crmIntelDocumentsForRecord(record, recordIndex) {
      const documents = Array.isArray(record?.meetingDocuments) ? record.meetingDocuments : [];
      return documents.map((document, index) => ({
        ...document,
        _recordIndex: recordIndex,
        _recordKey: crmRecordRouteKey(record),
        _docIndex: index,
        _docKey: `${crmRecordRouteKey(record)}::${index}`,
        _meetingTitle: crmIntelText(record.meetingTitle, 'Untitled meeting'),
        _meetingDate: crmIntelShortDate(record),
        _dateAdded: crmIntelText(document.dateAdded || document.createdAt || document.uploadedAt || record.meetingDate, crmIntelShortDate(record)),
        _source: crmIntelText(document.source || document.uploadSource || record.recordSource || record.source || record.inputMethod, 'Source not recorded')
      }));
    }

    function crmBuildContactGroups(force = false) {
      if (!force && !crmContactGroupsDirty) return crmContactGroups;
      const map = new Map();
      crmRecords.forEach((record, index) => {
        const key = crmIntelContactKey(record);
        if (!map.has(key)) map.set(key, { key, records: [] });
        map.get(key).records.push({ record, index });
      });

      crmContactGroups = Array.from(map.values()).map(group => {
        const allRecords = group.records.slice().sort((a, b) => crmIntelDateScore(b.record) - crmIntelDateScore(a.record));
        const activeRecords = allRecords.filter(entry => crmNormalize(crmStatus(entry.record)) !== 'archived');
        const identityRecords = allRecords.map(entry => entry.record);
        const activeOrdered = activeRecords.map(entry => entry.record);
        const identitySource = activeOrdered.length ? activeOrdered : identityRecords;
        const latestEntry = activeRecords[0] || { record: {}, index: -1 };
        const latest = latestEntry.record;
        const documents = activeRecords.flatMap(entry => crmIntelDocumentsForRecord(entry.record, entry.index));
        const actionSeen = new Set();
        const actions = activeRecords.flatMap(entry => crmIntelActionEntries(entry.record, entry.index)).filter(item => {
          const stableId = String(item.actionItemId || '').trim();
          const key = stableId ? `id:${stableId}` : `record:${item.recordId || item.recordIndex}:${item.key || ''}`;
          if (!key || actionSeen.has(key)) return false;
          actionSeen.add(key);
          return true;
        });
        const searchRecords = activeOrdered.length ? activeOrdered : identityRecords.map(record => ({
          ...record,
          meetingTitle: '', meetingDate: '', reason: '', meetingNotes: '', actionItems: '', meetingDocuments: []
        }));
        return {
          key: group.key,
          allRecords,
          activeRecords,
          records: activeRecords,
          latest,
          latestIndex: latestEntry.index,
          name: crmIntelRecordValue(identitySource, ['personName'], 'Unnamed contact'),
          company: crmIntelRecordValue(identitySource, ['companyName', 'organisation', 'organization'], 'Organisation not recorded'),
          email: crmIntelRecordValue(identitySource, ['email']),
          phone: crmIntelRecordValue(identitySource, ['phone', 'contactNumber']),
          jobTitle: crmIntelRecordValue(identitySource, ['jobTitle', 'position']),
          department: crmIntelRecordValue(identitySource, ['department', 'division']),
          location: crmIntelRecordValue(identitySource, ['contactLocation', 'city', 'country', 'location']),
          latestTitle: activeRecords.length ? crmIntelText(latest.meetingTitle, 'No meeting title recorded') : 'No active meeting records',
          latestDateScore: activeRecords.length ? crmIntelDateScore(latest) : 0,
          documents,
          actions,
          searchRecords
        };
      });
      crmContactGroupsDirty = false;
      return crmContactGroups;
    }

    function crmVisibleContactGroups() {
      crmBuildContactGroups();
      const query = String(document.getElementById('crmContactsSearch')?.value || '').trim();
      const hasActions = Boolean(document.getElementById('crmFilterHasActions')?.checked);
      const hasDocuments = Boolean(document.getElementById('crmFilterHasDocuments')?.checked);
      const sort = document.getElementById('crmContactsSort')?.value || 'engaged-desc';
      const scores = new Map();
      crmContactGroups.forEach(group => {
        const score = query ? Math.max(0, ...group.searchRecords.map(record => crmRecordSearchScore(record, query))) : 1;
        scores.set(group.key, score);
      });
      // If direct identity/email/phone matches exist, suppress incidental mentions
      // from notes, attendees and generated Search Index content.
      const resultFloor = query ? CoreSearch.preferredResultFloor([...scores.values()]) : 1;
      const visible = crmContactGroups.filter(group => {
        const score = scores.get(group.key) || 0;
        if (!score || score < resultFloor) return false;
        if (hasActions && !group.actions.some(item => crmIsOpenActionStatus(item.status))) return false;
        if (hasDocuments && !group.documents.length) return false;
        return true;
      });
      visible.sort((a, b) => {
        if (query && scores.get(a.key) !== scores.get(b.key)) return scores.get(b.key) - scores.get(a.key);
        if (sort === 'engaged-asc') return a.latestDateScore - b.latestDateScore;
        if (sort === 'name-asc') return a.name.localeCompare(b.name);
        if (sort === 'name-desc') return b.name.localeCompare(a.name);
        if (sort === 'company-asc') return a.company.localeCompare(b.company);
        return b.latestDateScore - a.latestDateScore;
      });
      return visible;
    }

    function crmVisibleRecordIndices() {
      return crmVisibleContactGroups().flatMap(group => group.records.map(entry => entry.index));
    }

    function crmDirectoryRow(group) {
      const active = group.key === crmSelectedContactKey;
      return `<button class="contact-directory-row ${active ? 'active' : ''}" type="button" data-contact-key="${encodeURIComponent(group.key)}" onclick="crmSelectContactByKey(decodeURIComponent(this.dataset.contactKey))" aria-pressed="${active ? 'true' : 'false'}">
        <span class="contact-directory-avatar" aria-hidden="true">${crmEscape(crmIntelInitials(group.name))}</span>
        <span class="contact-directory-copy">
          <span class="contact-directory-name">${crmEscape(group.name)}</span>
          <span class="contact-directory-org">${crmEscape(group.company)}</span>
          <span class="contact-directory-latest">${crmEscape(group.latestTitle)}</span>
        </span>
      </button>`;
    }

    function crmCurrentContactGroup() {
      return crmContactGroups.find(group => group.key === crmSelectedContactKey) || null;
    }

    function crmCurrentMeetingRecord() {
      return crmRecords[crmSelectedMeetingIndex] || crmCurrentContactGroup()?.latest || null;
    }

    function crmSelectContactByKey(key, options = {}) {
      const group = crmContactGroups.find(item => item.key === key);
      if (!group) return;
      if (crmUsesMobileMasterDetail()) {
        const list = document.getElementById('crmContactsList');
        if (list) crmMobileDirectoryScrollTop = list.scrollTop;
      }
      const changed = crmSelectedContactKey !== key;
      crmSelectedContactKey = key;
      crmSelectedMeetingIndex = Number.isInteger(options.meetingIndex) && crmRecords[options.meetingIndex] ? options.meetingIndex : group.latestIndex;
      crmSelectedIndex = crmSelectedMeetingIndex;
      if (changed || !options.preserveTab) crmActiveContactTab = options.tab || 'overview';
      if (options.tab) crmActiveContactTab = options.tab;
      crmHistoryBackToOverview = Boolean(options.backToOverview);
      crmHistoryBackTab = options.backTab || (options.backToOverview ? 'overview' : '');
      crmHistoryFocusSection = options.focus || '';
      crmHistoryHighlightAction = '';
      if (changed) crmActionItemsFilter = group.actions.some(item => crmIsOpenActionStatus(item.status)) ? 'Open' : 'All';
      crmLatestDocumentFilter = Boolean(options.latestDocuments);
      crmRenderContactDirectory();
      crmRenderContactIdentity();
      crmRenderContactTabs();
      crmRenderContactWorkspace();
      if (crmUsesMobileMasterDetail()) {
        crmOpenMobileContactDetail(false);
      } else {
        requestAnimationFrame(() => {
          document.querySelector(`#crmContactsList [data-contact-key="${CSS.escape(encodeURIComponent(key))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    }

    function crmSelectRecord(index) {
      const record = crmRecords[index];
      if (!record) return;
      const key = crmIntelContactKey(record);
      crmSelectContactByKey(key, { meetingIndex: index, tab: 'history' });
    }

    function crmRenderContactDirectory() {
      const list = document.getElementById('crmContactsList');
      const count = crmFilteredContactGroups.length;
      const visible = crmFilteredContactGroups.slice(0, crmContactRenderLimit);
      if (document.getElementById('crmDirectoryCount')) document.getElementById('crmDirectoryCount').textContent = `${count} relationship${count === 1 ? '' : 's'}`;
      if (!list) return;
      list.innerHTML = visible.length ? visible.map(crmDirectoryRow).join('') : '<div class="crm-contacts-empty">No context matches the current search and filters.</div>';
      const loadMore = document.getElementById('crmLoadMoreContacts');
      if (loadMore) loadMore.style.display = count > visible.length ? 'block' : 'none';
    }

    function crmLoadMoreContacts() {
      crmContactRenderLimit += 12;
      crmRenderContactDirectory();
    }

    function crmFilterRecords(options = {}) {
      const allowAutoSelect = options.allowAutoSelect !== false;
      crmFilteredContactGroups = crmVisibleContactGroups();
      if (!crmFilteredContactGroups.length) {
        crmSelectedContactKey = '';
        crmSelectedMeetingIndex = -1;
        crmSelectedIndex = -1;
        crmRenderContactDirectory();
        crmClearDetail();
        return;
      }

      const selectedStillVisible = crmFilteredContactGroups.some(group => group.key === crmSelectedContactKey);
      if (!selectedStillVisible && allowAutoSelect) {
        const groupFromIndex = crmRecords[crmSelectedIndex] ? crmFilteredContactGroups.find(group => group.key === crmIntelContactKey(crmRecords[crmSelectedIndex])) : null;
        const selected = groupFromIndex || crmFilteredContactGroups[0];
        crmSelectedContactKey = selected.key;
        crmSelectedMeetingIndex = selected.latestIndex;
        crmSelectedIndex = selected.latestIndex;
        crmActiveContactTab = 'overview';
      } else if (!selectedStillVisible && !allowAutoSelect) {
        crmSelectedContactKey = '';
        crmSelectedMeetingIndex = -1;
      }

      crmRenderContactDirectory();
      if (crmSelectedContactKey) {
        crmRenderContactIdentity();
        crmRenderContactTabs();
        crmRenderContactWorkspace();
      } else {
        crmClearDetail();
      }
    }

    function crmClearSearch() {
      const search = document.getElementById('crmContactsSearch');
      const sort = document.getElementById('crmContactsSort');
      if (search) search.value = '';
      if (sort) sort.value = 'engaged-desc';
      crmResetAdditionalFilters(false);
      crmContactRenderLimit = 12;
      crmFilterRecords();
    }

    function crmSetContactFilterPanelOpen(show, options = {}) {
      const panel = document.getElementById('crmContactFilterPanel');
      const backdrop = document.getElementById('crmContactFilterBackdrop');
      const button = document.getElementById('crmContactFilterButton');
      panel?.classList.toggle('show', show);
      backdrop?.classList.toggle('show', show);
      backdrop?.setAttribute('aria-hidden', String(!show));
      button?.setAttribute('aria-expanded', String(show));
      document.body.classList.toggle('crm-contact-filter-open', show && crmUsesMobileMasterDetail());
      if (show && crmUsesMobileMasterDetail()) {
        requestAnimationFrame(() => panel?.querySelector('input,button')?.focus());
      } else if (!show && options.restoreFocus) {
        requestAnimationFrame(() => button?.focus());
      }
    }

    function crmCaptureContactFilterState() {
      const actions = document.getElementById('crmFilterHasActions');
      const documents = document.getElementById('crmFilterHasDocuments');
      const hasActions = Boolean(actions?.checked);
      const hasDocuments = Boolean(documents?.checked);
      crmMobileContactFilterDraft = {
        originalHasActions: hasActions,
        originalHasDocuments: hasDocuments,
        pendingHasActions: hasActions,
        pendingHasDocuments: hasDocuments
      };
      if (actions) actions.checked = hasActions;
      if (documents) documents.checked = hasDocuments;
    }

    function crmUpdateContactFilterButtonState() {
      if (!crmUsesMobileMasterDetail()) return;
      const button = document.getElementById('crmContactFilterButton');
      const isActive = Boolean(document.getElementById('crmFilterHasActions')?.checked || document.getElementById('crmFilterHasDocuments')?.checked);
      button?.classList.toggle('active', isActive);
      button?.setAttribute('aria-pressed', String(isActive));
    }

    function crmHandleContactFilterChange() {
      const panelOpen = document.getElementById('crmContactFilterPanel')?.classList.contains('show');
      if (crmUsesMobileMasterDetail() && panelOpen) {
        if (!crmMobileContactFilterDraft) crmCaptureContactFilterState();
        crmMobileContactFilterDraft.pendingHasActions = Boolean(document.getElementById('crmFilterHasActions')?.checked);
        crmMobileContactFilterDraft.pendingHasDocuments = Boolean(document.getElementById('crmFilterHasDocuments')?.checked);
        return;
      }
      crmFilterRecords();
    }

    function crmToggleContactFilters(event) {
      event?.stopPropagation();
      const panel = document.getElementById('crmContactFilterPanel');
      const show = !panel?.classList.contains('show');
      if (crmUsesMobileMasterDetail()) {
        if (show) {
          crmCaptureContactFilterState();
          crmSetContactFilterPanelOpen(true);
        } else {
          crmCancelContactFilters(event);
        }
        return;
      }
      crmSetContactFilterPanelOpen(show);
    }

    function crmApplyContactFilters(event) {
      event?.stopPropagation();
      const panelOpen = document.getElementById('crmContactFilterPanel')?.classList.contains('show');
      if (!(crmUsesMobileMasterDetail() && panelOpen)) {
        crmFilterRecords();
        crmSetContactFilterPanelOpen(false);
        return;
      }
      if (!crmMobileContactFilterDraft) crmCaptureContactFilterState();
      crmMobileContactFilterDraft.pendingHasActions = Boolean(document.getElementById('crmFilterHasActions')?.checked);
      crmMobileContactFilterDraft.pendingHasDocuments = Boolean(document.getElementById('crmFilterHasDocuments')?.checked);
      const actions = document.getElementById('crmFilterHasActions');
      const documents = document.getElementById('crmFilterHasDocuments');
      if (actions) actions.checked = crmMobileContactFilterDraft.pendingHasActions;
      if (documents) documents.checked = crmMobileContactFilterDraft.pendingHasDocuments;
      crmMobileContactFilterDraft = null;
      crmFilterRecords();
      crmUpdateContactFilterButtonState();
      crmSetContactFilterPanelOpen(false, { restoreFocus: true });
    }

    function crmCancelContactFilters(event) {
      event?.stopPropagation();
      const panelOpen = document.getElementById('crmContactFilterPanel')?.classList.contains('show');
      if (crmUsesMobileMasterDetail() && panelOpen) {
        const actions = document.getElementById('crmFilterHasActions');
        const documents = document.getElementById('crmFilterHasDocuments');
        if (crmMobileContactFilterDraft) {
          if (actions) actions.checked = crmMobileContactFilterDraft.originalHasActions;
          if (documents) documents.checked = crmMobileContactFilterDraft.originalHasDocuments;
        }
        crmMobileContactFilterDraft = null;
        crmSetContactFilterPanelOpen(false, { restoreFocus: true });
        return;
      }
      crmSetContactFilterPanelOpen(false);
    }

    function crmHandleContactFilterBackdrop(event) {
      if (crmUsesMobileMasterDetail()) {
        crmCancelContactFilters(event);
      } else {
        crmToggleContactFilters(event);
      }
    }

    function crmResetContactFilterDraft() {
      const panelOpen = document.getElementById('crmContactFilterPanel')?.classList.contains('show');
      if (crmUsesMobileMasterDetail() && panelOpen) {
        const actions = document.getElementById('crmFilterHasActions');
        const documents = document.getElementById('crmFilterHasDocuments');
        if (!crmMobileContactFilterDraft) crmCaptureContactFilterState();
        if (actions) actions.checked = false;
        if (documents) documents.checked = false;
        crmMobileContactFilterDraft.pendingHasActions = false;
        crmMobileContactFilterDraft.pendingHasDocuments = false;
        return;
      }
      crmResetAdditionalFilters();
    }

    function crmResetAdditionalFilters(render = true) {
      const actions = document.getElementById('crmFilterHasActions');
      const documents = document.getElementById('crmFilterHasDocuments');
      if (actions) actions.checked = false;
      if (documents) documents.checked = false;
      crmMobileContactFilterDraft = null;
      if (crmUsesMobileMasterDetail()) crmUpdateContactFilterButtonState();
      if (render) crmFilterRecords();
    }

    function crmToggleContactMenu() {}

    function crmContactMetaMarkup(group) {
      const items = [];
      if (group.email) items.push(`<span class="contact-meta-item"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path><path d="m4 7 8 6 8-6"></path></svg><a href="mailto:${crmEscape(group.email)}">${crmEscape(group.email)}</a></span>`);
      if (group.phone) items.push(`<span class="contact-meta-item"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"></path></svg><span>${crmEscape(group.phone)}</span></span>`);
      if (group.location) items.push(`<span class="contact-meta-item"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z"></path><circle cx="12" cy="10" r="2.5"></circle></svg><span>${crmEscape(group.location)}</span></span>`);
      return items.join('');
    }

    function crmRenderContactIdentity() {
      const group = crmCurrentContactGroup();
      if (!group) return crmClearDetail();
      document.getElementById('crmContactAvatar').textContent = crmIntelInitials(group.name);
      document.getElementById('crmContactName').textContent = group.name;
      document.getElementById('crmContactOrganisation').textContent = group.company;
      document.getElementById('crmContactRole').textContent = [group.jobTitle, group.department].filter(Boolean).join(' · ');
      document.getElementById('crmContactMeta').innerHTML = crmContactMetaMarkup(group);
      document.getElementById('crmContactMeetingCount').textContent = `${group.records.length} meeting${group.records.length === 1 ? '' : 's'}`;
      document.getElementById('crmContactLastEngaged').textContent = group.activeRecords.length ? `Last engaged ${crmIntelShortDate(group.latest)}` : 'Last engaged —';
    }

    function crmRenderContactTabs() {
      document.querySelectorAll('.contact-tab[data-tab]').forEach(button => {
        const active = button.dataset.tab === crmActiveContactTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
    }

    function crmSwitchContactTab(tab, options = {}) {
      if (!['overview', 'history', 'actions', 'documents', 'record'].includes(tab)) return;
      crmActiveContactTab = tab;
      if (tab !== 'history') {
        crmHistoryBackToOverview = false;
        crmHistoryBackTab = '';
        crmHistoryFocusSection = '';
        crmHistoryHighlightAction = '';
      }
      if (tab === 'actions') {
        const group = crmCurrentContactGroup();
        if (!['All', 'Open', 'Completed'].includes(crmActionItemsFilter)) crmActionItemsFilter = group?.actions.some(item => crmIsOpenActionStatus(item.status)) ? 'Open' : 'All';
        if (crmActionItemsFilter === 'Open' && !group?.actions.some(item => crmIsOpenActionStatus(item.status))) crmActionItemsFilter = 'All';
      }
      if (tab !== 'documents' && !options.preserveDocumentFilter) crmLatestDocumentFilter = false;
      crmRenderContactTabs();
      crmRenderContactWorkspace();
      if (crmUsesMobileMasterDetail()) {
        requestAnimationFrame(() => document.querySelector('.contact-tab.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
      }
    }

    function crmContactTabKeydown(event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(document.querySelectorAll('.contact-tab[data-tab]'));
      const current = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      event.preventDefault();
      crmSwitchContactTab(tabs[next].dataset.tab);
      tabs[next].focus();
    }

    function crmOpenHistoryForMeeting(index, focus = '', backToOverview = true) {
      if (!crmRecords[index]) return;
      crmSelectedMeetingIndex = index;
      crmSelectedIndex = index;
      crmHistoryFocusSection = focus;
      crmHistoryBackToOverview = backToOverview;
      crmHistoryBackTab = backToOverview ? 'overview' : '';
      crmHistoryHighlightAction = '';
      crmActiveContactTab = 'history';
      crmRenderContactIdentity();
      crmRenderContactTabs();
      crmRenderContactWorkspace();
    }

    function crmOpenAllActionItems() {
      const group = crmCurrentContactGroup();
      if (!group) return;
      crmActionItemsFilter = group.actions.some(item => crmIsOpenActionStatus(item.status)) ? 'Open' : 'All';
      crmSwitchContactTab('actions');
    }

    function crmSetActionItemsFilter(filter) {
      if (!['All', 'Open', 'Completed'].includes(filter)) return;
      crmActionItemsFilter = filter;
      crmRenderContactWorkspace();
    }

    function crmOpenActionItem(index, actionKey) {
      if (!crmRecords[index]) return;
      crmSelectedMeetingIndex = index;
      crmSelectedIndex = index;
      crmHistoryFocusSection = 'actions';
      crmHistoryBackToOverview = false;
      crmHistoryBackTab = 'actions';
      crmHistoryHighlightAction = actionKey || '';
      crmActiveContactTab = 'history';
      crmRenderContactIdentity();
      crmRenderContactTabs();
      crmRenderContactWorkspace();
    }

    function crmBackToActionItems() {
      crmHistoryBackTab = '';
      crmHistoryFocusSection = '';
      crmHistoryHighlightAction = '';
      crmActiveContactTab = 'actions';
      crmRenderContactTabs();
      crmRenderContactWorkspace();
    }

    function crmOpenLatestDocuments() {
      const group = crmCurrentContactGroup();
      if (!group) return;
      crmLatestDocumentFilter = true;
      crmActiveContactTab = 'documents';
      crmRenderContactTabs();
      crmRenderContactWorkspace();
    }

    function crmRenderContactWorkspace() {
      const content = document.getElementById('crmWorkspaceContent');
      const group = crmCurrentContactGroup();
      if (!content) return;
      if (!group) {
        content.innerHTML = '<div class="contact-empty-state">Select a contact to review relationship intelligence.</div>';
        return;
      }
      if (crmActiveContactTab === 'history') content.innerHTML = crmHistoryMarkup(group);
      else if (crmActiveContactTab === 'actions') content.innerHTML = crmActionItemsMarkup(group);
      else if (crmActiveContactTab === 'documents') content.innerHTML = crmDocumentsMarkup(group);
      else if (crmActiveContactTab === 'record') content.innerHTML = crmRecordInfoMarkup(group);
      else content.innerHTML = crmOverviewMarkup(group);
      crmRenderContactIdentity();
      if (crmHistoryFocusSection) {
        const targetId = crmHistoryFocusSection === 'notes' ? 'crmMeetingNotesFocus' : crmHistoryFocusSection === 'actions' ? 'crmMeetingActionsFocus' : '';
        if (targetId) requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }
      if (crmHistoryHighlightAction) {
        requestAnimationFrame(() => document.querySelector(`[data-action-key="${CSS.escape(encodeURIComponent(crmHistoryHighlightAction))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }
    }

    function crmIntelligenceValues(value, maxItems = 8) {
      const source = Array.isArray(value) ? value : String(value || '').split(/[,;|\n]+/);
      const seen = new Set();
      return source.map(item => String(item || '').trim()).filter(item => {
        const key = item.toLowerCase();
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, maxItems);
    }

    function crmMeetingIntelligenceMarkup(record) {
      const topics = crmIntelligenceValues(record?.topics || record?.meetingTopics || '', 5);
      const keywords = crmIntelligenceValues(record?.keywords || record?.meetingKeywords || '', 8);
      const sentiment = crmIntelText(record?.sentiment || record?.meetingSentiment, '');
      if (!topics.length && !keywords.length && !sentiment) return '';
      const safeClass = crmNormalize(sentiment).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const chips = [];
      if (sentiment) chips.push(`<span class="context-intel-chip sentiment sentiment-${crmEscape(safeClass)}">${crmEscape(sentiment)}</span>`);
      topics.forEach(topic => chips.push(`<span class="context-intel-chip topic">${crmEscape(topic)}</span>`));
      keywords.slice(0,5).forEach(keyword => chips.push(`<span class="context-intel-chip keyword">#${crmEscape(keyword.replace(/^#/,'').trim())}</span>`));
      return `<div class="context-intelligence-block"><div class="contact-section-kicker">CORE Intelligence</div><div class="context-intelligence-chips">${chips.join('')}</div></div>`;
    }

    function crmOverviewMarkup(group) {
      if (!group.activeRecords.length) {
        return `<section class="contact-panel-card"><div class="contact-panel-title-row"><div><div class="contact-panel-title">No current relationship activity</div><div class="contact-panel-subtitle">This contact remains available, but all linked meeting records are archived.</div></div></div><div class="followup-empty">Restore a meeting from My Entries to include it again in current relationship activity.</div></section>`;
      }
      const latest = group.latest;
      const latestIndex = group.latestIndex;
      const summary = crmIntelText(latest.meetingNotes || latest.reason, 'No discussion summary has been recorded for the latest interaction.');
      const openActions = group.actions.filter(item => crmIsOpenActionStatus(item.status)).slice(0, 4);
      const staff = crmIntelText(latest.uploaderName || latest.updatedBy || latest.uploaderEmail, 'MRANTI staff not recorded');
      const intelligenceMarkup = crmMeetingIntelligenceMarkup(latest);
      const followRows = openActions.map(item => `<tr><td>${crmEscape(item.action)}</td><td>${crmEscape(item.owner)}</td><td>${crmEscape(item.dueDate)}</td><td><span class="followup-status">${crmEscape(item.status)}</span></td></tr>`).join('');
      const documentsRow = group.documents.length ? `<section class="contact-panel-card"><button class="supporting-doc-row" onclick="crmOpenLatestDocuments()" type="button"><span><strong>${group.documents.length} relevant document${group.documents.length === 1 ? '' : 's'} available</strong><span>Meeting documents, decks and notes connected to this contact.</span></span><strong aria-hidden="true">›</strong></button></section>` : '';

      return `<section class="contact-panel-card">
        <div class="contact-panel-title-row"><div><div class="contact-panel-title">Before you meet ${crmEscape(crmIntelFirstName(group.name))}</div><div class="contact-panel-subtitle">The latest MRANTI context you need for the conversation.</div></div></div>
        <div class="overview-hero-body">
          <div class="overview-latest">
            <div class="contact-section-kicker">Latest interaction</div>
            <div class="overview-meeting-title">${crmEscape(group.latestTitle)}</div>
            <div class="overview-meeting-meta"><span>${crmEscape(crmIntelShortDate(latest))}</span><span>${crmEscape(crmIntelTimeRange(latest))}</span><span>${crmEscape(crmIntelText(latest.meetingFormat || latest.source || latest.inputMethod, 'Meeting source not recorded'))}</span></div>
            <div class="overview-last-met"><div class="contact-section-kicker">Last met by MRANTI</div><strong>${crmEscape(staff)}</strong><span>${crmEscape(crmIntelText(latest.uploaderUnit || latest.department, 'MRANTI'))}</span></div>
          </div>
          <div class="overview-discussion">
            <div class="contact-section-kicker">Discussion brief</div>
            <div class="overview-summary clamped">${crmEscape(summary)}</div>
            ${intelligenceMarkup}
            <div class="overview-link-row"><button class="contact-link-button" onclick="crmOpenHistoryForMeeting(${latestIndex}, 'notes', true)" type="button">Read full meeting notes <span aria-hidden="true">→</span></button></div>
          </div>
        </div>
      </section>
      <section class="contact-panel-card overview-followups-full">
        <div class="contact-panel-title-row"><div class="contact-panel-title">Open follow-ups</div></div>
        ${followRows ? `<table class="followup-table"><thead><tr><th style="width:48%">Action</th><th style="width:22%">Owner</th><th style="width:19%">Due date</th><th>Status</th></tr></thead><tbody>${followRows}</tbody></table><div class="overview-followup-link"><button class="contact-link-button" onclick="crmOpenAllActionItems()" type="button">View all action items <span aria-hidden="true">→</span></button></div>` : '<div class="followup-empty">No open follow-ups recorded.</div>'}
      </section>
      ${documentsRow}`;
    }

    function crmSelectContactMeeting(index) {
      if (!crmRecords[index]) return;
      crmSelectedMeetingIndex = index;
      crmSelectedIndex = index;
      crmHistoryFocusSection = '';
      crmHistoryHighlightAction = '';
      crmRenderContactIdentity();
      crmRenderContactWorkspace();
      requestAnimationFrame(() => document.querySelector(`.timeline-item[data-record-index="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }

    function crmActionItemsMarkup(group) {
      const actions = group.actions.slice();
      const openCount = actions.filter(item => crmIsOpenActionStatus(item.status)).length;
      const completedCount = actions.filter(item => item.status === 'Completed').length;
      if (!['All', 'Open', 'Completed'].includes(crmActionItemsFilter)) crmActionItemsFilter = openCount ? 'Open' : 'All';
      if (crmActionItemsFilter === 'Open' && !openCount) crmActionItemsFilter = 'All';
      const visible = crmActionItemsFilter === 'All' ? actions : actions.filter(item => crmActionItemsFilter === 'Open' ? crmIsOpenActionStatus(item.status) : item.status === 'Completed');
      const rows = visible.map(item => {
        const meetingTitle = crmIntelText(item.record?.meetingTitle, 'Untitled meeting');
        const meetingDate = crmIntelShortDate(item.record);
        const encodedKey = encodeURIComponent(item.key);
        const completedClass = item.status === 'Completed' ? ' completed' : '';
        return `<tr class="action-item-table-row" tabindex="0" role="button" data-record-index="${item.recordIndex}" data-action-key="${encodedKey}" onclick="crmOpenActionItem(Number(this.dataset.recordIndex), decodeURIComponent(this.dataset.actionKey))" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}"><td data-label="Action">${crmEscape(item.action)}</td><td data-label="Owner">${crmEscape(item.owner)}</td><td data-label="Due date">${crmEscape(item.dueDate)}</td><td data-label="Linked meeting"><span class="action-linked-meeting"><strong>${crmEscape(meetingTitle)}</strong><small>${crmEscape(meetingDate)}</small></span></td><td data-label="Status"><span class="followup-status${completedClass}">${crmEscape(item.status)}</span></td></tr>`;
      }).join('');
      const table = rows ? `<div class="action-items-table-wrap"><table class="followup-table action-items-table"><thead><tr><th style="width:40%">Action</th><th style="width:15%">Owner</th><th style="width:14%">Due date</th><th style="width:21%">Linked meeting</th><th style="width:10%">Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="contact-empty-state">No action items match this filter.</div>';
      return `<section class="action-items-view"><div class="action-items-header"><div><h3>Action Items</h3><p>Follow-ups recorded across this contact’s MRANTI relationship.</p></div><div class="action-items-counts"><span>${openCount} open</span><span>${completedCount} completed</span><span>${actions.length} total</span></div></div><div class="action-items-filters" role="group" aria-label="Filter action items"><button aria-pressed="${crmActionItemsFilter === 'All'}" class="${crmActionItemsFilter === 'All' ? 'active' : ''}" onclick="crmSetActionItemsFilter('All')" type="button">All</button><button aria-pressed="${crmActionItemsFilter === 'Open'}" class="${crmActionItemsFilter === 'Open' ? 'active' : ''}" onclick="crmSetActionItemsFilter('Open')" type="button">Open</button><button aria-pressed="${crmActionItemsFilter === 'Completed'}" class="${crmActionItemsFilter === 'Completed' ? 'active' : ''}" onclick="crmSetActionItemsFilter('Completed')" type="button">Completed</button></div>${table}</section>`;
    }

    function crmHistoryMarkup(group) {
      if (!group.records.length) return '<div class="contact-empty-state">No meetings recorded for this contact.</div>';
      if (!group.records.some(entry => entry.index === crmSelectedMeetingIndex)) crmSelectedMeetingIndex = group.latestIndex;
      const timeline = group.records.map(entry => {
        const record = entry.record;
        const selected = entry.index === crmSelectedMeetingIndex;
        const docs = Array.isArray(record.meetingDocuments) ? record.meetingDocuments.length : 0;
        const actions = crmIntelActionLines(record).length;
        return `<button class="timeline-item ${selected ? 'active' : ''}" type="button" data-record-index="${entry.index}" onclick="crmSelectContactMeeting(${entry.index})"><div class="timeline-title">${crmEscape(crmIntelText(record.meetingTitle, 'Untitled meeting'))}</div><div class="timeline-meta"><span>${crmEscape(crmIntelShortDate(record))}</span><span>${crmEscape(crmIntelTimeRange(record))}</span><span>${crmEscape(crmIntelText(record.uploaderName || record.uploaderEmail, 'MRANTI staff not recorded'))}</span></div><div class="timeline-context">${crmEscape(crmIntelText(record.reason || record.meetingNotes, 'No context recorded'))}</div><div class="timeline-badges"><span class="timeline-badge">${actions} action${actions === 1 ? '' : 's'}</span><span class="timeline-badge">${docs} document${docs === 1 ? '' : 's'}</span><span class="timeline-badge">${crmEscape(crmIntelText(record.recordSource || record.source || record.inputMethod, 'Source not recorded'))}</span></div></button>`;
      }).join('');
      return `<div class="contact-split-view"><section class="contact-split-pane"><div class="contact-split-pane-head"><span>Relationship timeline</span><span>${group.records.length} meeting${group.records.length === 1 ? '' : 's'}</span></div><div class="relationship-timeline">${timeline}</div></section><section class="contact-split-pane meeting-detail-pane">${crmMeetingDetailMarkup(crmRecords[crmSelectedMeetingIndex])}</section></div>`;
    }

    function crmMeetingDetailMarkup(record) {
      if (!record) return '<div class="contact-empty-state">Select a meeting to review its details.</div>';
      const index = crmRecords.indexOf(record);
      const actions = crmIntelActionEntries(record, index);
      const documents = crmIntelDocumentsForRecord(record, index);
      const attendees = crmIntelText(record.attendees, 'No attendees recorded.');
      const staff = crmIntelText(record.uploaderName || record.updatedBy || record.uploaderEmail, 'MRANTI staff not recorded');
      const source = crmIntelText(record.recordSource || record.source || record.inputMethod, 'Source not recorded');
      const location = crmIntelText(record.location || record.meetingLocation, 'Location not recorded');
      const purpose = crmIntelText(record.reason || record.purpose, 'No purpose recorded.');
      const notes = crmIntelText(record.meetingNotes, 'No meeting notes recorded.');
      const documentMarkup = documents.length ? documents.map(doc => {
        const url = crmSafeDocumentUrl(doc.url || doc.webViewLink || doc.downloadUrl || doc.fileUrl || doc.link);
        const name = crmEscape(crmIntelText(doc.name, 'Meeting document'));
        return url ? `<a class="detail-doc-link" href="${crmEscape(url)}" target="_blank" rel="noopener noreferrer"><span>${name}</span><span>Open</span></a>` : `<div class="detail-doc-link"><span>${name}</span><span>File link unavailable</span></div>`;
      }).join('') : '<div class="detail-section-value">No linked documents.</div>';
      const actionMarkup = actions.length ? `<div class="meeting-action-list">${actions.map((item, itemIndex) => `<div class="meeting-action-row ${item.key === crmHistoryHighlightAction ? 'highlighted' : ''}" data-action-key="${encodeURIComponent(item.key)}"><span>${itemIndex + 1}</span><div><strong>${crmEscape(item.action)}</strong><small>${crmEscape(item.owner)} · ${crmEscape(item.dueDate)} · ${crmEscape(item.status)}</small></div></div>`).join('')}</div>` : '<div class="detail-section-value">No action items recorded.</div>';
      const backMarkup = crmHistoryBackTab === 'actions' ? '<button class="contact-link-button back-to-overview" onclick="crmBackToActionItems()" type="button">← Back to Action Items</button>' : crmHistoryBackToOverview ? '<button class="contact-link-button back-to-overview" onclick="crmSwitchContactTab(\'overview\')" type="button">← Back to Overview</button>' : '';
      return `<div class="meeting-detail-scroll">
        ${backMarkup}
        <div class="meeting-detail-title">${crmEscape(crmIntelText(record.meetingTitle, 'Untitled meeting'))}</div>
        <div class="meeting-detail-meta"><span>${crmEscape(crmIntelFullDate(record))}</span><span>${crmEscape(crmIntelTimeRange(record))}</span><span>${crmEscape(source)}</span></div>
        <div class="detail-section"><div class="detail-grid"><div class="detail-mini-card"><div class="detail-section-label">Purpose</div><div class="detail-section-value">${crmEscape(purpose)}</div></div><div class="detail-mini-card"><div class="detail-section-label">Location</div><div class="detail-section-value">${crmEscape(location)}</div></div><div class="detail-mini-card"><div class="detail-section-label">Attendees</div><div class="detail-section-value">${crmEscape(attendees)}</div></div><div class="detail-mini-card"><div class="detail-section-label">MRANTI staff involved</div><div class="detail-section-value">${crmEscape(staff)}</div></div></div></div>
        <div class="detail-section" id="crmMeetingNotesFocus"><div class="detail-section-label">Meeting notes</div><div class="detail-section-value">${crmEscape(notes)}</div></div>
        <div class="detail-section"><div class="detail-section-label">Decisions or outcomes</div><div class="detail-section-value">${crmEscape(crmIntelText(record.decisions || record.outcomes, 'No separate decisions recorded.'))}</div></div>
        <div class="detail-section" id="crmMeetingActionsFocus"><div class="detail-section-label">Action items</div>${actionMarkup}</div>
        <div class="detail-section"><div class="detail-section-label">Linked documents</div><div class="detail-doc-list">${documentMarkup}</div></div>
        <div class="detail-section"><div class="detail-section-label">Record ownership</div><div class="detail-section-value">Uploaded by ${crmEscape(crmIntelText(record.uploaderName || record.uploaderEmail, 'Not recorded'))}. ${crmIsOwned(record) ? 'You may manage this record.' : 'Only the uploader may modify it.'}</div></div>
      </div>`;
    }

    function crmDocumentType(document) {
      const explicit = crmIntelText(document.type || document.mimeType || document.fileType);
      if (explicit) return explicit;
      const name = String(document.name || '');
      const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
      return extension || 'Document';
    }

    function crmSafeDocumentUrl(value) {
      const url = String(value || '').trim();
      return /^https?:\/\//i.test(url) ? url : '';
    }

    function crmDocumentsMarkup(group) {
      const latestIndex = group.latestIndex;
      const documents = group.documents.slice().sort((a, b) => {
        if (crmLatestDocumentFilter) {
          const aLatest = a._recordIndex === latestIndex ? 1 : 0;
          const bLatest = b._recordIndex === latestIndex ? 1 : 0;
          if (aLatest !== bLatest) return bLatest - aLatest;
        }
        return (b._recordIndex === latestIndex ? 1 : 0) - (a._recordIndex === latestIndex ? 1 : 0);
      });
      const rows = documents.map(document => {
        const url = crmSafeDocumentUrl(document.url || document.webViewLink || document.downloadUrl || document.fileUrl || document.link || document.driveUrl);
        const latestClass = document._recordIndex === latestIndex ? ' latest-interaction' : '';
        const latestLabel = document._recordIndex === latestIndex ? '<span class="document-latest-label">Related to latest interaction</span>' : '';
        const metadata = `<span>${crmEscape(crmDocumentType(document))}</span><span>${crmEscape(document._meetingTitle)}</span><span>${crmEscape(document._dateAdded)}</span><span>${crmEscape(document._source)}</span>`;
        const body = `<span class="document-library-copy"><strong>${crmEscape(crmIntelText(document.name, 'Meeting document'))}</strong><span class="document-library-meta">${metadata}</span>${latestLabel}</span><span class="document-library-action">${url ? 'Open ↗' : 'File link unavailable'}</span>`;
        return url ? `<a class="document-library-item${latestClass}" href="${crmEscape(url)}" target="_blank" rel="noopener noreferrer">${body}</a>` : `<div class="document-library-item unavailable${latestClass}" aria-disabled="true">${body}</div>`;
      }).join('');
      const priorityNote = crmLatestDocumentFilter && documents.length ? '<div class="document-library-note">Documents related to the latest interaction are listed first.</div>' : '';
      return `<section class="document-library"><div class="document-library-header"><div><h3>Documents</h3><p>Files connected to this contact’s MRANTI relationship.</p></div><span>${documents.length} file${documents.length === 1 ? '' : 's'}</span></div>${priorityNote}<div class="document-library-list">${rows || '<div class="contact-empty-state">No documents linked to this contact.</div>'}</div></section>`;
    }

    function crmInfoField(label, value, full = false) {
      return `<div class="record-info-field ${full ? 'full' : ''}"><label>${crmEscape(label)}</label><div>${crmEscape(crmIntelText(value, 'Not recorded'))}</div></div>`;
    }

    function crmRecordInfoMarkup(group) {
      const record = crmCurrentMeetingRecord() || group.latest;
      const signedInName = crmIntelText(currentUser?.displayName || currentUser?.email, 'Signed-in user');
      const signedInEmail = crmIntelText(currentUser?.email, 'Not recorded');
      const owned = crmIsOwned(record) && Boolean(record?.recordId);
      const permission = owned ? 'Uploader access — this user may edit and archive the selected record.' : 'View only — only the uploader may modify the selected record.';
      return `<div class="record-info-groups">
        <section class="record-info-group"><h3>Contact Information</h3><div class="record-info-grid">${crmInfoField('Name', group.name)}${crmInfoField('Organisation', group.company)}${crmInfoField('Email', group.email)}${crmInfoField('Phone', group.phone)}${crmInfoField('Job title', group.jobTitle)}${crmInfoField('Department', group.department)}${crmInfoField('Location', group.location, true)}</div></section>
        <section class="record-info-group"><h3>Record Ownership and Permissions</h3><div class="record-info-grid">${crmInfoField('Uploader', record.uploaderName || record.uploaderEmail)}${crmInfoField('Uploader email', record.uploaderEmail)}${crmInfoField('Current signed-in user', signedInName)}${crmInfoField('Signed-in email', signedInEmail)}${crmInfoField('Permission status', permission, true)}${crmInfoField('May edit', owned ? 'Yes' : 'No')}${crmInfoField('May archive', owned ? 'Yes' : 'No')}</div></section>
      </div>`;
    }

    function crmClearDetail() {
      const avatar = document.getElementById('crmContactAvatar');
      if (avatar) avatar.textContent = '—';
      if (document.getElementById('crmContactName')) document.getElementById('crmContactName').textContent = 'Select a contact';
      if (document.getElementById('crmContactOrganisation')) document.getElementById('crmContactOrganisation').textContent = '';
      if (document.getElementById('crmContactRole')) document.getElementById('crmContactRole').textContent = '';
      if (document.getElementById('crmContactMeta')) document.getElementById('crmContactMeta').innerHTML = '';
      if (document.getElementById('crmContactMeetingCount')) document.getElementById('crmContactMeetingCount').textContent = '0 meetings';
      if (document.getElementById('crmContactLastEngaged')) document.getElementById('crmContactLastEngaged').textContent = 'Last engaged —';
      if (document.getElementById('crmWorkspaceContent')) document.getElementById('crmWorkspaceContent').innerHTML = '<div class="contact-empty-state">Select a contact to review relationship intelligence.</div>';
    }

    function crmRenderDetail() {
      const record = crmRecords[crmSelectedIndex];
      if (!record) return crmClearDetail();
      const group = crmContactGroups.find(item => item.key === crmIntelContactKey(record));
      if (!group) return crmClearDetail();
      crmSelectedContactKey = group.key;
      if (!Number.isInteger(crmSelectedMeetingIndex) || !crmRecords[crmSelectedMeetingIndex]) crmSelectedMeetingIndex = crmSelectedIndex;
      crmRenderContactDirectory();
      crmRenderContactIdentity();
      crmRenderContactTabs();
      crmRenderContactWorkspace();
    }

    function crmManageSelectedOwnRecord() {
      const record = crmCurrentMeetingRecord();
      if (!record || !crmIsOwned(record)) return;
      const index = crmRecords.indexOf(record);
      mySelectedIndex = index;
      systemNavigate('my-records');
      setTimeout(() => myFilterRecords(), 50);
    }

    function crmContactMutateSelectedStatus() {
      const record = crmCurrentMeetingRecord();
      if (!record || !crmIsOwned(record) || !record.recordId) return;
      mySelectedIndex = crmRecords.indexOf(record);
      const action = crmNormalize(crmStatus(record)).includes('archive') ? 'restore' : 'archive';
      myMutateStatus(action);
    }

    function crmApplyPendingRecordSelection() {
      if (systemRouteFromHash() !== 'contacts') return false;
      const recordKey = systemRecordKeyFromHash() || crmPendingRecordKey;
      if (!recordKey) return false;
      const index = crmFindRecordIndexByRouteKey(recordKey);
      const search = document.getElementById('crmContactsSearch');
      if (search) search.value = '';
      crmResetAdditionalFilters(false);
      if (index < 0) {
        crmPendingRecordKey = '';
        crmSelectedContactKey = '';
        crmSelectedMeetingIndex = -1;
        crmSelectedIndex = -1;
        crmFilterRecords({ allowAutoSelect: false });
        crmSetBanner('The selected meeting record could not be found.', 'info');
        return false;
      }
      crmBuildContactGroups();
      const record = crmRecords[index];
      const key = crmIntelContactKey(record);
      crmSelectedContactKey = key;
      crmSelectedMeetingIndex = index;
      crmSelectedIndex = index;
      crmActiveContactTab = 'history';
      crmHistoryBackToOverview = false;
      crmHistoryBackTab = '';
      crmHistoryFocusSection = '';
      crmHistoryHighlightAction = '';
      crmContactRenderLimit = Math.max(crmContactRenderLimit, crmContactGroups.length);
      crmPendingRecordKey = '';
      crmFilterRecords({ allowAutoSelect: false });
      if (crmUsesMobileMasterDetail()) crmOpenMobileContactDetail(false);
      requestAnimationFrame(() => {
        if (!crmUsesMobileMasterDetail()) document.querySelector(`#crmContactsList [data-contact-key="${CSS.escape(encodeURIComponent(key))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.querySelector(`.timeline-item[data-record-index="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return true;
    }

    document.addEventListener('click', event => {
      if (!event.target.closest('.contact-intel-filter-anchor')) {
        const panelOpen = document.getElementById('crmContactFilterPanel')?.classList.contains('show');
        if (crmUsesMobileMasterDetail() && panelOpen) {
          crmCancelContactFilters(event);
        } else {
          crmSetContactFilterPanelOpen(false);
        }
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('crmContactFilterPanel')?.classList.contains('show')) {
        if (crmUsesMobileMasterDetail()) {
          crmCancelContactFilters(event);
        } else {
          crmSetContactFilterPanelOpen(false, { restoreFocus: true });
        }
      }
    });


    // If a user returns to the base URL after signing in, respect their saved default page.
    function systemApplyDefaultRouteOnFirstLoad(){if(window.location.hash)return;const prefs=systemGetPreferences();const target=SYSTEM_ROUTES[prefs.defaultPage]?prefs.defaultPage:'dashboard';history.replaceState(null,'','#'+target);}
    systemApplyDefaultRouteOnFirstLoad();
