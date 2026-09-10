// ── CALENDAR ──
    async function syncCalendar() {
      try {
        // If the user already granted Calendar permission during sign-in, reuse that token.
        // This prevents the repeated Google Calendar permission popup.
        if (googleAccessToken) {
          await loadCalendar({ force: true });
          return;
        }

        setCalendarStatus('Connecting to Google Calendar...');

        provider = buildGoogleProvider(true);
        const result = auth.currentUser
          ? await auth.currentUser.reauthenticateWithPopup(provider)
          : await auth.signInWithPopup(provider);

        const token = getAccessTokenFromResult(result);

        if (!token) {
          throw new Error('Google allowed Calendar access, but Firebase did not return the access token.');
        }

        googleAccessToken = token;
        saveAccessToken(token);
        console.log('Calendar access token received:', googleAccessToken ? 'YES' : 'NO');

        await loadCalendar({ force: true });

      } catch (e) {
        console.error('Calendar sync error:', e);
        if (e.code !== 'auth/popup-closed-by-user') {
          setCalendarStatus('⚠️ Calendar sync failed: ' + (e.message || e.code || 'Unknown error'));
        }
      }
    }

    async function loadCalendar(options = {}) {
      if (!googleAccessToken) {
        if (!restoreCalendarCache(calendarViewDate)) setCalendarStatus('Click Sync to load your meetings.');
        return;
      }
      await loadMonthEvents(calendarViewDate, options);
    }

    function updateCalendarSyncButton() {
      const label = document.getElementById('calendarSyncLabel');
      const button = document.getElementById('calendarSyncBtn');
      if (label) label.textContent = googleAccessToken ? 'Refresh Calendar' : 'Connect Calendar';
      if (button) button.setAttribute('aria-label', googleAccessToken ? 'Refresh Google Calendar' : 'Connect Google Calendar');
    }

    function setCalendarStatus(msg) {
      updateCalendarSyncButton();
      const el = document.getElementById('calendarStatus');
      if (!el) return;
      if (!msg) { el.style.display = 'none'; return; }
      el.textContent = msg;
      el.style.display = 'block';
    }

    // ── MONTH CALENDAR ──
    // A real navigable month view, same mental model as Google Calendar:
    // prev/next arrows, a Today button, click a day to see its meetings.
    // This also directly answers "how do I log a past meeting" - just
    // navigate back to that month and click the day, no separate UI needed.

    function getMonthKey(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function ymdKey(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function getWeekStart(date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay());
      return start;
    }

    function updateCalendarViewControls() {
      const weekButton = document.getElementById('calendarViewWeekBtn');
      const monthButton = document.getElementById('calendarViewMonthBtn');
      const previousButton = document.getElementById('calendarPreviousBtn');
      const nextButton = document.getElementById('calendarNextBtn');
      const calendarView = document.getElementById('dashboardCalendarView');
      if (weekButton) {
        const active = calendarViewMode === 'week';
        weekButton.classList.toggle('active', active);
        weekButton.setAttribute('aria-pressed', String(active));
      }
      if (monthButton) {
        const active = calendarViewMode === 'month';
        monthButton.classList.toggle('active', active);
        monthButton.setAttribute('aria-pressed', String(active));
      }
      if (previousButton) previousButton.setAttribute('aria-label', calendarViewMode === 'week' ? 'Previous week' : 'Previous month');
      if (nextButton) nextButton.setAttribute('aria-label', calendarViewMode === 'week' ? 'Next week' : 'Next month');
      if (calendarView) calendarView.classList.toggle('calendar-week-active', calendarViewMode === 'week');
    }

    function setCalendarView(mode, focusDate = null, sourceEvent = null) {
      sourceEvent?.preventDefault?.();
      sourceEvent?.stopPropagation?.();
      closeDayDetail();

      const nextMode = mode === 'week' ? 'week' : 'month';
      const hasExplicitDate = focusDate instanceof Date && !Number.isNaN(focusDate.getTime());
      let nextDate;

      if (hasExplicitDate) {
        nextDate = new Date(focusDate);
      } else if (nextMode === 'week') {
        // A normal Week-tab selection always opens the week containing today.
        // Explicit Dashboard week selections may still pass a focusDate.
        nextDate = new Date();
      } else {
        // Month view keeps the month currently represented by the calendar.
        nextDate = new Date(calendarViewDate);
      }

      calendarViewMode = nextMode;
      calendarViewDate = nextMode === 'month'
        ? new Date(nextDate.getFullYear(), nextDate.getMonth(), 1)
        : new Date(nextDate);
      selectedDateKey = null;
      updateCalendarViewControls();
      renderCalendarGrid();
      if (googleAccessToken) loadMonthEvents(calendarViewDate, { refreshIfStale: true });
      else if (restoreCalendarCache(calendarViewDate)) applyMonthEvents(monthCache[getMonthKey(calendarViewDate)]);
    }

    function dashboardDetailCalendarIcon() {
      return '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg>';
    }

    function dashboardDetailNetworkIcon() {
      return '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="16" y="16" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="9" y="2" width="6" height="6" rx="1"></rect><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path></svg>';
    }

    function dashboardCleanDisplayText(value, fallback = '') {
      let text = String(value || '');
      text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, '$1');
      text = text.replace(/<[^>]*>/g, ' ');
      const decoder = document.createElement('textarea');
      decoder.innerHTML = text;
      text = decoder.value;
      text = text.replace(/<[^>]*>/g, ' ');
      text = text.replace(/\b(?:href|target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ' ');
      text = text.replace(/(?:https?:\/\/|www\.)\S+/gi, ' ');
      text = text.replace(/\s+/g, ' ').trim();
      return text || fallback;
    }

    function dashboardSanitiseMeetingText(value, meetingTitle = '') {
      let text = dashboardCleanDisplayText(value, '');
      if (!text) return '';

      const systemStarts = [
        /\bto see detailed information for automatically created events\b/i,
        /\bthis event was created from an email\b/i,
        /\bthis event was created from gmail\b/i,
        /\bthis event was automatically created\b/i,
        /\bconfirmation (?:number|code)\b/i,
        /\bview this event in google calendar\b/i,
        /\bfor more information, visit google calendar\b/i
      ];
      for (const pattern of systemStarts) {
        const match = text.match(pattern);
        if (match?.index >= 0) text = text.slice(0, match.index);
      }

      text = text.replace(/\bref\s*:\s*.*$/i, ' ');
      text = text.replace(/\b(?:calendar event|google calendar)\s*(?:notice|notification)?\s*:?\s*$/i, ' ');
      text = text.replace(/\s+/g, ' ').replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '').trim();

      const normalTitle = crmNormalize(meetingTitle);
      if (normalTitle && crmNormalize(text) === normalTitle) return '';
      if (normalTitle && crmNormalize(text).startsWith(normalTitle + ' ')) {
        text = text.slice(meetingTitle.length).replace(/^[\s\-–—:;,.]+/, '').trim();
      }
      return text.length > 260 ? text.slice(0, 257).trimEnd() + '…' : text;
    }

    function dashboardRecordOrganisation(record) {
      return dashboardCleanDisplayText(
        record?.companyName || record?.organisation || record?.organization || record?.company || '',
        ''
      );
    }

    function dashboardExternalAttendees(event) {
      const ownEmail = String(currentUser?.email || '').trim().toLowerCase();
      return (Array.isArray(event?.attendees) ? event.attendees : []).filter(attendee => {
        const email = String(attendee?.email || '').trim().toLowerCase();
        return !attendee?.self && (!ownEmail || email !== ownEmail);
      });
    }

    function dashboardPrimaryExternalContact(event) {
      const attendee = dashboardExternalAttendees(event)[0];
      return dashboardCleanDisplayText(attendee?.displayName || attendee?.email || '', '');
    }

    function dashboardParsedExternalOrganisation(event) {
      const publicDomains = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','proton.me','protonmail.com']);
      const attendee = dashboardExternalAttendees(event).find(item => {
        const domain = String(item?.email || '').split('@')[1]?.toLowerCase() || '';
        return domain && domain !== 'mranti.my' && !publicDomains.has(domain);
      });
      const domain = String(attendee?.email || '').split('@')[1]?.toLowerCase() || '';
      if (!domain) return '';
      const root = domain.split('.')[0].replace(/[-_]+/g, ' ').trim();
      return root ? root.replace(/\b\w/g, char => char.toUpperCase()) : '';
    }

    function dashboardFindCalendarRecord(recordsForDate, event) {
      const records = Array.isArray(recordsForDate) ? recordsForDate : [];
      if (!records.length) return null;
      const titleKey = crmNormalize(event?.summary || '');
      const exactTitle = titleKey ? records.find(record => crmNormalize(record?.meetingTitle || '') === titleKey) : null;
      if (exactTitle) return exactTitle;

      const attendeeEmails = new Set(dashboardExternalAttendees(event).map(item => String(item?.email || '').trim().toLowerCase()).filter(Boolean));
      const exactEmail = attendeeEmails.size
        ? records.find(record => attendeeEmails.has(String(record?.email || '').trim().toLowerCase()))
        : null;
      if (exactEmail) return exactEmail;
      return records.length === 1 ? records[0] : null;
    }

    function dashboardApplyExpandedState() {
      const configs = [
        { mode: 'meetings', cardId: 'dashboardMeetingsCard', detailId: 'dashboardMeetingsDetails', toggleId: 'dashboardMeetingsToggle' },
        { mode: 'organisations', cardId: 'dashboardOrganisationsCard', detailId: 'dashboardOrganisationsDetails', toggleId: 'dashboardOrganisationsToggle' }
      ];
      configs.forEach(config => {
        const open = Boolean(dashboardExpandedCards[config.mode]);
        const card = document.getElementById(config.cardId);
        const detail = document.getElementById(config.detailId);
        const toggle = document.getElementById(config.toggleId);
        card?.classList.toggle('is-expanded', open);
        detail?.classList.toggle('open', open);
        detail?.setAttribute('aria-hidden', String(!open));
        if (toggle) {
          toggle.setAttribute('aria-expanded', String(open));
          toggle.innerHTML = open
            ? 'Hide details <span aria-hidden="true">↑</span>'
            : 'Show details <span aria-hidden="true">↓</span>';
        }
      });
      dashboardRenderDetailPanels();
    }

    function dashboardResetInlineMeetingCards() {
      dashboardExpandedMeetingCard = null;
    }

    function dashboardViewMeetings() {
      dashboardExpandedCards.meetings = !dashboardExpandedCards.meetings;
      if (!dashboardExpandedCards.meetings) dashboardResetInlineMeetingCards();
      dashboardApplyExpandedState();
    }

    function dashboardOpenMeetingWeek(index) {
      dashboardSelectedMeetingWeek = Math.min(4, Math.max(0, Number(index) || 0));
      dashboardResetInlineMeetingCards();
      dashboardExpandedCards.meetings = true;
      dashboardApplyExpandedState();
    }

    function dashboardSelectMeetingWeek(index) {
      dashboardSelectedMeetingWeek = Math.min(4, Math.max(0, Number(index) || 0));
      dashboardResetInlineMeetingCards();
      dashboardExpandedCards.meetings = true;
      const meetings = document.getElementById('dashboardMeetingsDetails');
      if (meetings) meetings.innerHTML = dashboardMeetingDetailMarkup();
    }

    function dashboardViewOrganisations() {
      dashboardExpandedCards.organisations = !dashboardExpandedCards.organisations;
      if (dashboardExpandedCards.organisations && !['new', 'returning'].includes(dashboardOrganisationFilter)) {
        dashboardOrganisationFilter = dashboardOrganisationTotals.fresh || !dashboardOrganisationTotals.returning ? 'new' : 'returning';
      }
      dashboardApplyExpandedState();
    }

    function dashboardSetOrganisationFilter(filter) {
      dashboardOrganisationFilter = filter === 'returning' ? 'returning' : 'new';
      const organisations = document.getElementById('dashboardOrganisationsDetails');
      if (organisations) organisations.innerHTML = dashboardOrganisationDetailMarkup();
    }

    function dashboardSetOrganisationSearch(value) {
      dashboardOrganisationSearch = String(value || '').trim().toLowerCase();
      const list = document.querySelector('#dashboardOrganisationsDetails .dashboard-org-list');
      if (list) list.innerHTML = dashboardOrganisationRowsMarkup();
    }

    function dashboardMeetingPresentation(item) {
      const title = dashboardCleanDisplayText(item?.title, 'Untitled meeting');
      const seen = new Set([crmNormalize(title)].filter(Boolean));
      const uniqueValue = (value, fallback = '') => {
        const clean = dashboardCleanDisplayText(value, fallback);
        const key = crmNormalize(clean);
        if (!clean || (key && seen.has(key))) return '';
        if (key) seen.add(key);
        return clean;
      };
      const organisation = uniqueValue(item?.organisation, 'Organisation not recorded');
      const contact = uniqueValue(item?.contact, 'External contact not recorded');
      const location = uniqueValue(item?.location, '');
      let purpose = dashboardSanitiseMeetingText(item?.purpose, title);
      const purposeKey = crmNormalize(purpose);
      if (purposeKey && seen.has(purposeKey)) purpose = '';
      return { title, organisation, contact, location, purpose };
    }

    function dashboardMeetingInlineDate(item, event) {
      const startRaw = event?.start?.dateTime || event?.start?.date || '';
      if (startRaw) {
        const startDate = event?.start?.dateTime ? new Date(startRaw) : new Date(startRaw + 'T00:00:00');
        if (!Number.isNaN(startDate.getTime())) {
          return startDate.toLocaleDateString('en-MY', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            ...(event?.start?.dateTime ? { timeZone: 'Asia/Kuala_Lumpur' } : {})
          });
        }
      }
      const sortDate = new Date(Number(item?.sortTime || 0));
      if (!Number.isNaN(sortDate.getTime()) && sortDate.getTime() > 0) {
        return sortDate.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
      return dashboardCleanDisplayText(item?.dateLabel, 'Date not recorded');
    }

    function dashboardMeetingInlineTime(item, event) {
      if (event?.start?.date && !event?.start?.dateTime) return 'All day';
      if (event?.start?.dateTime) {
        const startDate = new Date(event.start.dateTime);
        const endDate = event?.end?.dateTime ? new Date(event.end.dateTime) : null;
        if (!Number.isNaN(startDate.getTime())) {
          const startLabel = formatKLTime(startDate);
          if (endDate && !Number.isNaN(endDate.getTime())) return `${startLabel}–${formatKLTime(endDate)}`;
          return startLabel;
        }
      }
      return dashboardCleanDisplayText(item?.timeLabel, 'Time not recorded');
    }

    function dashboardMeetingInlineData(item) {
      const event = item?.eventKey ? window._eventsCache[item.eventKey] : null;
      const title = dashboardCleanDisplayText(event?.summary, '') || dashboardCleanDisplayText(item?.title, 'Untitled meeting');
      const contactValue = dashboardCleanDisplayText(item?.contact, '');
      return {
        title,
        date: dashboardMeetingInlineDate(item, event),
        time: dashboardMeetingInlineTime(item, event),
        organisation: dashboardCleanDisplayText(item?.organisation, 'Organisation not recorded'),
        contact: !contactValue || /^external contact not recorded$/i.test(contactValue) ? 'Contact not recorded' : contactValue,
        location: dashboardCleanDisplayText(item?.location, 'Location not recorded'),
        attendeeCount: Number(item?.attendeeCount || 0)
      };
    }

    function dashboardMeetingInlineField(label, value, modifier = '') {
      return `<div class="meeting-inline-field${modifier ? ` ${modifier}` : ''}"><small>${crmEscape(label)}</small><strong>${crmEscape(value)}</strong></div>`;
    }

    function dashboardMeetingColumnForIndex(itemIndex) {
      return Number(itemIndex) % 2 === 0 ? 'left' : 'right';
    }

    function dashboardRefreshInlineMeetingCards(focusIndex = null) {
      const meetings = document.getElementById('dashboardMeetingsDetails');
      if (!meetings || !dashboardExpandedCards.meetings) return;
      meetings.innerHTML = dashboardMeetingDetailMarkup();
      if (focusIndex !== null) {
        requestAnimationFrame(() => {
          const target = meetings.querySelector(`[data-item-index="${focusIndex}"]`);
          if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
        });
      }
    }

    function dashboardToggleInlineMeetingCard(card) {
      const itemIndex = Number(card?.dataset?.itemIndex);
      if (!Number.isInteger(itemIndex)) return;
      const alreadyOpen = dashboardExpandedMeetingCard === itemIndex;
      dashboardExpandedMeetingCard = alreadyOpen ? null : itemIndex;
      dashboardRefreshInlineMeetingCards(itemIndex);
    }

    function dashboardCloseInlineMeetingCard(event) {
      event?.stopPropagation();
      const closedIndex = dashboardExpandedMeetingCard;
      dashboardExpandedMeetingCard = null;
      dashboardRefreshInlineMeetingCards(closedIndex);
    }

    function dashboardMeetingCardKeydown(event, card) {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dashboardToggleInlineMeetingCard(card);
      }
    }

    function dashboardCloseAllInlineMeetingCards() {
      if (dashboardExpandedMeetingCard === null) return;
      const closedIndex = dashboardExpandedMeetingCard;
      dashboardExpandedMeetingCard = null;
      dashboardRefreshInlineMeetingCards(closedIndex);
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') dashboardCloseAllInlineMeetingCards();
    });

    function dashboardShowNotice(message) {
      let notice = document.getElementById('dashboardInlineNotice');
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'dashboardInlineNotice';
        notice.className = 'dashboard-inline-notice';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
        document.body.appendChild(notice);
      }
      notice.textContent = message;
      notice.classList.add('show');
      clearTimeout(dashboardShowNotice._timer);
      dashboardShowNotice._timer = setTimeout(() => notice.classList.remove('show'), 3600);
    }

    function dashboardOrganisationRecordName(record) {
      return record?.companyName || record?.organisation || record?.organization || record?.company || '';
    }

    function dashboardRecordDateScore(record) {
      return Date.parse(record?.meetingDate || record?.lastUpdated || '') || 0;
    }

    async function dashboardOpenOrganisationRow(button) {
      const organisationName = dashboardCleanDisplayText(button?.dataset?.organisation || '', '');
      const preferredRecordId = button?.dataset?.recordId || '';
      const organisationKey = crmNormalize(organisationName);
      if (!organisationKey) {
        dashboardShowNotice('No CORE meeting record was found for this organisation.');
        return;
      }

      if (!crmContactsLoaded && !crmContactsLoading) await crmLoadContacts(false);
      if (crmContactsLoading) {
        await new Promise(resolve => setTimeout(resolve, 180));
      }

      const matchingIndices = crmRecords
        .map((record, index) => ({ record, index }))
        .filter(entry => crmNormalize(dashboardOrganisationRecordName(entry.record)) === organisationKey)
        .sort((a, b) => {
          if (preferredRecordId && a.record?.recordId === preferredRecordId) return -1;
          if (preferredRecordId && b.record?.recordId === preferredRecordId) return 1;
          return dashboardRecordDateScore(b.record) - dashboardRecordDateScore(a.record);
        });

      if (!matchingIndices.length) {
        dashboardShowNotice('No CORE meeting record was found for this organisation.');
        return;
      }

      const selectedIndex = matchingIndices[0].index;
      crmSelectedIndex = selectedIndex;
      systemNavigate('contacts');

      const focusExactRecord = () => {
        const search = document.getElementById('crmContactsSearch');
          if (!search || !status || !crmRecords[selectedIndex]) return false;
        search.value = organisationName;
        status.value = 'All';
        crmSelectedIndex = selectedIndex;
        crmFilterRecords();
        if (crmSelectedIndex !== selectedIndex) {
          crmSelectedIndex = selectedIndex;
          document.getElementById('crmContactsList').innerHTML = crmVisibleRecordIndices()
            .map(index => crmRecordCard(crmRecords[index], index, index === crmSelectedIndex, 'crmSelectRecord'))
            .join('');
          crmRenderDetail();
        }
        return true;
      };

      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (focusExactRecord() || attempts >= 20) clearInterval(timer);
      }, 60);
    }

    function dashboardWeekRangeLabel(index) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1 + index * 7);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), Math.min(monthEnd.getDate(), 7 + index * 7));
      const startLabel = start.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
      const endLabel = end.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
      return `${startLabel}–${endLabel}`;
    }

    function dashboardMeetingNormalCardMarkup(item, itemIndex, extraClasses = '') {
      const presentation = dashboardMeetingPresentation(item);
      const dateTime = [item.dateLabel, item.timeLabel].filter(Boolean).join(' · ');
      return `<article class="dashboard-detail-meeting meeting-inline-card is-normal${extraClasses ? ` ${extraClasses}` : ''}" role="button" tabindex="0" aria-expanded="false" data-week-index="${dashboardSelectedMeetingWeek}" data-item-index="${itemIndex}" style="--meeting-order:${itemIndex}" onclick="dashboardToggleInlineMeetingCard(this)" onkeydown="dashboardMeetingCardKeydown(event,this)">
        <span class="dashboard-detail-item-icon calendar">${dashboardDetailCalendarIcon()}</span>
        <span class="dashboard-detail-meeting-copy">
          <span class="dashboard-detail-meeting-title">${crmEscape(presentation.title)}</span>
          ${presentation.organisation ? `<span class="dashboard-detail-organisation">${crmEscape(presentation.organisation)}</span>` : ''}
          ${presentation.contact ? `<span class="dashboard-detail-contact">${crmEscape(presentation.contact)}</span>` : ''}
          <span class="dashboard-detail-date-line">${crmEscape(dateTime)}</span>
          ${presentation.location ? `<span class="dashboard-detail-location"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg><span>${crmEscape(presentation.location)}</span></span>` : ''}
          ${presentation.purpose ? `<span class="dashboard-detail-purpose">${crmEscape(presentation.purpose)}</span>` : ''}
          <span class="dashboard-detail-meeting-footer"><span>${item.attendeeCount} attendee${item.attendeeCount === 1 ? '' : 's'}</span></span>
        </span>
      </article>`;
    }

    function dashboardMeetingCompactCardMarkup(item, itemIndex) {
      const details = dashboardMeetingInlineData(item);
      const dateTime = [item.dateLabel, item.timeLabel].filter(Boolean).join(' · ');
      return `<article class="dashboard-detail-meeting meeting-inline-card is-compact" role="button" tabindex="0" aria-expanded="false" data-week-index="${dashboardSelectedMeetingWeek}" data-item-index="${itemIndex}" style="--meeting-order:${itemIndex}" onclick="dashboardToggleInlineMeetingCard(this)" onkeydown="dashboardMeetingCardKeydown(event,this)">
        <span class="meeting-inline-compact-copy"><strong class="meeting-inline-compact-title">${crmEscape(details.title)}</strong><span class="meeting-inline-compact-meta">${crmEscape(dateTime || details.time)}</span></span>
        ${details.attendeeCount ? `<span class="meeting-inline-compact-attendees">${details.attendeeCount}</span>` : ''}
      </article>`;
    }

    function dashboardMeetingExpandedCardMarkup(item, itemIndex) {
      const details = dashboardMeetingInlineData(item);
      return `<article class="dashboard-detail-meeting meeting-inline-card is-expanded" role="button" tabindex="0" aria-expanded="true" data-week-index="${dashboardSelectedMeetingWeek}" data-item-index="${itemIndex}" style="--meeting-order:${itemIndex}" onclick="dashboardToggleInlineMeetingCard(this)" onkeydown="dashboardMeetingCardKeydown(event,this)">
        <div class="meeting-inline-expanded-head">
          <span class="meeting-inline-expanded-heading"><strong class="meeting-inline-expanded-title">${crmEscape(details.title)}</strong><span class="meeting-inline-expanded-date">${crmEscape(details.date)}</span><span class="meeting-inline-expanded-time">${crmEscape(details.time)}</span></span>
          <button aria-label="Close meeting details" class="meeting-inline-close" type="button" onclick="dashboardCloseInlineMeetingCard(event)">×</button>
        </div>
        <div class="meeting-inline-expanded-body">
          ${dashboardMeetingInlineField('Organisation', details.organisation, 'organisation')}
          ${dashboardMeetingInlineField('Contact', details.contact, 'contact')}
          ${dashboardMeetingInlineField('Location', details.location, 'location')}
          ${dashboardMeetingInlineField('Attendees', `${details.attendeeCount} attendee${details.attendeeCount === 1 ? '' : 's'}`, 'attendees')}
        </div>
      </article>`;
    }

    function dashboardMeetingDetailMarkup() {
      const selected = dashboardMeetingWeeks[dashboardSelectedMeetingWeek] || [];
      const selector = dashboardMeetingWeeks.map((items, index) => `
        <button class="dashboard-week-button${index === dashboardSelectedMeetingWeek ? ' active' : ''}" type="button" onclick="dashboardSelectMeetingWeek(${index})" aria-pressed="${index === dashboardSelectedMeetingWeek}">
          <span class="dashboard-week-name">W${index + 1}</span>
          <span class="dashboard-week-range">${dashboardWeekRangeLabel(index)}</span>
          <span class="dashboard-week-count">${items.length}</span>
        </button>`).join('');

      const preview = selected.slice(0, 4);
      const validIndices = new Set(preview.map((_, index) => index));
      if (!validIndices.has(dashboardExpandedMeetingCard)) dashboardExpandedMeetingCard = null;

      const selectedIndex = dashboardExpandedMeetingCard;
      const anyExpanded = selectedIndex !== null;
      const selectedColumn = anyExpanded ? dashboardMeetingColumnForIndex(selectedIndex) : null;

      const columns = ['left', 'right'].map((column, parity) => {
        const columnItems = preview.map((item, itemIndex) => ({ item, itemIndex })).filter(entry => entry.itemIndex % 2 === parity);
        const hasExpanded = anyExpanded && column === selectedColumn && columnItems.some(entry => entry.itemIndex === selectedIndex);
        const cards = columnItems.map(({ item, itemIndex }) => {
          const isExpanded = hasExpanded && selectedIndex === itemIndex;
          const compactForColumn = hasExpanded && !isExpanded;
          if (isExpanded) return dashboardMeetingExpandedCardMarkup(item, itemIndex);
          if (compactForColumn) return dashboardMeetingCompactCardMarkup(item, itemIndex);
          return dashboardMeetingNormalCardMarkup(item, itemIndex);
        }).join('');
        return `<div class="meeting-inline-column${hasExpanded ? ' has-expanded' : ''}" data-meeting-column="${column}">${cards}</div>`;
      }).join('');

      const list = preview.length
        ? `<div class="meeting-inline-grid${anyExpanded ? ' has-any-expanded' : ''}">${columns}</div>`
        : `<div class="meeting-inline-grid"><div class="meeting-inline-empty">No meetings are recorded for this week.</div></div>`;

      return `<div class="dashboard-inline-divider"></div><div class="dashboard-week-selector">${selector}</div><div class="meeting-preview-stage">${list}</div><div class="dashboard-detail-action-row"><button class="dashboard-detail-action" type="button" onclick="systemNavigate('contacts')">View all meetings →</button></div>`;
    }

    function dashboardOrganisationRowsMarkup() {
      const activeFilter = dashboardOrganisationFilter === 'returning' ? 'returning' : 'new';
      const query = dashboardOrganisationSearch;
      const filtered = dashboardOrganisationRows.filter(item => {
        if (item.status !== activeFilter) return false;
        if (!query) return true;
        return CoreSearch.tokenPrefixMatch(query, `${item.name || ''} ${item.latestMeetingTitle || ''} ${item.latestLabel || ''}`);
      });
      if (!filtered.length) {
        const message = query
          ? `No ${activeFilter} organisations match your search.`
          : `No ${activeFilter} organisations are recorded for this month.`;
        return `<div class="dashboard-detail-empty">${crmEscape(message)}</div>`;
      }
      return filtered.map(item => `<button class="dashboard-org-row" type="button" data-record-id="${crmEscape(item.recordId || '')}" data-organisation="${crmEscape(item.name || '')}" onclick="dashboardOpenOrganisationRow(this)">
        <span class="dashboard-detail-item-icon network">${dashboardDetailNetworkIcon()}</span>
        <span class="dashboard-org-record">
          <span class="dashboard-org-card-head"><strong>${crmEscape(dashboardCleanDisplayText(item.name, 'Organisation not recorded'))}</strong><span class="dashboard-org-date">${crmEscape(item.latestLabel)}</span></span>
          <small>${crmEscape(dashboardCleanDisplayText(item.latestMeetingTitle, 'Latest meeting title not recorded'))}</small>
        </span>
        <span class="dashboard-org-badge ${item.status === 'returning' ? 'returning' : 'new'}">${item.status === 'returning' ? 'Returning' : 'New'}</span>
      </button>`).join('');
    }

    function dashboardOrganisationDetailMarkup() {
      const activeFilter = dashboardOrganisationFilter === 'returning' ? 'returning' : 'new';
      return `<div class="dashboard-inline-divider"></div>
        <div class="dashboard-org-tools">
          <div class="dashboard-org-filters" role="group" aria-label="Filter organisations">
            <button class="dashboard-org-filter${activeFilter === 'new' ? ' active' : ''}" type="button" onclick="dashboardSetOrganisationFilter('new')"><span>New</span><b>${dashboardOrganisationTotals.fresh}</b></button>
            <button class="dashboard-org-filter${activeFilter === 'returning' ? ' active' : ''}" type="button" onclick="dashboardSetOrganisationFilter('returning')"><span>Returning</span><b>${dashboardOrganisationTotals.returning}</b></button>
          </div>
          <input class="dashboard-org-search" type="search" value="${crmEscape(dashboardOrganisationSearch)}" oninput="dashboardSetOrganisationSearch(this.value)" placeholder="Search organisations or latest meetings..." aria-label="Search organisations" />
        </div>
        <div class="dashboard-org-list" id="dashboardOrganisationDetailList">${dashboardOrganisationRowsMarkup()}</div>
        <div class="dashboard-org-footer"><div class="dashboard-org-help"><strong>New:</strong> first recorded CORE engagement occurred during the selected month.<br><strong>Returning:</strong> at least one CORE engagement existed before the selected month.</div><button class="dashboard-detail-action" type="button" onclick="systemNavigate('contacts')">View all organisations →</button></div>`;
    }

    function dashboardRenderDetailPanels() {
      const meetings = document.getElementById('dashboardMeetingsDetails');
      const organisations = document.getElementById('dashboardOrganisationsDetails');
      if (dashboardExpandedCards.meetings && meetings) meetings.innerHTML = dashboardMeetingDetailMarkup();
      if (dashboardExpandedCards.organisations && organisations) organisations.innerHTML = dashboardOrganisationDetailMarkup();
    }

    // The grid always shows 6 full weeks (42 cells) so the layout never
    // reflows in height between months, same as Google Calendar's month view.
    function getGridRange(viewDate) {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstOfMonth = new Date(year, month, 1);
      const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
      const gridEnd = new Date(gridStart);
      gridEnd.setDate(gridStart.getDate() + 42);
      return { gridStart, gridEnd };
    }

    // All-day events already carry a plain Y-M-D date. Timed events carry an
    // instant (dateTime) that has to be converted to a calendar day using
    // MRANTI's local timezone, matching how dates are displayed everywhere
    // else in this app - otherwise an event at 11pm could land on the wrong
    // day's cell for someone viewing from a different timezone.
    function getEventDateKey(ev) {
      if (ev.start?.date) return ev.start.date;
      const dt = ev.start?.dateTime;
      if (!dt) return null;
      const d = new Date(dt);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(d);
      const y = parts.find(p => p.type === 'year').value;
      const m = parts.find(p => p.type === 'month').value;
      const day = parts.find(p => p.type === 'day').value;
      return `${y}-${m}-${day}`;
    }

    function calendarCacheStorageKey(viewDate) {
      const userKey = String(currentUser?.uid || currentUser?.email || 'anonymous').replace(/[^a-z0-9_-]/gi, '_');
      return `${CALENDAR_CACHE_KEY_PREFIX}:${userKey}:${getMonthKey(viewDate)}`;
    }

    function restoreCalendarCache(viewDate) {
      const monthKey = getMonthKey(viewDate);
      if (Array.isArray(monthCache[monthKey])) return true;
      try {
        const cached = JSON.parse(localStorage.getItem(calendarCacheStorageKey(viewDate)) || 'null');
        if (!cached || !Array.isArray(cached.events) || !Number(cached.fetchedAt)) return false;
        if (Date.now() - Number(cached.fetchedAt) > CALENDAR_CACHE_MAX_STALE_MS) {
          localStorage.removeItem(calendarCacheStorageKey(viewDate));
          return false;
        }
        monthCache[monthKey] = cached.events;
        monthCacheTimestamps[monthKey] = Number(cached.fetchedAt);
        applyMonthEvents(cached.events);
        return true;
      } catch (error) {
        return false;
      }
    }

    function persistCalendarCache(viewDate, events, fetchedAt = Date.now()) {
      const monthKey = getMonthKey(viewDate);
      monthCache[monthKey] = events;
      monthCacheTimestamps[monthKey] = fetchedAt;
      try {
        localStorage.setItem(calendarCacheStorageKey(viewDate), JSON.stringify({ fetchedAt, events }));
      } catch (error) {
        // Storage limits or privacy settings should not prevent Calendar use.
      }
    }

    const calendarEnrichmentAttemptKeys = new Set();

    function calendarArtifactUrl(attachment) {
      return String(attachment?.fileUrl || attachment?.url || '').trim();
    }

    function calendarLateArtifacts(event) {
      return normalizeCalendarAttachments(event?.attachments || []).filter(attachment => {
        const text = `${attachment.name || ''} ${attachment.mimeType || ''}`.toLowerCase();
        return /gemini|meeting notes?|transcript|recording|video\//i.test(text);
      });
    }

    function calendarRecordDateKey(record) {
      const raw = record?.meetingDate || record?.startDateTime || record?.startTime || '';
      const score = globalThis.CoreSearch?.validDateScore ? CoreSearch.validDateScore(raw) : Date.parse(raw);
      if (!score) return '';
      return getEventDateKey({ start: { dateTime: new Date(score).toISOString() } }) || '';
    }

    function calendarRecordMatchesEvent(record, event) {
      if (!record?.recordId || crmNormalize(crmStatus(record)) === 'archived') return false;
      const owner = String(record?.uploaderEmail || '').trim().toLowerCase();
      const signedIn = String(currentUser?.email || '').trim().toLowerCase();
      if (!owner || owner !== signedIn) return false;
      if (CoreSearch.normalize(record?.meetingTitle || '') !== CoreSearch.normalize(event?.summary || '')) return false;
      return calendarRecordDateKey(record) === getEventDateKey(event);
    }

    function calendarExistingDocumentUrls(record) {
      return new Set((Array.isArray(record?.meetingDocuments) ? record.meetingDocuments : [])
        .map(document => String(document?.url || '').trim())
        .filter(Boolean));
    }

    async function calendarAutoEnrichLoggedMeetings(events) {
      if (!currentUser || !Array.isArray(events) || !events.length) return;
      if (typeof crmLoadContacts !== 'function' || typeof crmPost !== 'function') return;

      try {
        if (!crmContactsLoaded) await crmLoadContacts(false, { silent: true });
      } catch (error) {
        console.warn('CORE Calendar enrichment skipped because Context could not be loaded.', error);
        return;
      }

      let updatedRecords = 0;
      for (const event of events) {
        const artifacts = calendarLateArtifacts(event);
        if (!artifacts.length) continue;
        const candidates = crmRecords.filter(record => calendarRecordMatchesEvent(record, event));
        for (const record of candidates) {
          const existingUrls = calendarExistingDocumentUrls(record);
          const newArtifacts = artifacts.filter(attachment => {
            const url = calendarArtifactUrl(attachment);
            return url && !existingUrls.has(url);
          });
          if (!newArtifacts.length) continue;

          const attemptKey = `${record.recordId}|${newArtifacts.map(calendarArtifactUrl).sort().join('|')}`;
          if (calendarEnrichmentAttemptKeys.has(attemptKey)) continue;
          calendarEnrichmentAttemptKeys.add(attemptKey);

          try {
            const response = await crmPost(CRM_RECORD_MUTATION_URL, {
              action: 'calendar-enrich',
              recordId: record.recordId,
              calendarAttachments: newArtifacts
            });
            if (response?.success !== false && Number(response?.addedAttachments || newArtifacts.length) > 0) {
              updatedRecords += 1;
              newArtifacts.forEach(attachment => existingUrls.add(calendarArtifactUrl(attachment)));
            }
          } catch (error) {
            calendarEnrichmentAttemptKeys.delete(attemptKey);
            console.warn('CORE could not attach late Calendar artifacts to record', record.recordId, error);
          }
        }
      }

      if (updatedRecords > 0) {
        try { await crmLoadContacts(true, { silent: true }); } catch (error) { console.warn('CORE Context refresh after Calendar enrichment failed.', error); }
        dashboardShowNotice(`${updatedRecords} CORE ${updatedRecords === 1 ? 'record was' : 'records were'} updated with new Gemini notes or recording links.`);
      }
    }

    async function loadMonthEvents(viewDate, options = {}) {
      const force = Boolean(options.force);
      const refreshIfStale = Boolean(options.refreshIfStale);
      const monthKey = getMonthKey(viewDate);
      restoreCalendarCache(viewDate);

      if (!googleAccessToken) {
        if (Array.isArray(monthCache[monthKey])) {
          applyMonthEvents(monthCache[monthKey]);
          setCalendarStatus('Showing saved meetings. Select Connect Calendar to refresh.');
        } else {
          setCalendarStatus('Click Sync to load your meetings.');
          renderCalendarGrid();
        }
        return;
      }

      const cacheAge = Date.now() - Number(monthCacheTimestamps[monthKey] || 0);
      const cacheIsFresh = Array.isArray(monthCache[monthKey]) && cacheAge >= 0 && cacheAge < CALENDAR_CACHE_FRESH_MS;
      if (!force && cacheIsFresh) {
        applyMonthEvents(monthCache[monthKey]);
        setCalendarStatus('');
        return;
      }

      if (!force && Array.isArray(monthCache[monthKey])) applyMonthEvents(monthCache[monthKey]);
      if (!force && !refreshIfStale && Array.isArray(monthCache[monthKey])) return;
      if (calendarLoadPromises[monthKey]) return calendarLoadPromises[monthKey];

      setCalendarStatus('Loading your meetings...');

      calendarLoadPromises[monthKey] = (async () => {
      try {
        const { gridStart, gridEnd } = getGridRange(viewDate);
        const h = { Authorization: `Bearer ${googleAccessToken}` };
        const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
        const res = await fetch(
          `${base}?timeMin=${gridStart.toISOString()}&timeMax=${gridEnd.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=250`,
          { headers: h }
        );
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(`${res.status || ''} ${data.error?.message || 'Calendar request failed'}`.trim());

        persistCalendarCache(viewDate, data.items || []);
        applyMonthEvents(monthCache[monthKey]);
        setCalendarStatus('');
        // Gemini notes and Meet recordings can be attached after the meeting ends.
        // Reconcile newly discovered Calendar artifacts into existing CORE records
        // without delaying Calendar rendering.
        Promise.resolve().then(() => calendarAutoEnrichLoggedMeetings(data.items || [])).catch(error => {
          console.warn('CORE Calendar enrichment failed.', error);
        });

      } catch (e) {
        if (String(e.message || '').includes('401') || String(e.message || '').toLowerCase().includes('invalid credentials')) {
          googleAccessToken = null;
          clearSavedAccessToken();
          setCalendarStatus('⚠️ Calendar session expired. Click Sync once to reconnect.');
        } else {
          setCalendarStatus('⚠️ ' + (e.message || 'Failed to load. Click Sync to retry.'));
        }
        renderCalendarGrid();
      } finally {
        delete calendarLoadPromises[monthKey];
      }
      })();
      return calendarLoadPromises[monthKey];
    }

    function applyMonthEvents(events) {
      calendarEventsByDate = {};
      events.forEach(ev => {
        const key = getEventDateKey(ev);
        if (!key) return;
        (calendarEventsByDate[key] ||= []).push(ev);
      });
      renderCalendarGrid();
      if (typeof systemRenderDashboardCRM === 'function') systemRenderDashboardCRM();
      const dayModal = document.getElementById('dayDetailModal');
      if (calendarViewMode === 'month' && selectedDateKey && dayModal?.style.display === 'flex') {
        renderDayDetail(selectedDateKey);
      }
    }

    // Same KL-timezone approach as getEventDateKey() - a meeting's clock
    // position must be based on Malaysia local time, not the browser's own
    // timezone, or the arc would land in the wrong place for anyone viewing
    // this from outside Malaysia.
    function getKLHourFraction(d) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(d);
      const h = Number(parts.find(p => p.type === 'hour').value);
      const min = Number(parts.find(p => p.type === 'minute').value);
      return h + min / 60;
    }

    function formatKLTime(d) {
      return new Intl.DateTimeFormat('en-MY', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur'
      }).format(d);
    }

    function calendarDayCellMarkup(cellDate, isOutside, chipLimit) {
      const key = ymdKey(cellDate);
      const todayKey = ymdKey(new Date());
      const isToday = key === todayKey;
      const isSelected = key === selectedDateKey;
      const dayEvents = calendarEventsByDate[key] || [];
      const visibleChips = dayEvents.slice(0, chipLimit);
      const remaining = dayEvents.length - visibleChips.length;
      const weekName = cellDate.toLocaleDateString('en-MY', { weekday: 'short' });
      return `
        <button type="button" class="cal-day-cell${isOutside ? ' outside' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-date="${key}" onclick="selectDay('${key}')">
          <span class="cal-day-week-label">${weekName}</span>
          <span class="cal-day-number">${cellDate.getDate()}</span>
          <div class="cal-day-chips">
            ${visibleChips.map(ev => `<div class="cal-chip">${esc(ev.summary || '(No title)')}</div>`).join('')}
            ${remaining > 0 ? `<div class="cal-more">+${remaining} more</div>` : ''}
          </div>
          <div class="cal-day-dots">${dayEvents.slice(0, 4).map(() => '<span class="cal-dot"></span>').join('')}</div>
        </button>`;
    }

    function dashboardWeekEventLayout(events) {
      const sorted = events.slice().sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
      const groups = [];
      let currentGroup = [];
      let groupEnd = -Infinity;

      sorted.forEach(item => {
        // Boundary-touching meetings are not overlapping: an event ending at
        // 11:00 and another beginning at 11:00 belong to separate groups.
        if (currentGroup.length && item.startMs >= groupEnd) {
          groups.push(currentGroup);
          currentGroup = [];
          groupEnd = -Infinity;
        }
        currentGroup.push(item);
        groupEnd = Math.max(groupEnd, item.endMs);
      });
      if (currentGroup.length) groups.push(currentGroup);

      return groups.flatMap((group, overlapGroup) => {
        const depthEnds = [];
        const sameStartCounts = new Map();
        const groupHasOverlap = group.length > 1;

        return group.map((item, stackOrder) => {
          // Reuse the earliest free visual stack depth. Width is never divided
          // by the number of concurrent meetings; depth only controls the small
          // layered inset and deterministic z-index.
          let stackDepth = depthEnds.findIndex(endMs => endMs <= item.startMs);
          if (stackDepth < 0) stackDepth = depthEnds.length;
          depthEnds[stackDepth] = item.endMs;

          const sameStartIndex = sameStartCounts.get(item.startMs) || 0;
          sameStartCounts.set(item.startMs, sameStartIndex + 1);

          return {
            ...item,
            overlapGroup,
            groupHasOverlap,
            stackDepth,
            stackOrder,
            sameStartIndex
          };
        });
      });
    }

    function dashboardStableEventVariant(event) {
      const seed = String(
        event?.id ||
        event?.iCalUID ||
        `${event?.summary || ''}|${event?.start?.dateTime || event?.start?.date || ''}|${event?.end?.dateTime || event?.end?.date || ''}`
      );
      let hash = 2166136261;
      for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (Math.abs(hash) % 5) + 1;
    }

    function dashboardOpenWeekEvent(key, button) {
      document.querySelectorAll('#pageDashboard .week-event.selected').forEach(item => item.classList.remove('selected'));
      if (button) button.classList.add('selected');
      if (key && window._eventsCache[key]) openEventModal(key);
    }


    let dashboardMobileWeekSelectedDateKey = '';

    function dashboardMobileWeekDurationLabel(event) {
      if (!event?.start?.dateTime) return 'All day';
      const start = new Date(event.start.dateTime);
      const end = event?.end?.dateTime ? new Date(event.end.dateTime) : new Date(start.getTime() + 30 * 60000);
      const minutes = Math.max(1, Math.round((end - start) / 60000));
      if (minutes < 60) return `${minutes} min`;
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      return remainder ? `${hours} hr ${remainder} min` : `${hours} hr${hours === 1 ? '' : 's'}`;
    }

    function dashboardMobileWeekPeopleLabel(event) {
      const attendeeNames = (Array.isArray(event?.attendees) ? event.attendees : [])
        .filter(attendee => !attendee?.self)
        .map(attendee => dashboardCleanDisplayText(attendee?.displayName || attendee?.email || '', ''))
        .filter(Boolean);
      if (attendeeNames.length) {
        const shown = attendeeNames.slice(0, 2).join(', ');
        return attendeeNames.length > 2 ? `${shown} +${attendeeNames.length - 2}` : shown;
      }
      const organiser = dashboardCleanDisplayText(event?.organizer?.displayName || event?.organizer?.email || '', '');
      if (organiser) return organiser;
      const location = dashboardCleanDisplayText(event?.location || '', '');
      return location || 'No attendee details';
    }

    function dashboardSelectMobileWeekDay(dateKey) {
      dashboardMobileWeekSelectedDateKey = dateKey;
      renderCalendarGrid();
    }

    function dashboardRenderMobileWeek(grid, label, monthNames) {
      const weekStart = getWeekStart(calendarViewDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
      const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
      label.textContent = sameMonth
        ? `${weekStart.getDate()}-${weekEnd.getDate()} ${monthNames[weekStart.getMonth()]} ${weekEnd.getFullYear()}`
        : sameYear
          ? `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]} - ${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`
          : `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]} ${weekStart.getFullYear()} - ${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

      const todayKey = ymdKey(new Date());
      const days = Array.from({ length: 7 }, (_, dayIndex) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + dayIndex);
        const key = ymdKey(date);
        const events = (calendarEventsByDate[key] || []).slice().sort((a, b) => {
          const aAllDay = Boolean(a?.start?.date && !a?.start?.dateTime);
          const bAllDay = Boolean(b?.start?.date && !b?.start?.dateTime);
          if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
          const aTime = a?.start?.dateTime ? new Date(a.start.dateTime).getTime() : 0;
          const bTime = b?.start?.dateTime ? new Date(b.start.dateTime).getTime() : 0;
          return aTime - bTime;
        });
        return { date, key, events };
      });

      const weekKeys = days.map(day => day.key);
      if (!weekKeys.includes(dashboardMobileWeekSelectedDateKey)) {
        const firstMeetingDay = days.find(day => day.events.length);
        dashboardMobileWeekSelectedDateKey = weekKeys.includes(todayKey)
          ? todayKey
          : (firstMeetingDay?.key || days[0].key);
      }

      const selectedDay = days.find(day => day.key === dashboardMobileWeekSelectedDateKey) || days[0];
      const weeklyEvents = days.flatMap(day => day.events);
      const weeklyDurationMinutes = weeklyEvents.reduce((total, event) => {
        if (!event?.start?.dateTime) return total;
        const start = new Date(event.start.dateTime);
        const end = event?.end?.dateTime ? new Date(event.end.dateTime) : new Date(start.getTime() + 30 * 60000);
        return total + Math.max(1, Math.round((end - start) / 60000));
      }, 0);
      const weeklyHours = weeklyDurationMinutes / 60;
      const durationSummary = Number.isInteger(weeklyHours)
        ? `${weeklyHours} hr${weeklyHours === 1 ? '' : 's'}`
        : `${weeklyHours.toFixed(1)} hrs`;

      window._eventsCache = window._eventsCache || {};
      const dayButtons = days.map(day => {
        const selected = day.key === selectedDay.key;
        const today = day.key === todayKey;
        return `<button type="button" class="mobile-week-day${selected ? ' selected' : ''}${today ? ' today' : ''}" role="tab" aria-selected="${selected}" aria-label="${esc(day.date.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' }))}${day.events.length ? `, ${day.events.length} meeting${day.events.length === 1 ? '' : 's'}` : ', no meetings'}" onclick="dashboardSelectMobileWeekDay('${day.key}')"><span class="mobile-week-day-name">${day.date.toLocaleDateString('en-MY', { weekday:'short' }).toUpperCase()}</span><span class="mobile-week-day-number">${day.date.getDate()}</span><span class="mobile-week-day-count${day.events.length ? ' has-events' : ''}" aria-hidden="true">${day.events.length || ''}</span></button>`;
      }).join('');

      const agendaCards = selectedDay.events.map((event, eventIndex) => {
        const eventKey = `mw_${selectedDay.key}_${eventIndex}`;
        window._eventsCache[eventKey] = event;
        const title = dashboardCleanDisplayText(event?.summary, 'Untitled meeting');
        const isAllDay = Boolean(event?.start?.date && !event?.start?.dateTime);
        let timeRange = 'All day';
        if (!isAllDay && event?.start?.dateTime) {
          const start = new Date(event.start.dateTime);
          const end = event?.end?.dateTime ? new Date(event.end.dateTime) : new Date(start.getTime() + 30 * 60000);
          timeRange = `${formatKLTime(start)} - ${formatKLTime(end)}`;
        }
        const people = dashboardMobileWeekPeopleLabel(event);
        const duration = dashboardMobileWeekDurationLabel(event);
        return `<button type="button" class="mobile-week-event-card" onclick="dashboardOpenWeekEvent('${eventKey}',this)" aria-label="Open ${esc(title)}"><span class="mobile-week-event-time">${esc(timeRange)}</span><span class="mobile-week-event-title">${esc(title)}</span><span class="mobile-week-event-meta">${esc(people)}</span><span class="mobile-week-event-footer"><span>${esc(duration)}</span><span>Open meeting</span></span></button>`;
      }).join('');

      grid.classList.remove('week-mode', 'week-time-mode');
      grid.classList.add('mobile-week-mode');
      grid.innerHTML = `<div class="mobile-week-view"><div class="mobile-week-summary" aria-label="Weekly calendar summary"><span><strong>${weeklyEvents.length}</strong> meeting${weeklyEvents.length === 1 ? '' : 's'}</span><span>${durationSummary} total</span><span>GMT+8</span></div><div class="mobile-week-days" role="tablist" aria-label="Select a day">${dayButtons}</div><section class="mobile-week-agenda" aria-label="Selected day meetings"><div class="mobile-week-agenda-head"><div><span>${selectedDay.date.toLocaleDateString('en-MY', { weekday:'long' })}</span><strong>${selectedDay.date.toLocaleDateString('en-MY', { day:'numeric', month:'long', year:'numeric' })}</strong></div><span>${selectedDay.events.length} meeting${selectedDay.events.length === 1 ? '' : 's'}</span></div><div class="mobile-week-agenda-list">${agendaCards || '<div class="mobile-week-empty">No meetings scheduled for this day.</div>'}</div></section></div>`;
    }

    const dashboardMobileWeekMediaQuery = window.matchMedia('(max-width: 680px)');
    if (dashboardMobileWeekMediaQuery.addEventListener) {
      dashboardMobileWeekMediaQuery.addEventListener('change', () => {
        if (calendarViewMode === 'week') renderCalendarGrid();
      });
    }

    function dashboardRenderTimedWeek(grid, label, monthNames) {
      const weekStart = getWeekStart(calendarViewDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
      const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
      label.textContent = sameMonth
        ? `${weekStart.getDate()}–${weekEnd.getDate()} ${monthNames[weekStart.getMonth()]} ${weekEnd.getFullYear()}`
        : sameYear
          ? `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]} – ${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`
          : `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]} ${weekStart.getFullYear()} – ${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

      const MINUTES_PER_DAY = 24 * 60;
      const PIXELS_PER_MINUTE = 1;
      const HOUR_HEIGHT = 60;
      const GRID_TOP_PADDING = 24;
      const GRID_BOTTOM_PADDING = 24;
      const GRID_HEIGHT = MINUTES_PER_DAY * PIXELS_PER_MINUTE;
      const GRID_TOTAL_HEIGHT = GRID_TOP_PADDING + GRID_HEIGHT + GRID_BOTTOM_PADDING;
      const todayKey = ymdKey(new Date());
      const days = [];
      let hasAllDay = false;
      let earliestMeetingMinute = null;
      let weeklyMeetingCount = 0;
      let weeklyDurationMinutes = 0;
      window._eventsCache = window._eventsCache || {};

      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + dayIndex);
        const key = ymdKey(date);
        const dayEvents = (calendarEventsByDate[key] || []).slice();
        weeklyMeetingCount += dayEvents.length;
        const allDay = dayEvents.filter(event => event.start?.date && !event.start?.dateTime);
        if (allDay.length) hasAllDay = true;
        const timed = dayEvents.filter(event => event.start?.dateTime).map((event, index) => {
          const start = new Date(event.start.dateTime);
          const end = event.end?.dateTime ? new Date(event.end.dateTime) : new Date(start.getTime() + 30 * 60000);
          const startMinute = Math.round(getKLHourFraction(start) * 60);
          const durationMinutes = Math.max(1, Math.round((end - start) / 60000));
          weeklyDurationMinutes += durationMinutes;
          const endMinute = startMinute + durationMinutes;
          const clippedStart = Math.max(0, Math.min(MINUTES_PER_DAY, startMinute));
          const clippedEnd = Math.max(0, Math.min(MINUTES_PER_DAY, endMinute));
          if (clippedEnd > clippedStart) {
            earliestMeetingMinute = earliestMeetingMinute === null ? clippedStart : Math.min(earliestMeetingMinute, clippedStart);
          }
          return { event, index, startMs: start.getTime(), endMs: end.getTime(), clippedStart, clippedEnd };
        }).filter(item => item.clippedEnd > item.clippedStart);
        days.push({ date, key, allDay, timed: dashboardWeekEventLayout(timed) });
      }

      const durationHours = weeklyDurationMinutes / 60;
      const durationLabel = Number.isInteger(durationHours)
        ? `${durationHours} hr${durationHours === 1 ? '' : 's'} total`
        : `${durationHours.toFixed(1)} hrs total`;
      const summaryStrip = `<div class="week-summary-strip" aria-label="Weekly calendar summary">
        <span class="week-summary-item"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg><strong>${weeklyMeetingCount}</strong> meeting${weeklyMeetingCount === 1 ? '' : 's'} this week</span>
        <span class="week-summary-divider" aria-hidden="true"></span>
        <span class="week-summary-item"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>${durationLabel}</span>
        <span class="week-summary-divider" aria-hidden="true"></span>
        <span class="week-summary-item"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"></path></svg>All times shown in GMT+8</span>
      </div>`;

      const headers = days.map(day => `<div class="week-day-header${day.key === todayKey ? ' today' : ''}"><span class="week-day-name">${day.date.toLocaleDateString('en-MY', { weekday:'short' })}</span><span class="week-day-date">${day.date.getDate()} ${day.date.toLocaleDateString('en-MY', { month:'short' })}</span></div>`).join('');
      const allDayMarkup = hasAllDay ? `<div class="week-all-day-row"><div class="week-all-day-label">All day</div>${days.map((day, dayIndex) => `<div class="week-all-day-cell">${day.allDay.map((event, eventIndex) => { const eventKey = `wa${dayIndex}_${eventIndex}`; window._eventsCache[eventKey] = event; return `<button class="week-all-day-chip" type="button" onclick="dashboardOpenWeekEvent('${eventKey}',this)">${esc(dashboardCleanDisplayText(event.summary, 'Untitled meeting'))}</button>`; }).join('')}</div>`).join('')}</div>` : '';
      const labels = Array.from({ length: 24 }, (_, hour) => {
        const suffix = hour < 12 ? 'AM' : 'PM';
        const displayHour = hour % 12 || 12;
        return `<span class="week-time-label" style="top:${GRID_TOP_PADDING + hour * HOUR_HEIGHT}px">${displayHour}:00 ${suffix}</span>`;
      }).join('');
      const columns = days.map((day, dayIndex) => `<div class="week-day-column${day.key === todayKey ? ' today' : ''}">${day.timed.map((item, eventIndex) => {
        const eventKey = `wt${dayIndex}_${eventIndex}`;
        window._eventsCache[eventKey] = item.event;
        const stackDepth = Math.max(0, item.stackDepth || 0);
        const sameStartIndex = Math.max(0, item.sameStartIndex || 0);
        const stackOrder = Math.max(0, item.stackOrder || 0);
        const exactStartVisualOffset = sameStartIndex * 24;
        const top = GRID_TOP_PADDING + item.clippedStart * PIXELS_PER_MINUTE + exactStartVisualOffset;
        const durationHeight = (item.clippedEnd - item.clippedStart) * PIXELS_PER_MINUTE;
        const height = Math.max(item.groupHasOverlap ? 42 : 30, durationHeight);
        const baseInset = 3;
        const stackOffset = 8;
        const rightInset = 4;
        const leftOffset = baseInset + stackDepth * stackOffset;
        const eventLeft = `${leftOffset}px`;
        const eventWidth = `calc(100% - ${leftOffset + rightInset}px)`;
        const eventZIndex = 3 + stackOrder;
        const startDate = new Date(item.event.start.dateTime);
        const endDate = item.event.end?.dateTime ? new Date(item.event.end.dateTime) : new Date(startDate.getTime() + 30 * 60000);
        const timeRange = `${formatKLTime(startDate)}–${formatKLTime(endDate)}`;
        const title = dashboardCleanDisplayText(item.event.summary, 'Untitled meeting');
        const location = dashboardCleanDisplayText(item.event.location || '', '');
        const variant = dashboardStableEventVariant(item.event);
        const overlapClass = item.groupHasOverlap ? ' is-overlap' : '';
        const ariaLabel = `${title}. ${day.date.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}. ${timeRange}${location ? `. ${location}` : ''}`;
        return `<button class="week-event week-event-variant-${variant}${overlapClass}" type="button" data-stack-depth="${stackDepth}" data-same-start-index="${sameStartIndex}" style="top:${top}px;height:${height}px;left:${eventLeft};width:${eventWidth};z-index:${eventZIndex}" onclick="dashboardOpenWeekEvent('${eventKey}',this)" aria-label="${esc(ariaLabel)}" title="${esc(title)} — ${esc(timeRange)}${location ? ` — ${esc(location)}` : ''}"><span class="week-event-head"><span class="week-event-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg></span><span class="week-event-title">${esc(title)}</span></span><span class="week-event-time">${esc(timeRange)}</span>${location ? `<span class="week-event-location"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg><span>${esc(location)}</span></span>` : ''}</button>`;
      }).join('')}</div>`).join('');

      let currentLine = '';
      const now = new Date();
      if (days.some(day => day.key === todayKey)) {
        const currentMinute = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(getKLHourFraction(now) * 60)));
        currentLine = `<div class="week-current-line" style="top:${GRID_TOP_PADDING + currentMinute * PIXELS_PER_MINUTE}px"></div>`;
      }

      grid.classList.remove('week-mode');
      grid.classList.add('week-time-mode');
      grid.innerHTML = `${summaryStrip}<div class="week-calendar-shell"><div class="week-calendar-scroll"><div class="week-calendar-inner"><div class="week-calendar-header"><div class="week-header-axis"></div>${headers}</div>${allDayMarkup}<div class="week-time-scroll"><div class="week-time-grid" style="--week-grid-height:${GRID_HEIGHT}px;--week-grid-total-height:${GRID_TOTAL_HEIGHT}px;--week-grid-offset:${GRID_TOP_PADDING}px;--week-hour-height:${HOUR_HEIGHT}px"><div class="week-time-axis">${labels}</div><div class="week-day-columns">${columns}${currentLine}</div></div></div></div></div></div>`;
      requestAnimationFrame(() => {
        const scroll = grid.querySelector('.week-time-scroll');
        if (!scroll) return;
        const targetMinute = earliestMeetingMinute === null ? 8 * 60 : Math.max(0, earliestMeetingMinute - 60);
        const requestedTop = GRID_TOP_PADDING + targetMinute * PIXELS_PER_MINUTE;
        scroll.scrollTop = Math.max(0, Math.min(requestedTop, scroll.scrollHeight - scroll.clientHeight));
      });
    }

    function renderCalendarGrid() {
      const grid = document.getElementById('calGrid');
      const label = document.getElementById('calMonthLabel');
      if (!grid || !label) return;
      updateCalendarViewControls();
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      if (calendarViewMode === 'week') {
        if (window.matchMedia('(max-width: 680px)').matches) dashboardRenderMobileWeek(grid, label, monthNames);
        else {
          grid.classList.remove('mobile-week-mode');
          dashboardRenderTimedWeek(grid, label, monthNames);
        }
        return;
      }
      label.textContent = monthNames[calendarViewDate.getMonth()] + ' ' + calendarViewDate.getFullYear();
      grid.classList.remove('week-mode', 'week-time-mode', 'mobile-week-mode');
      const cells = [];
      const { gridStart } = getGridRange(calendarViewDate);
      for (let i = 0; i < 42; i++) {
        const cellDate = new Date(gridStart);
        cellDate.setDate(gridStart.getDate() + i);
        cells.push(calendarDayCellMarkup(cellDate, cellDate.getMonth() !== calendarViewDate.getMonth(), 2));
      }
      grid.innerHTML = cells.join('');
    }

    function selectDay(key) {
      selectedDateKey = key;
      renderCalendarGrid();
      renderDayDetail(key);
    }

    function renderDayDetail(key) {
      const modal = document.getElementById('dayDetailModal');
      const titleEl = document.getElementById('calDayDetailTitle');
      const list = document.getElementById('calDayEvents');
      const events = calendarEventsByDate[key] || [];

      const d = new Date(key + 'T00:00:00');
      titleEl.textContent = d.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      window._eventsCache = {};

      if (events.length === 0) {
        list.innerHTML = `<div class="calendar-status">No meetings on this day.</div>`;
      } else {
        list.innerHTML = events.map((ev, i) => {
          const dkey = `d${i}`;
          window._eventsCache[dkey] = ev;
          const start = ev.start?.dateTime || ev.start?.date || '';
          const titleText = ev.summary || '(No title)';
          const others = (ev.attendees || []).filter(a => !a.self).map(a => a.displayName || a.email);
          return `
            <div class="event-card" onclick="openEventModal('${dkey}')">
              <div class="event-info">
                <div class="event-title">${esc(titleText)}</div>
                <div class="event-date">${fmtDate(start)}</div>
                ${others.length ? `<div class="event-attendees">${esc(others.join(', '))}</div>` : ''}
              </div>
              <button class="event-log-btn" onclick="event.stopPropagation();openEventModal('${dkey}')">Log→</button>
            </div>`;
        }).join('');
      }

      modal.style.display = 'flex';
    }

    function closeDayDetail() {
      document.getElementById('dayDetailModal').style.display = 'none';
    }

    function changeMonth(delta) {
      if (calendarViewMode === 'week') {
        calendarViewDate.setDate(calendarViewDate.getDate() + (delta * 7));
      } else {
        calendarViewDate.setMonth(calendarViewDate.getMonth() + delta);
        calendarViewDate.setDate(1);
      }
      selectedDateKey = null;
      closeDayDetail();
      renderCalendarGrid();
      loadMonthEvents(calendarViewDate);
    }

    async function goToToday() {
      const today = new Date();
      closeDayDetail();
      calendarViewDate = calendarViewMode === 'week'
        ? new Date(today)
        : new Date(today.getFullYear(), today.getMonth(), 1);
      const todayKey = ymdKey(today);
      selectedDateKey = null;
      renderCalendarGrid();
      await loadMonthEvents(calendarViewDate);
      if (calendarViewMode === 'month') selectDay(todayKey);
    }

    function esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function fmtDate(d) {
      if (!d) return '';
      try {
        return new Date(d).toLocaleString('en-MY', {
          weekday:'short', day:'numeric', month:'short', year:'numeric',
          hour: d.includes('T') ? '2-digit' : undefined,
          minute: d.includes('T') ? '2-digit' : undefined
        });
      } catch { return d; }
    }

    // ── DATE/TIME FIELD HELPERS ──
    // The UI now uses native date/time pickers, but the existing n8n webhook still
    // receives the backward-compatible combined eventDate value.
    function getKLDateTimeParts(input) {
      if (!input) return { date: '', time: '' };

      const raw = String(input);
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { date: raw, time: '' };
      }

      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return { date: '', time: '' };

      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(d);

      const val = type => parts.find(p => p.type === type)?.value || '';
      return {
        date: `${val('year')}-${val('month')}-${val('day')}`,
        time: `${val('hour')}:${val('minute')}`
      };
    }

    function setMeetingDateTimeFields(rawStart) {
      const parts = getKLDateTimeParts(rawStart);
      document.getElementById('fieldEventDate').value = parts.date;
      document.getElementById('fieldEventTime').value = parts.time;
    }

    function clearMeetingDateTimeFields() {
      document.getElementById('fieldEventDate').value = '';
      document.getElementById('fieldEventTime').value = '';
    }

    function getMeetingDateOnly() {
      return document.getElementById('fieldEventDate').value.trim();
    }

    function getMeetingTimeOnly() {
      return document.getElementById('fieldEventTime').value.trim();
    }

    function buildEventDateValueForSubmit() {
      const dateOnly = getMeetingDateOnly();
      const timeOnly = getMeetingTimeOnly();

      if (dateOnly && timeOnly) {
        return `${dateOnly}T${timeOnly}:00+08:00`;
      }

      if (dateOnly) return dateOnly;
      return '';
    }

    // ── MODAL + TEMPORARY DRAFT ──
    function getMeetingDocuments() {
      return Array.from(document.getElementById('fieldMeetingDocument')?.files || []);
    }

    function normalizeCalendarAttachments(attachments) {
      return (Array.isArray(attachments) ? attachments : [])
        .map((attachment, index) => {
          const url = String(attachment?.fileUrl || attachment?.url || '').trim();
          const name = String(attachment?.title || attachment?.name || `Calendar attachment ${index + 1}`).trim();
          const mimeType = String(attachment?.mimeType || '').trim();
          if (!/^https:\/\//i.test(url)) return null;
          return {
            name: name || `Calendar attachment ${index + 1}`,
            url,
            mimeType,
            source: 'calendar'
          };
        })
        .filter(Boolean);
    }

    function getCalendarAttachments() {
      return normalizeCalendarAttachments(currentEvent?.attachments || []);
    }

    function renderCalendarAttachments(explicitAttachments = null) {
      const attachments = explicitAttachments === null
        ? getCalendarAttachments()
        : normalizeCalendarAttachments(explicitAttachments);
      const section = document.getElementById('calendarAttachmentSection');
      const state = document.getElementById('calendarAttachmentState');
      const count = document.getElementById('calendarAttachmentCount');
      const list = document.getElementById('calendarAttachmentList');
      if (!section || !state || !count || !list) return;

      if (!attachments.length) {
        section.style.display = 'none';
        state.classList.remove('show');
        count.textContent = '0 linked files';
        list.innerHTML = '';
        return;
      }

      section.style.display = 'block';
      state.classList.add('show');
      count.textContent = attachments.length + (attachments.length === 1 ? ' linked file' : ' linked files');
      list.innerHTML = attachments.map((attachment) => `
        <div class="calendar-attachment-row">
          <div class="calendar-attachment-copy">
            <div class="calendar-attachment-name">${escapeFileName(attachment.name)}</div>
            <div class="calendar-attachment-type">${escapeFileName(attachment.mimeType || 'Google Drive attachment')}</div>
          </div>
          <a class="calendar-open-btn" href="${escapeFileName(attachment.url)}" target="_blank" rel="noopener noreferrer">View</a>
        </div>
      `).join('');
    }

    function formatFileSize(bytes) {
      const value = Number(bytes || 0);
      if (value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + ' KB';
      return (value / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function escapeFileName(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function setMeetingDocumentFiles(files) {
      const input = document.getElementById('fieldMeetingDocument');
      const transfer = new DataTransfer();
      files.slice(0, 5).forEach(file => transfer.items.add(file));
      input.files = transfer.files;
    }

    function updateMeetingDocumentState() {
      const state = document.getElementById('meetingDocumentState');
      const list = document.getElementById('meetingDocumentList');
      const count = document.getElementById('meetingDocumentCount');
      const files = getMeetingDocuments();

      if (!state || !list || !count) return;

      if (!files.length) {
        state.classList.remove('show');
        list.innerHTML = '';
        count.textContent = '0 documents selected';
        return;
      }

      count.textContent = files.length + (files.length === 1 ? ' document selected' : ' documents selected');
      list.innerHTML = files.map((file, index) => `
        <div class="pdf-file-row">
          <div class="pdf-file-copy">
            <div class="pdf-file-name">${escapeFileName(file.name)}</div>
            <div class="pdf-file-size">${formatFileSize(file.size)}</div>
          </div>
          <div class="pdf-file-actions">
            <button class="pdf-mini-btn" type="button" onclick="previewMeetingDocument(${index})">Preview</button>
            <button class="pdf-mini-btn remove" type="button" onclick="removeMeetingDocument(${index})">Remove</button>
          </div>
        </div>
      `).join('');
      state.classList.add('show');
    }

    function handleMeetingDocumentChange() {
      const files = getMeetingDocuments();

      if (files.length > 5) {
        setMeetingDocumentFiles(files.slice(0, 5));
        showModalErr('You can attach a maximum of 5 supporting PDFs. Only the first 5 files were kept.');
      }

      updateMeetingDocumentState();
      scheduleDraftSave();
    }

    function previewMeetingDocument(index) {
      const file = getMeetingDocuments()[index] || null;
      if (!file) {
        showModalErr('This PDF is no longer selected. Please select it again.');
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => {
        try { URL.revokeObjectURL(previewUrl); } catch (e) {}
      }, 60000);
    }

    function removeMeetingDocument(index) {
      const files = getMeetingDocuments().filter((file, fileIndex) => fileIndex !== index);
      setMeetingDocumentFiles(files);
      updateMeetingDocumentState();
      scheduleDraftSave();
    }


    function businessCardFileSignature(file) {
      if (!file) return '';
      return [file.name || '', file.size || 0, file.lastModified || 0].join('|');
    }

    function normalizeReviewedContact(contact = {}, index = 0) {
      const email = String(contact.email || contact.emailAddress || '').trim();
      const phone = String(contact.contactNumber || contact.phone || contact.mobile || '').trim();
      return {
        cardNumber: Number(contact.cardNumber || index + 1),
        personName: String(contact.personName || contact.name || '').trim(),
        companyName: String(contact.companyName || contact.company || '').trim(),
        email,
        contactNumber: phone,
        jobTitle: String(contact.jobTitle || contact.designation || '').trim(),
        confidence: String(contact.confidence || 'unknown').toLowerCase(),
        reviewReasons: Array.isArray(contact.reviewReasons) ? contact.reviewReasons.map(value => String(value || '').trim()).filter(Boolean) : []
      };
    }

    function reviewedContactStatus(contact) {
      const reasons = [];
      const personName = String(contact?.personName || '').trim();
      const companyName = String(contact?.companyName || '').trim();
      const email = String(contact?.email || '').trim();
      const phone = String(contact?.contactNumber || '').trim();

      if (!personName) reasons.push('Person name is missing');
      if (!companyName) reasons.push('Company name is missing');
      if (!email && !phone) reasons.push('Email or contact number is required');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reasons.push('Email format is invalid');

      return {
        ready: reasons.length === 0,
        reasons
      };
    }


    function setBusinessCardAnalysisState(message = '', mode = 'hidden') {
      const state = document.getElementById('businessCardAnalysisState');
      const messageEl = document.getElementById('businessCardAnalysisMessage');
      if (!state || !messageEl) return;
      state.classList.remove('show', 'error', 'done');
      if (mode === 'hidden') {
        messageEl.textContent = '';
        return;
      }
      messageEl.textContent = message;
      state.classList.add('show');
      if (mode === 'error') state.classList.add('error');
      if (mode === 'done') state.classList.add('done');
    }

    function normalizeManualContact(contact = {}, index = 0) {
      return normalizeReviewedContact({ ...contact, cardNumber: index + 1, confidence: 'manual' }, index);
    }

    function updateManualContact(index, field, value) {
      if (!manualContacts[index]) return;
      manualContacts[index][field] = String(value || '');
      renderManualContacts();
      scheduleDraftSave();
    }

    function addManualContact() {
      if (manualContacts.length >= 10) {
        showModalErr('You can add a maximum of 10 contacts to one meeting.');
        return;
      }
      manualContacts.push(normalizeManualContact({}, manualContacts.length));
      renderManualContacts();
      scheduleDraftSave();
    }

    function removeManualContact(index) {
      if (manualContacts.length <= 1) {
        manualContacts = [normalizeManualContact({}, 0)];
      } else {
        manualContacts.splice(index, 1);
        manualContacts = manualContacts.map((contact, contactIndex) => normalizeManualContact(contact, contactIndex));
      }
      renderManualContacts();
      scheduleDraftSave();
    }

    function renderManualContacts() {
      const list = document.getElementById('manualContactList');
      const count = document.getElementById('manualContactCount');
      if (!list || !count) return;
      if (!manualContacts.length) manualContacts = [normalizeManualContact({}, 0)];
      count.textContent = manualContacts.length + (manualContacts.length === 1 ? ' contact' : ' contacts');
      list.innerHTML = manualContacts.map((contact, index) => {
        const status = reviewedContactStatus(contact);
        const reasonText = status.ready ? 'Ready to save as a separate contact record.' : status.reasons.join(' · ');
        return `
          <div class="business-card-review-card" data-manual-index="${index}">
            <div class="business-card-review-head">
              <div class="business-card-review-contact">Contact ${index + 1}</div>
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end;">
                <span class="business-card-status ${status.ready ? 'ready' : 'review'}" id="manualContactStatus_${index}">${status.ready ? 'Ready' : 'Incomplete'}</span>
                <button type="button" class="business-card-review-remove" onclick="removeManualContact(${index})">${manualContacts.length === 1 ? 'Clear' : 'Remove'}</button>
              </div>
            </div>
            <div class="business-card-review-grid">
              <div class="business-card-review-field">
                <label>Person Name</label>
                <input class="business-card-review-input" value="${esc(contact.personName)}" oninput="manualContacts[${index}].personName=this.value;refreshManualContactStatus(${index});scheduleDraftSave()" placeholder="Person name"/>
              </div>
              <div class="business-card-review-field">
                <label>Company Name</label>
                <input class="business-card-review-input" value="${esc(contact.companyName)}" oninput="manualContacts[${index}].companyName=this.value;refreshManualContactStatus(${index});scheduleDraftSave()" placeholder="Company name"/>
              </div>
              <div class="business-card-review-field">
                <label>Email</label>
                <input class="business-card-review-input" type="email" value="${esc(contact.email)}" oninput="manualContacts[${index}].email=this.value;refreshManualContactStatus(${index});scheduleDraftSave()" placeholder="name@company.com"/>
              </div>
              <div class="business-card-review-field">
                <label>Contact Number</label>
                <input class="business-card-review-input" type="tel" value="${esc(contact.contactNumber)}" oninput="manualContacts[${index}].contactNumber=this.value;refreshManualContactStatus(${index});scheduleDraftSave()" placeholder="+60..."/>
              </div>
              <div class="business-card-review-field full">
                <label>Job Title <span style="text-transform:none;letter-spacing:0;font-weight:650;">(optional)</span></label>
                <input class="business-card-review-input" value="${esc(contact.jobTitle)}" oninput="manualContacts[${index}].jobTitle=this.value;scheduleDraftSave()" placeholder="Designation or role"/>
              </div>
            </div>
            <div class="business-card-review-reason${status.ready ? ' ready' : ''}" id="manualContactReason_${index}">${esc(reasonText)}</div>
          </div>`;
      }).join('');
      updateSubmitButtonLabel();
    }

    function refreshManualContactStatus(index) {
      const contact = manualContacts[index];
      const reason = document.getElementById('manualContactReason_' + index);
      const badge = document.getElementById('manualContactStatus_' + index);
      if (!contact || !reason) return;
      const status = reviewedContactStatus(contact);
      if (badge) {
        badge.className = 'business-card-status ' + (status.ready ? 'ready' : 'review');
        badge.textContent = status.ready ? 'Ready' : 'Incomplete';
      }
      reason.className = 'business-card-review-reason' + (status.ready ? ' ready' : '');
      reason.textContent = status.ready ? 'Ready to save as a separate contact record.' : status.reasons.join(' · ');
      updateSubmitButtonLabel();
    }

    function validateManualContacts() {
      if (!manualContacts.length) return { ok:false, message:'Add at least one contact.' };
      const invalid = manualContacts.map((contact,index)=>({index,status:reviewedContactStatus(contact)})).filter(entry=>!entry.status.ready);
      if (invalid.length) {
        const first = invalid[0];
        return { ok:false, message:'Manual Contact ' + (first.index + 1) + ' is incomplete: ' + first.status.reasons.join(', ') + '.' };
      }
      return { ok:true, message:'' };
    }

        function updateSubmitButtonLabel() {
      const btn = document.getElementById('submitBtn');
      if (!btn) return;
      const inputMethod = document.querySelector('input[name="contactInputMethod"]:checked')?.value || 'businessCard';
      const count = inputMethod === 'manual' ? manualContacts.length : reviewedBusinessCardContacts.length;
      btn.textContent = count
        ? `Save ${count} Context Record${count === 1 ? '' : 's'} to CORE`
        : 'Save Context to CORE';
      if (!businessCardAnalysisInProgress) btn.disabled = false;
    }

    function refreshBusinessCardReviewRowStatus(index) {
      const contact = reviewedBusinessCardContacts[index];
      if (!contact) return;
      const status = reviewedContactStatus(contact);
      const badge = document.getElementById('businessCardStatus_' + index);
      const reason = document.getElementById('businessCardReason_' + index);
      if (badge) {
        badge.className = 'business-card-status ' + (status.ready ? 'ready' : 'review');
        badge.textContent = status.ready ? 'Ready' : 'Manual Review Required';
      }
      if (reason) {
        reason.className = 'business-card-review-reason' + (status.ready ? ' ready' : '');
        reason.textContent = status.ready
          ? 'Ready to save as a separate contact record.'
          : status.reasons.join(' · ');
      }
    }

    function updateReviewedContact(index, field, value) {
      if (!reviewedBusinessCardContacts[index]) return;
      reviewedBusinessCardContacts[index][field] = String(value || '');
      refreshBusinessCardReviewRowStatus(index);
      updateSubmitButtonLabel();
      scheduleDraftSave();
    }

    function renderBusinessCardReview() {
      const state = document.getElementById('businessCardReviewState');
      const list = document.getElementById('businessCardReviewList');
      const count = document.getElementById('businessCardReviewCount');
      if (!state || !list || !count) return;

      if (!reviewedBusinessCardContacts.length) {
        state.classList.remove('show');
        list.innerHTML = '';
        count.textContent = '0 contacts detected';
        updateSubmitButtonLabel();
        return;
      }

      count.textContent = reviewedBusinessCardContacts.length + (reviewedBusinessCardContacts.length === 1 ? ' contact detected' : ' contacts detected');
      list.innerHTML = reviewedBusinessCardContacts.map((contact, index) => {
        const status = reviewedContactStatus(contact);
        const statusText = status.ready ? 'Ready' : 'Manual Review Required';
        const reasonText = status.ready ? 'Ready to save as a separate contact record.' : status.reasons.join(' · ');
        return `
          <div class="business-card-review-card" data-review-index="${index}">
            <div class="business-card-review-head">
              <div class="business-card-review-contact">Contact ${index + 1}</div>
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end;">
                <span class="business-card-status ${status.ready ? 'ready' : 'review'}" id="businessCardStatus_${index}">${statusText}</span>
                <button type="button" class="business-card-review-remove" onclick="removeBusinessCardReviewContact(${index})">Remove</button>
              </div>
            </div>
            <div class="business-card-review-grid">
              <div class="business-card-review-field">
                <label>Person Name</label>
                <input class="business-card-review-input" value="${esc(contact.personName)}" oninput="updateReviewedContact(${index}, 'personName', this.value)" placeholder="Person name"/>
              </div>
              <div class="business-card-review-field">
                <label>Company Name</label>
                <input class="business-card-review-input" value="${esc(contact.companyName)}" oninput="updateReviewedContact(${index}, 'companyName', this.value)" placeholder="Company name"/>
              </div>
              <div class="business-card-review-field">
                <label>Email</label>
                <input class="business-card-review-input" type="email" value="${esc(contact.email)}" oninput="updateReviewedContact(${index}, 'email', this.value)" placeholder="name@company.com"/>
              </div>
              <div class="business-card-review-field">
                <label>Contact Number</label>
                <input class="business-card-review-input" type="tel" value="${esc(contact.contactNumber)}" oninput="updateReviewedContact(${index}, 'contactNumber', this.value)" placeholder="+60..."/>
              </div>
              <div class="business-card-review-field full">
                <label>Job Title <span style="text-transform:none;letter-spacing:0;font-weight:650;">(optional)</span></label>
                <input class="business-card-review-input" value="${esc(contact.jobTitle)}" oninput="updateReviewedContact(${index}, 'jobTitle', this.value)" placeholder="Designation or role"/>
              </div>
            </div>
            <div class="business-card-review-reason${status.ready ? ' ready' : ''}" id="businessCardReason_${index}">${esc(reasonText)}</div>
          </div>
        `;
      }).join('');
      state.classList.add('show');
      updateSubmitButtonLabel();
    }

    function clearBusinessCardReview(options = {}) {
      reviewedBusinessCardContacts = [];
      businessCardAnalysisFileSignature = '';
      renderBusinessCardReview();
      if (!options.silent && !suppressDraftAutosave) scheduleDraftSave();
    }

        async function handleBusinessCardChange() {
      clearBusinessCardReview({ silent: true });
      const file = document.getElementById('fieldBusinessCard').files[0] || null;
      setBusinessCardAnalysisState('', 'hidden');
      updateSubmitButtonLabel();
      scheduleDraftSave();
      if (!file) {
        hideDraftStatus();
        return;
      }
      showDraftStatus('Business-card photo selected. Automatic analysis has started.');
      await analyzeBusinessCardImage(file, true);
    }

    function removeBusinessCardReviewContact(index) {
      reviewedBusinessCardContacts.splice(index, 1);
      reviewedBusinessCardContacts = reviewedBusinessCardContacts.map((contact, contactIndex) => ({ ...contact, cardNumber: contactIndex + 1 }));
      renderBusinessCardReview();
      scheduleDraftSave();
    }

    function addBusinessCardReviewContact() {
      if (reviewedBusinessCardContacts.length >= 10) {
        showModalErr('A maximum of 10 contacts can be reviewed from one photo.');
        return;
      }
      reviewedBusinessCardContacts.push(normalizeReviewedContact({}, reviewedBusinessCardContacts.length));
      renderBusinessCardReview();
      scheduleDraftSave();
    }

    async function reanalyzeBusinessCards() {
      const file = document.getElementById('fieldBusinessCard').files[0] || null;
      if (!file) {
        showModalErr('Please select the business-card photo again before re-analyzing it.');
        return;
      }
      await analyzeBusinessCardImage(file, true);
    }

        async function analyzeBusinessCardImage(file, force = false) {
      if (!file) {
        showModalErr('Please upload one photo or PDF containing the business card or cards.');
        return false;
      }
      const isSupported = String(file.type || '').startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      if (!isSupported) {
        showModalErr('Please upload an image or PDF file.');
        return false;
      }
      if (file.size > 20 * 1024 * 1024) {
        showModalErr('The business-card file is larger than 20 MB. Please use a smaller image or PDF.');
        return false;
      }
      const signature = businessCardFileSignature(file);
      if (!force && signature === businessCardAnalysisFileSignature && reviewedBusinessCardContacts.length) {
        renderBusinessCardReview();
        return true;
      }
      const btn = document.getElementById('submitBtn');
      const errDiv = document.getElementById('modalError');
      businessCardAnalysisInProgress = true;
      btn.disabled = true;
      updateSubmitButtonLabel();
      errDiv.style.display = 'none';
      setBusinessCardAnalysisState('Analyzing the uploaded photo and separating each business card...', 'loading');
      try {
        const fd = new FormData();
        fd.append('businessCard', file);
        fd.append('fileName', file.name || 'business-cards');
        const response = await fetch(BUSINESS_CARD_ANALYSIS_URL, { method: 'POST', body: fd });
        const responseText = await response.text();
        let data = {};
        try { data = responseText ? JSON.parse(responseText) : {}; } catch (e) {}
        if (!response.ok || data.success === false) throw new Error(data.error || data.message || ('Analysis failed with status ' + response.status));
        const contacts = Array.isArray(data.contacts) ? data.contacts.slice(0, 10) : [];
        if (!contacts.length) throw new Error('No business card could be detected clearly. Try a sharper photo with every card fully visible.');
        reviewedBusinessCardContacts = contacts.map((contact, index) => normalizeReviewedContact(contact, index));
        businessCardAnalysisFileSignature = signature;
        renderBusinessCardReview();
        meetingFormDirty = true;
        saveMeetingDraft({ silent: true });
        const reviewCount = reviewedBusinessCardContacts.filter(contact => !reviewedContactStatus(contact).ready).length;
        setBusinessCardAnalysisState(
          reviewedBusinessCardContacts.length + (reviewedBusinessCardContacts.length === 1 ? ' contact detected.' : ' contacts detected.') +
          (reviewCount ? ' Review the highlighted incomplete contacts.' : ' All detected contacts are ready for review and saving.'),
          'done'
        );
        showDraftStatus(
          reviewedBusinessCardContacts.length + (reviewedBusinessCardContacts.length === 1 ? ' business card detected.' : ' business cards detected.') +
          (reviewCount ? ' ' + reviewCount + (reviewCount === 1 ? ' contact requires' : ' contacts require') + ' manual review before saving.' : ' All contacts are ready to save.'),
          reviewCount > 0
        );
        return true;
      } catch (error) {
        clearBusinessCardReview({ silent: true });
        setBusinessCardAnalysisState(error.message || 'The business-card photo could not be analyzed.', 'error');
        showModalErr(error.message || 'The business-card photo could not be analyzed. Please try again.');
        console.error('Business card analysis error:', error);
        return false;
      } finally {
        businessCardAnalysisInProgress = false;
        btn.disabled = false;
        updateSubmitButtonLabel();
      }
    }

    function validateReviewedBusinessCardContacts() {
      if (!reviewedBusinessCardContacts.length) {
        return { ok: false, message: 'Analyze the business-card photo before saving.' };
      }
      const invalid = reviewedBusinessCardContacts
        .map((contact, index) => ({ index, status: reviewedContactStatus(contact) }))
        .filter(entry => !entry.status.ready);
      if (invalid.length) {
        const first = invalid[0];
        return {
          ok: false,
          message: 'Contact ' + (first.index + 1) + ' still requires review: ' + first.status.reasons.join(', ') + '. Correct it or remove it before saving.'
        };
      }
      return { ok: true, message: '' };
    }

    function compactCalendarEvent(ev) {
      if (!ev) return null;
      return {
        id: ev.id || '',
        summary: ev.summary || '',
        start: ev.start || null,
        end: ev.end || null,
        attendees: Array.isArray(ev.attendees) ? ev.attendees : [],
        attachments: Array.isArray(ev.attachments) ? ev.attachments : [],
        description: ev.description || '',
        htmlLink: ev.htmlLink || ''
      };
    }

    function readMeetingDraft() {
      try {
        const raw = sessionStorage.getItem(MEETING_DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (e) {
        return null;
      }
    }

    function clearMeetingDraft() {
      try { sessionStorage.removeItem(MEETING_DRAFT_KEY); } catch (e) {}
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
      meetingFormDirty = false;
      hideDraftStatus();
    }

    function normalizeMeetingActionItem(item = {}, index = 0) {
      return {
        actionItemId: String(item.actionItemId || item.id || crmActionItemId()).trim(),
        action: String(item.action || item.text || item.description || '').trim(),
        owner: String(item.owner || item.assignee || '').trim(),
        dueDate: crmDateInputValue(item.dueDate || item.deadline || ''),
        status: crmNormalizeActionStatus(item.status || 'Open'),
        isActive: item.isActive !== false,
        _index: index
      };
    }

    function meetingActionItemsFromValue(value) {
      if(Array.isArray(value))return value.map(normalizeMeetingActionItem).filter(item=>item.isActive!==false);
      if(value&&typeof value==='object')return [normalizeMeetingActionItem(value,0)];
      return crmIntelActionFragments(value).map((action,index)=>normalizeMeetingActionItem({action,status:'Open'},index));
    }

    function renderMeetingActionItems() {
      const host=document.getElementById('meetingActionItemsBuilder');
      if(!host)return;
      if(!meetingActionItems.length){host.innerHTML='';return;}
      const header='<div class="meeting-action-head-v2"><span>Action</span><span>Owner</span><span>Due date</span><span>Status</span><span></span></div>';
      const rows=meetingActionItems.map((item,index)=>`<div class="meeting-action-row-v2">
        <label data-mobile-label="Action"><textarea aria-label="Action" class="meeting-action-input-v2" oninput="updateMeetingActionItem(${index},'action',this.value)" placeholder="Describe the follow-up">${crmEscape(item.action||'')}</textarea></label>
        <label data-mobile-label="Owner"><input aria-label="Owner" class="meeting-action-input-v2" oninput="updateMeetingActionItem(${index},'owner',this.value)" placeholder="Optional" type="text" value="${crmEscape(item.owner||'')}"/></label>
        <label data-mobile-label="Due date"><input aria-label="Due date" class="meeting-action-input-v2" oninput="updateMeetingActionItem(${index},'dueDate',this.value)" type="date" value="${crmEscape(crmDateInputValue(item.dueDate))}"/></label>
        <label data-mobile-label="Status"><select aria-label="Status" class="meeting-action-input-v2" onchange="updateMeetingActionItem(${index},'status',this.value)">${['Open','In Progress','Completed'].map(status=>`<option value="${status}" ${crmNormalizeActionStatus(item.status)===status?'selected':''}>${status}</option>`).join('')}</select></label>
        <button aria-label="Remove action item" class="meeting-action-remove-v2" onclick="removeMeetingActionItem(${index})" title="Remove action item" type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg></button>
      </div>`).join('');
      host.innerHTML=header+rows;
    }

    function addMeetingActionItem() {
      meetingActionItems.push(normalizeMeetingActionItem({actionItemId:crmActionItemId(),status:'Open'},meetingActionItems.length));
      renderMeetingActionItems();
      scheduleDraftSave();
      requestAnimationFrame(()=>document.querySelector('#meetingActionItemsBuilder .meeting-action-row-v2:last-child textarea')?.focus());
    }

    function updateMeetingActionItem(index,key,value) {
      if(!meetingActionItems[index])return;
      meetingActionItems[index][key]=key==='status'?crmNormalizeActionStatus(value):value;
      scheduleDraftSave();
    }

    function removeMeetingActionItem(index) {
      meetingActionItems.splice(index,1);
      renderMeetingActionItems();
      scheduleDraftSave();
    }

    function validatedMeetingActionItems() {
      const normalized=meetingActionItems.map(normalizeMeetingActionItem).filter(item=>{
        const nonDefaultStatus=crmNormalizeActionStatus(item.status)!=='Open';
        return Boolean(item.action.trim()||item.owner.trim()||item.dueDate.trim()||nonDefaultStatus);
      });
      const invalid=normalized.findIndex(item=>!item.action.trim());
      return {ok:invalid<0,invalidIndex:invalid,items:normalized.map(({_index,...item})=>item)};
    }

    function meetingIntelligenceList(value, maxItems = 8) {
      const source = Array.isArray(value) ? value : String(value || '').split(/[,;|\n]+/);
      const seen = new Set();
      return source.map(item => String(item || '').trim()).filter(item => {
        const key = item.toLowerCase();
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, maxItems);
    }

    function meetingIntelligenceReset(options = {}) {
      meetingIntelligenceState = { rawNotes: '', polishedNotes: '', topics: [], sentiment: '', keywords: [], sourceNotes: '', generatedAt: '' };
      meetingIntelligenceInProgress = false;
      const preview = document.getElementById('meetingIntelligencePreview');
      const chips = document.getElementById('meetingIntelligenceChips');
      const loading = document.getElementById('meetingIntelligenceState');
      const undo = document.getElementById('brainDumpUndoButton');
      const button = document.getElementById('brainDumpButton');
      if (preview) preview.style.display = 'none';
      if (chips) chips.innerHTML = '';
      if (loading) loading.style.display = 'none';
      if (undo) undo.style.display = 'none';
      if (button) { button.disabled = false; button.classList.remove('is-loading'); button.querySelector('span') && (button.querySelector('span').textContent = 'Brain Dump'); }
      if (!options.keepNotes) {
        const notes = document.getElementById('fieldNotes');
        if (notes) notes.value = '';
      }
    }

    function meetingIntelligencePlainText(value) {
      let text = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
      if (!text) return '';

      // Brain Dump is written back into a plain textarea, so Markdown syntax would
      // otherwise appear literally (###, **bold**, etc.). Keep the structure but
      // convert it to clean, copy-ready plain text for email / management updates.
      text = text
        .replace(/^```[^\n]*$/gm, '')
        .replace(/^#{1,6}\s+(.+)$/gm, '$1')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '• ')
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')
        .replace(/__([^_\n]+)__/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 — $2')
        .replace(/^\s*[-*_]{3,}\s*$/gm, '')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,:;!?])/g, '$1$2')
        .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,:;!?])/g, '$1$2')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return text;
    }

    function meetingIntelligenceEscape(value) {
      const div = document.createElement('div');
      div.textContent = String(value || '');
      return div.innerHTML;
    }

    function meetingIntelligenceRender() {
      const preview = document.getElementById('meetingIntelligencePreview');
      const chips = document.getElementById('meetingIntelligenceChips');
      if (!preview || !chips) return;
      const parts = [];
      const sentiment = String(meetingIntelligenceState.sentiment || '').trim();
      if (sentiment) parts.push(`<span class="meeting-intel-chip sentiment sentiment-${meetingIntelligenceEscape(sentiment.toLowerCase().replace(/[^a-z]+/g,'-'))}">${meetingIntelligenceEscape(sentiment)}</span>`);
      meetingIntelligenceState.topics.forEach(topic => parts.push(`<span class="meeting-intel-chip topic">${meetingIntelligenceEscape(topic)}</span>`));
      meetingIntelligenceState.keywords.slice(0,5).forEach(keyword => parts.push(`<span class="meeting-intel-chip keyword">#${meetingIntelligenceEscape(keyword.replace(/^#/,'').trim())}</span>`));
      chips.innerHTML = parts.join('');
      preview.style.display = parts.length ? 'block' : 'none';
    }

    function meetingIntelligenceSetBusy(active, message = 'Analysing meeting notes...') {
      meetingIntelligenceInProgress = Boolean(active);
      const state = document.getElementById('meetingIntelligenceState');
      const msg = document.getElementById('meetingIntelligenceMessage');
      const button = document.getElementById('brainDumpButton');
      if (state) state.style.display = active ? 'flex' : 'none';
      if (msg) msg.textContent = message;
      if (button) {
        button.disabled = Boolean(active);
        button.classList.toggle('is-loading', Boolean(active));
        const label = button.querySelector('span');
        if (label) label.textContent = active ? 'Polishing...' : (meetingIntelligenceState.polishedNotes ? 'Polish again' : 'Brain Dump');
      }
    }

    async function requestMeetingIntelligence(mode = 'classify', options = {}) {
      const notesField = document.getElementById('fieldNotes');
      const notes = String(options.notes ?? notesField?.value ?? '').trim();
      if (!notes) {
        if (!options.silent) showModalErr('Add your meeting notes first, then use Brain Dump.');
        return null;
      }
      if (!currentUser?.getIdToken) {
        if (!options.silent) showModalErr('Your CORE session is not ready. Please sign in again.');
        return null;
      }

      meetingIntelligenceSetBusy(true, mode === 'brain-dump' ? 'Turning rough notes into a management-ready brief...' : 'Classifying topic, sentiment and keywords...');
      try {
        const idToken = await currentUser.getIdToken();
        const payload = {
          idToken,
          mode,
          meetingTitle: currentEvent?.summary || document.getElementById('fieldEventTitle')?.value || '',
          purpose: document.getElementById('fieldPurpose')?.value || '',
          meetingNotes: notes,
          attendees: document.getElementById('fieldAttendees')?.value || ''
        };
        const response = await fetch(MEETING_INTELLIGENCE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (error) {}
        if (!response.ok || data.success === false) throw new Error(data.error || data.message || 'CORE Intelligence is unavailable.');

        const polishedNotes = meetingIntelligencePlainText(data.polishedNotes || data.polished_notes || notes);
        const topics = meetingIntelligenceList(data.topics || data.meetingTopics || '', 5);
        const sentiment = String(data.sentiment || data.meetingSentiment || '').trim();
        const keywords = meetingIntelligenceList(data.keywords || data.meetingKeywords || '', 8);
        const replaceNotes = mode === 'brain-dump' && options.replaceNotes !== false;
        const rawBefore = notes;
        if (replaceNotes && polishedNotes && notesField) notesField.value = polishedNotes;
        const finalNotes = replaceNotes ? polishedNotes : notes;

        meetingIntelligenceState = {
          rawNotes: mode === 'brain-dump' ? rawBefore : (meetingIntelligenceState.rawNotes || ''),
          polishedNotes: mode === 'brain-dump' ? polishedNotes : (meetingIntelligenceState.polishedNotes || ''),
          topics,
          sentiment,
          keywords,
          sourceNotes: finalNotes,
          generatedAt: new Date().toISOString()
        };
        const undo = document.getElementById('brainDumpUndoButton');
        if (undo) undo.style.display = meetingIntelligenceState.rawNotes && meetingIntelligenceState.polishedNotes ? 'inline-flex' : 'none';
        meetingIntelligenceRender();
        if (replaceNotes) {
          meetingFormDirty = true;
          scheduleDraftSave();
        }
        return meetingIntelligenceState;
      } catch (error) {
        console.error('CORE meeting intelligence error:', error);
        if (!options.silent) showModalErr(error.message || 'CORE Intelligence could not process these notes.');
        return null;
      } finally {
        meetingIntelligenceSetBusy(false);
      }
    }

    async function runBrainDump() {
      if (meetingIntelligenceInProgress) return;
      await requestMeetingIntelligence('brain-dump', { replaceNotes: true, silent: false });
    }

    function undoBrainDump() {
      const notesField = document.getElementById('fieldNotes');
      const raw = String(meetingIntelligenceState.rawNotes || '').trim();
      if (!notesField || !raw) return;
      notesField.value = raw;
      meetingIntelligenceState.polishedNotes = '';
      meetingIntelligenceState.sourceNotes = '';
      meetingIntelligenceState.topics = [];
      meetingIntelligenceState.sentiment = '';
      meetingIntelligenceState.keywords = [];
      document.getElementById('brainDumpUndoButton').style.display = 'none';
      meetingIntelligenceRender();
      meetingFormDirty = true;
      scheduleDraftSave();
    }

    function handleMeetingNotesInput() {
      const notes = String(document.getElementById('fieldNotes')?.value || '').trim();
      if (meetingIntelligenceState.sourceNotes && notes !== meetingIntelligenceState.sourceNotes) {
        meetingIntelligenceState.topics = [];
        meetingIntelligenceState.sentiment = '';
        meetingIntelligenceState.keywords = [];
        meetingIntelligenceState.sourceNotes = '';
        meetingIntelligenceRender();
      }
      scheduleDraftSave();
    }

    async function ensureMeetingIntelligence(notes) {
      const clean = String(notes || '').trim();
      if (!clean) return meetingIntelligenceState;
      if (meetingIntelligenceState.sourceNotes === clean && (meetingIntelligenceState.sentiment || meetingIntelligenceState.topics.length || meetingIntelligenceState.keywords.length)) {
        return meetingIntelligenceState;
      }
      return (await requestMeetingIntelligence('classify', { notes: clean, replaceNotes: false, silent: true })) || meetingIntelligenceState;
    }

        function meetingDraftState() {
      const inputMethod = document.querySelector('input[name="contactInputMethod"]:checked')?.value || 'businessCard';
      const selectedFiles = Array.from(document.getElementById('fieldBusinessCard').files || []);
      const meetingDocumentFiles = getMeetingDocuments();
      return {
        version: 6,
        savedAt: Date.now(),
        currentEvent: compactCalendarEvent(currentEvent),
        modalSubtitle: document.getElementById('modalSubtitle').textContent || '',
        eventTitle: document.getElementById('fieldEventTitle').value || '',
        eventDate: document.getElementById('fieldEventDate').value || '',
        eventTime: document.getElementById('fieldEventTime').value || '',
        attendees: document.getElementById('fieldAttendees').value || '',
        inputMethod,
        manualContacts: manualContacts.map((contact,index)=>normalizeManualContact(contact,index)),
        purpose: document.getElementById('fieldPurpose').value || '',
        notes: document.getElementById('fieldNotes').value || '',
        intelligence: meetingIntelligenceState,
        actionItems: meetingActionItems.map(({_index,...item})=>item),
        reviewedBusinessCardContacts: reviewedBusinessCardContacts.map((contact, index) => normalizeReviewedContact(contact, index)),
        businessCardFileNames: selectedFiles.map(file => file.name),
        meetingDocumentFileNames: meetingDocumentFiles.map(file => file.name)
      };
    }

        function hasMeaningfulDraftData(state) {
      if (!state) return false;
      return Boolean([
        state.eventTitle, state.eventDate, state.eventTime, state.attendees,
        state.purpose, state.notes
      ].some(value => String(value || '').trim()) ||
      (Array.isArray(state.actionItems) && state.actionItems.some(item => String(item?.action || '').trim())) ||
      (Array.isArray(state.manualContacts) && state.manualContacts.some(contact => Object.values(contact || {}).some(value => String(value || '').trim()))) ||
      (Array.isArray(state.reviewedBusinessCardContacts) && state.reviewedBusinessCardContacts.length) ||
      (Array.isArray(state.businessCardFileNames) && state.businessCardFileNames.length) ||
      (Array.isArray(state.meetingDocumentFileNames) && state.meetingDocumentFileNames.length));
    }

    function formatDraftTime(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString('en-MY', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      } catch (e) {
        return '';
      }
    }

    function showDraftStatus(message, warning = false) {
      const el = document.getElementById('draftStatus');
      el.textContent = message;
      el.classList.toggle('warning', warning);
      el.classList.add('show');
    }

    function hideDraftStatus() {
      const el = document.getElementById('draftStatus');
      if (!el) return;
      el.textContent = '';
      el.classList.remove('show', 'warning');
    }

    function saveMeetingDraft(options = {}) {
      const state = meetingDraftState();
      const shouldSave = meetingFormDirty || hasMeaningfulDraftData(state);
      if (!shouldSave) return false;

      try {
        sessionStorage.setItem(MEETING_DRAFT_KEY, JSON.stringify(state));
        if (!options.silent) {
          const warnings = [];
          if (state.businessCardFileNames.length && !(Array.isArray(state.reviewedBusinessCardContacts) && state.reviewedBusinessCardContacts.length)) warnings.push('business card');
          if (Array.isArray(state.meetingDocumentFileNames) && state.meetingDocumentFileNames.length) warnings.push('supporting PDFs');
          const fileWarning = warnings.length
            ? ' Please select the ' + warnings.join(' and ') + ' again after reopening.'
            : '';
          showDraftStatus('Temporary draft saved at ' + formatDraftTime(state.savedAt) + '.' + fileWarning, Boolean(fileWarning));
        }
        return true;
      } catch (e) {
        if (!options.silent) {
          showDraftStatus('The browser could not save this temporary draft. Keep the form open until it is submitted.', true);
        }
        return false;
      }
    }

    function scheduleDraftSave() {
      if (suppressDraftAutosave) return;
      meetingFormDirty = true;
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(() => saveMeetingDraft({ silent: true }), 450);
    }

        function restoreMeetingDraft(draft) {
      if (!draft) return false;
      suppressDraftAutosave = true;
      resetModal();
      currentEvent = draft.currentEvent || null;
      renderCalendarAttachments();
      document.getElementById('fieldEventTitle').value = draft.eventTitle || draft.currentEvent?.summary || '';
      document.getElementById('fieldEventDate').value = draft.eventDate || '';
      document.getElementById('fieldEventTime').value = draft.eventTime || '';
      document.getElementById('fieldAttendees').value = draft.attendees || '';
      document.getElementById('modalSubtitle').textContent = draft.modalSubtitle || draft.eventTitle || 'Draft meeting entry';
      const method = draft.inputMethod === 'manual' ? 'manual' : 'businessCard';
      document.getElementById(method === 'manual' ? 'methodManual' : 'methodBusinessCard').checked = true;
      document.getElementById('fieldPurpose').value = draft.purpose || '';
      document.getElementById('fieldNotes').value = draft.notes || '';
      meetingIntelligenceState = draft.intelligence && typeof draft.intelligence === 'object'
        ? { rawNotes:String(draft.intelligence.rawNotes||''), polishedNotes:String(draft.intelligence.polishedNotes||''), topics:meetingIntelligenceList(draft.intelligence.topics||'',5), sentiment:String(draft.intelligence.sentiment||''), keywords:meetingIntelligenceList(draft.intelligence.keywords||'',8), sourceNotes:String(draft.intelligence.sourceNotes||''), generatedAt:String(draft.intelligence.generatedAt||'') }
        : { rawNotes:'', polishedNotes:'', topics:[], sentiment:'', keywords:[], sourceNotes:'', generatedAt:'' };
      meetingIntelligenceRender();
      const brainUndo = document.getElementById('brainDumpUndoButton');
      if (brainUndo) brainUndo.style.display = meetingIntelligenceState.rawNotes && meetingIntelligenceState.polishedNotes ? 'inline-flex' : 'none';
      meetingActionItems = meetingActionItemsFromValue(draft.actionItems || []);
      renderMeetingActionItems();
      manualContacts = Array.isArray(draft.manualContacts) && draft.manualContacts.length
        ? draft.manualContacts.slice(0,10).map((contact,index)=>normalizeManualContact(contact,index))
        : [normalizeManualContact({},0)];
      reviewedBusinessCardContacts = Array.isArray(draft.reviewedBusinessCardContacts)
        ? draft.reviewedBusinessCardContacts.slice(0, 10).map((contact, index) => normalizeReviewedContact(contact, index))
        : [];
      businessCardAnalysisFileSignature = '';
      setContactInputMethod(method, false);
      renderManualContacts();
      renderBusinessCardReview();
      document.getElementById('fieldBusinessCard').value = '';
      document.getElementById('fieldMeetingDocument').value = '';
      updateMeetingDocumentState();
      setBusinessCardAnalysisState('', 'hidden');
      suppressDraftAutosave = false;
      meetingFormDirty = true;
      const fileNames = Array.isArray(draft.businessCardFileNames) ? draft.businessCardFileNames : [];
      const restoreMessages = [];
      if (fileNames.length && !reviewedBusinessCardContacts.length) restoreMessages.push('business card: ' + fileNames.join(', '));
      const documentFileNames = Array.isArray(draft.meetingDocumentFileNames) ? draft.meetingDocumentFileNames : (draft.meetingDocumentFileName ? [draft.meetingDocumentFileName] : []);
      if (documentFileNames.length) restoreMessages.push('supporting PDFs: ' + documentFileNames.join(', '));
      if (restoreMessages.length) showDraftStatus('Draft restored. Please select the ' + restoreMessages.join(' and ') + ' again.', true);
      else if (method === 'manual') showDraftStatus(manualContacts.length + (manualContacts.length === 1 ? ' manual contact restored.' : ' manual contacts restored.'));
      else if (reviewedBusinessCardContacts.length) showDraftStatus(reviewedBusinessCardContacts.length + (reviewedBusinessCardContacts.length === 1 ? ' reviewed contact restored.' : ' reviewed contacts restored.'));
      else showDraftStatus('Temporary draft restored from this browser tab.');
      updateSubmitButtonLabel();
      return true;
    }

    function meetingPurposeFromCalendarDescription(event) {
      const description = String(event?.description || '').trim();
      if (!description) return '';
      // Calendar descriptions can contain HTML, meeting links and boilerplate.
      // Reuse the display sanitiser so Purpose of Meeting receives readable text
      // while remaining editable by the user before saving.
      const cleaned = dashboardCleanDisplayText(description, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return '';
      return cleaned.length > 600 ? cleaned.slice(0, 597).trimEnd() + '…' : cleaned;
    }

    function showMeetingModal() {
      document.querySelector('#meetingModal .meeting-workspace-card')?.classList.remove('success-mode');
      document.getElementById('modalSuccess').style.display = 'none';
      document.getElementById('modalSuccessMessage').textContent = 'Meeting details have been saved to CORE.';
      document.getElementById('modalForm').style.display = 'flex';
      document.getElementById('meetingModal').style.display = 'flex';
    }

    function openEventModal(key) {
      const savedDraft = readMeetingDraft();
      document.getElementById('dayDetailModal').style.display = 'none';
      showMeetingModal();

      if (savedDraft && restoreMeetingDraft(savedDraft)) return;

      const ev = window._eventsCache[key];
      currentEvent = ev;
      resetModal();
      renderCalendarAttachments();
      const start = ev?.start?.dateTime || ev?.start?.date || '';
      const others = (ev?.attendees || []).filter(a => !a.self).map(a => a.displayName || a.email).join(', ');
      document.getElementById('fieldEventTitle').value = ev?.summary || '';
      setMeetingDateTimeFields(start);
      document.getElementById('fieldAttendees').value = others;
      const calendarPurpose = meetingPurposeFromCalendarDescription(ev);
      if (calendarPurpose) document.getElementById('fieldPurpose').value = calendarPurpose;
      document.getElementById('modalSubtitle').textContent = ev?.summary || 'New Meeting Entry';
      meetingFormDirty = false;
    }

    function openManualModal() {
      const savedDraft = readMeetingDraft();
      showMeetingModal();

      if (savedDraft && restoreMeetingDraft(savedDraft)) return;

      currentEvent = null;
      resetModal();
      document.getElementById('fieldEventTitle').value = '';
      clearMeetingDateTimeFields();
      document.getElementById('fieldAttendees').value = '';
      document.getElementById('modalSubtitle').textContent = 'Fill in the details below';
      meetingFormDirty = false;
    }

        function resetModal() {
      const previousSuppress = suppressDraftAutosave;
      suppressDraftAutosave = true;
      document.getElementById('fieldPurpose').value = '';
      document.getElementById('fieldNotes').value = '';
      meetingIntelligenceReset({ keepNotes: true });
      meetingActionItems = [];
      renderMeetingActionItems();
      document.getElementById('fieldBusinessCard').value = '';
      clearBusinessCardReview({ silent: true });
      setBusinessCardAnalysisState('', 'hidden');
      document.getElementById('fieldMeetingDocument').value = '';
      updateMeetingDocumentState();
      renderCalendarAttachments([]);
      manualContacts = [normalizeManualContact({},0)];
      renderManualContacts();
      document.getElementById('methodBusinessCard').checked = true;
      setContactInputMethod('businessCard', false);
      document.getElementById('modalError').style.display = 'none';
      document.querySelector('#meetingModal .meeting-workspace-card')?.classList.remove('success-mode');
      document.getElementById('modalSuccess').style.display = 'none';
      document.getElementById('modalForm').style.display = 'flex';
      const btn = document.getElementById('submitBtn');
      btn.disabled = false;
      btn.textContent = 'Save Context to CORE';
      hideDraftStatus();
      meetingFormDirty = false;
      suppressDraftAutosave = previousSuppress;
    }

        function setContactInputMethod(method, clearOpposite = true) {
      const isManual = method === 'manual';
      document.getElementById('businessCardSection').style.display = isManual ? 'none' : 'block';
      document.getElementById('manualContactSection').style.display = isManual ? 'block' : 'none';
      if (isManual && !manualContacts.length) manualContacts = [normalizeManualContact({},0)];
      renderManualContacts();
      updateSubmitButtonLabel();
      if (!suppressDraftAutosave) scheduleDraftSave();
    }

    function closeMeetingModalOnly() {
      document.getElementById('meetingModal').style.display = 'none';
      document.getElementById('draftCloseModal').style.display = 'none';
      currentEvent = null;
    }

    function requestCloseMeetingModal() {
      if (document.getElementById('modalSuccess').style.display === 'block') {
        finishSuccessAndClose();
        return;
      }

      const draft = meetingDraftState();
      const hasData = meetingFormDirty || hasMeaningfulDraftData(draft) || Boolean(readMeetingDraft());

      if (!hasData) {
        closeMeetingModalOnly();
        return;
      }

      const hasSelectedFiles = (Array.from(document.getElementById('fieldBusinessCard').files || []).length > 0 && !reviewedBusinessCardContacts.length) ||
        Boolean(document.getElementById('fieldMeetingDocument')?.files?.length) ||
        (Array.isArray(draft.businessCardFileNames) && draft.businessCardFileNames.length > 0) ||
        (Array.isArray(draft.meetingDocumentFileNames) && draft.meetingDocumentFileNames.length > 0) ||
        Boolean(draft.meetingDocumentFileName);
      document.getElementById('draftFileNotice').style.display = hasSelectedFiles ? 'block' : 'none';
      document.getElementById('draftCloseModal').style.display = 'flex';
    }

    function saveDraftAndClose() {
      saveMeetingDraft({ silent: false });
      closeMeetingModalOnly();
    }

    function discardDraftAndClose() {
      clearMeetingDraft();
      resetModal();
      closeMeetingModalOnly();
    }

    function continueEditingMeeting() {
      document.getElementById('draftCloseModal').style.display = 'none';
    }

    function finishSuccessAndClose() {
      clearMeetingDraft();
      resetModal();
      closeMeetingModalOnly();
    }

        async function submitMeeting() {
      const btn = document.getElementById('submitBtn');
      const errDiv = document.getElementById('modalError');
      const inputMethod = document.querySelector('input[name="contactInputMethod"]:checked')?.value || 'businessCard';
      if (businessCardAnalysisInProgress) {
        showModalErr('Business-card analysis is still running. Please wait a moment.');
        return;
      }
      const purpose = document.getElementById('fieldPurpose').value.trim();
      const notes = document.getElementById('fieldNotes').value.trim();
      const actionValidation = validatedMeetingActionItems();
      const actionItems = actionValidation.items;
      const meetingDocuments = getMeetingDocuments();
      const calendarAttachments = getCalendarAttachments();
      const eventDateOnly = getMeetingDateOnly();
      const eventTimeOnly = getMeetingTimeOnly();
      const eventDateValue = buildEventDateValueForSubmit();
      if (!purpose) { showModalErr('Please enter the purpose of meeting.'); return; }
      if (!notes) { showModalErr('Please enter meeting notes.'); return; }
      if (!actionValidation.ok) { showModalErr('Action item ' + (actionValidation.invalidIndex + 1) + ' requires an Action value.'); return; }
      if (eventTimeOnly && !eventDateOnly) { showModalErr('Please select the meeting date before entering the time.'); return; }
      const validation = inputMethod === 'manual' ? validateManualContacts() : validateReviewedBusinessCardContacts();
      if (!validation.ok) { showModalErr(validation.message); return; }
      if (meetingDocuments.length > 5) { showModalErr('You can attach a maximum of 5 supporting PDFs.'); return; }
      for (const documentFile of meetingDocuments) {
        const isPdf = documentFile.type === 'application/pdf' || /\.pdf$/i.test(documentFile.name || '');
        if (!isPdf) { showModalErr(documentFile.name + ' is not a PDF file.'); return; }
        if (documentFile.size > 10 * 1024 * 1024) { showModalErr(documentFile.name + ' is larger than 10 MB. Please remove or replace it.'); return; }
      }
      const contactsToSave = (inputMethod === 'manual' ? manualContacts : reviewedBusinessCardContacts)
        .map((contact,index)=>normalizeReviewedContact({ ...contact, source: inputMethod },index));
      btn.disabled = true;
      btn.textContent = 'Analysing meeting intelligence...';
      const intelligence = await ensureMeetingIntelligence(notes);
      btn.textContent = 'Saving ' + contactsToSave.length + (contactsToSave.length === 1 ? ' Contact...' : ' Contacts...');
      errDiv.style.display = 'none';
      saveMeetingDraft({ silent: true });
      const fd = new FormData();
      fd.append('uploaderName', currentUser.displayName || '');
      fd.append('uploaderEmail', currentUser.email || '');
      fd.append('purpose', purpose);
      fd.append('meetingNotes', notes);
      fd.append('meetingTopics', JSON.stringify(meetingIntelligenceList(intelligence?.topics || meetingIntelligenceState.topics || '', 5)));
      fd.append('meetingSentiment', String(intelligence?.sentiment || meetingIntelligenceState.sentiment || ''));
      fd.append('meetingKeywords', JSON.stringify(meetingIntelligenceList(intelligence?.keywords || meetingIntelligenceState.keywords || '', 8)));
      fd.append('actionItems', JSON.stringify(actionItems));
      fd.append('eventTitle', currentEvent?.summary || document.getElementById('fieldEventTitle').value || '');
      fd.append('eventDate', eventDateValue);
      fd.append('eventDateOnly', eventDateOnly);
      fd.append('eventTime', eventTimeOnly);
      const attendeeSource=(currentEvent?.attendees || []).filter(a => !a.self).map(a => a.displayName || a.email).join(', ') || document.getElementById('fieldAttendees').value || '';
      fd.append('attendees', crmCleanAttendeeText(attendeeSource, contactsToSave.map(contact=>contact.companyName)));
      fd.append('calendarAttachments', JSON.stringify(calendarAttachments));
      fd.append('calendarAttachmentCount', String(calendarAttachments.length));
      fd.append('inputMethod', 'reviewedContacts');
      fd.append('contactSource', inputMethod);
      meetingDocuments.forEach((documentFile, index) => fd.append('meetingDocument_' + (index + 1), documentFile));
      fd.append('meetingDocumentCount', String(meetingDocuments.length));
      fd.append('reviewedContacts', JSON.stringify(contactsToSave));
      fd.append('reviewedContactCount', String(contactsToSave.length));
      fd.append('manualPersonName', '');
      fd.append('manualCompanyName', '');
      fd.append('manualEmail', '');
      fd.append('manualPhone', '');
      try {
        const res = await fetch('https://mrantidata.app.n8n.cloud/webhook/submit-meeting-test', { method: 'POST', body: fd });
        const responseText = await res.text();
        let responseData = {};
        try { responseData = responseText ? JSON.parse(responseText) : {}; } catch (e) {}
        if (res.ok || res.status === 200) {
          if (responseData.success === false) throw new Error(responseData.error || responseData.message || 'CORE did not complete the submission.');
          const expectedActionItemWrites = actionItems.length * contactsToSave.length;
          const actionItemsWritten = Number(responseData.actionItemsWritten || 0);
          if (expectedActionItemWrites > 0 && actionItemsWritten < expectedActionItemWrites) {
            throw new Error(`Structured Action Items were not saved completely (${actionItemsWritten} of ${expectedActionItemWrites} confirmed).`);
          }
          clearMeetingDraft();
          const uploaded = Number(responseData.uploadedDocuments || 0);
          const linkedCalendarAttachments = Number(responseData.linkedCalendarAttachments || calendarAttachments.length || 0);
          const failed = Number(responseData.failedDocuments || 0);
          const failedNames = Array.isArray(responseData.failedFileNames) ? responseData.failedFileNames : [];
          const savedContacts = Number(responseData.savedContacts || contactsToSave.length);
          let successMessage = savedContacts + (savedContacts === 1 ? ' context record was' : ' context records were') + ' saved to CORE.';
          if (linkedCalendarAttachments > 0) successMessage += ' ' + linkedCalendarAttachments + (linkedCalendarAttachments === 1 ? ' Calendar attachment was linked.' : ' Calendar attachments were linked.');
          if (meetingDocuments.length && failed === 0) successMessage += ' ' + uploaded + (uploaded === 1 ? ' PDF was' : ' PDFs were') + ' uploaded successfully.';
          else if (meetingDocuments.length && failed > 0) {
            successMessage += ' ' + uploaded + ' of ' + meetingDocuments.length + ' PDFs uploaded successfully.';
            if (failedNames.length) successMessage += ' Could not upload: ' + failedNames.join(', ') + '.';
          }
          document.getElementById('modalSuccessMessage').textContent = successMessage;
          document.getElementById('modalForm').style.display = 'none';
          document.querySelector('#meetingModal .meeting-workspace-card')?.classList.add('success-mode');
          document.getElementById('modalSuccess').style.display = 'flex';
        } else throw new Error(responseData.error || responseData.message || `Server error ${res.status}`);
      } catch (e) {
        showModalErr('Failed to save. Your temporary draft is still available. ' + (e.message || 'Please try again.'));
        showDraftStatus('Temporary draft retained after the failed submission.', true);
        btn.disabled = false;
        updateSubmitButtonLabel();
        console.error(e);
      }
    }

    function showModalErr(msg) {
      const el = document.getElementById('modalError');
      el.textContent = msg; el.style.display = 'block';
    }

    manualContacts = [normalizeManualContact({},0)];
    renderManualContacts();

    // Auto-save all typed meeting fields after a short pause.
    const meetingForm = document.getElementById('modalForm');
    meetingForm.addEventListener('input', scheduleDraftSave);
    meetingForm.addEventListener('change', scheduleDraftSave);

    // Clicking outside the meeting form does nothing, preventing accidental closure.
    // The calendar day-detail popup may still be dismissed by clicking its backdrop.
    document.getElementById('dayDetailModal').addEventListener('click', function(e) {
      if (e.target === this) closeDayDetail();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape') return;

      if (document.getElementById('draftCloseModal').style.display === 'flex') {
        continueEditingMeeting();
        return;
      }

      if (document.getElementById('meetingModal').style.display === 'flex') {
        requestCloseMeetingModal();
        return;
      }

      if (document.getElementById('dayDetailModal').style.display === 'flex') {
        closeDayDetail();
      }
    });
