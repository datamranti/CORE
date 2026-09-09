// ── AVATAR (initials fallback, colored per person like Google/Slack do) ──
    // Every user gets a consistent color derived from their email, not just
    // one flat blue for everyone - makes it easier to tell people apart at
    // a glance, same idea as Google's account avatars.
    const AVATAR_PALETTE = [
      { bg: '#dbeafe', text: '#2563eb' }, // blue
      { bg: '#ede9fe', text: '#7c3aed' }, // violet
      { bg: '#eff6ff', text: '#0891b2' }, // cyan
      { bg: '#dbeafe', text: '#2563eb' }, // emerald
      { bg: '#fef3c7', text: '#b45309' }, // amber
      { bg: '#fee2e2', text: '#dc2626' }, // red
      { bg: '#e0e7ff', text: '#4338ca' }, // indigo
      { bg: '#dbeafe', text: '#2563eb' }  // teal
    ];

    function getAvatarColor(seed) {
      const s = String(seed || 'user');
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
      }
      return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
    }

    function setUserAvatar(user, firstName) {
      const initial = firstName ? firstName[0].toUpperCase() : '?';
      const color = getAvatarColor(user.email || user.displayName || firstName);
      const photoEl = document.getElementById('userPhoto');
      const initialEl = document.getElementById('userInitial');

      // Set the initial + color up front, regardless of whether a photo
      // exists. If the photo fails to load later, the fallback that
      // appears already has the right letter and color on it.
      initialEl.textContent = initial;
      initialEl.style.background = color.bg;
      initialEl.style.color = color.text;

      if (user.photoURL) {
        photoEl.src = user.photoURL;
        photoEl.style.display = 'block';
        initialEl.style.display = 'none';
      } else {
        photoEl.style.display = 'none';
        initialEl.style.display = 'flex';
      }
    }

    // Resolve a promptless returning-user Calendar redirect once, before the
    // restored Firebase session performs its normal application bootstrap.
    const calendarRedirectResultPromise = auth.getRedirectResult()
      .then(result => {
        const token = getAccessTokenFromResult(result || {});
        if (token) {
          googleAccessToken = token;
          saveAccessToken(token);
          try { localStorage.removeItem(CALENDAR_AUTO_REAUTH_KEY); } catch (error) {}
        }
        return token;
      })
      .catch(error => {
        if (!['auth/no-auth-event', 'auth/interaction-required', 'auth/login-required'].includes(error?.code)) {
          console.warn('Returning-user Calendar reconnect was not completed:', error?.code || error?.message || error);
        }
        return null;
      });

    function shouldAttemptCalendarAutoReconnect() {
      if (!currentUser || googleAccessToken) return false;
      try {
        if (sessionStorage.getItem(CALENDAR_AUTO_REAUTH_KEY) === 'attempted') return false;
        const previousAttempt = Number(localStorage.getItem(CALENDAR_AUTO_REAUTH_KEY) || 0);
        return !previousAttempt || Date.now() - previousAttempt >= CALENDAR_AUTO_REAUTH_COOLDOWN_MS;
      } catch (error) {
        return false;
      }
    }

    function scheduleCalendarAutoReconnect() {
      if (!shouldAttemptCalendarAutoReconnect()) return;
      try {
        sessionStorage.setItem(CALENDAR_AUTO_REAUTH_KEY, 'attempted');
        localStorage.setItem(CALENDAR_AUTO_REAUTH_KEY, String(Date.now()));
      } catch (error) {
        return;
      }
      setTimeout(() => {
        if (!currentUser || googleAccessToken) return;
        provider = buildGoogleProvider('none');
        currentUser.reauthenticateWithRedirect(provider).catch(error => {
          console.warn('Automatic Calendar reconnect requires user interaction:', error?.code || error?.message || error);
          setCalendarStatus('Saved meetings shown. Select Connect Calendar to refresh.');
        });
      }, 350);
    }

    // ── AUTH ──
    auth.onAuthStateChanged(async user => {
      if (user) {
        const domain = user.email.split('@')[1];
        if (domain !== ALLOWED_DOMAIN) {
          auth.signOut();
          showError('Access restricted to @mranti.my accounts only.');
          return;
        }
        currentUser = user;
        const firstName = user.displayName ? user.displayName.split(' ')[0] : 'there';
        document.body.classList.add('crm-authenticated');
        document.getElementById('loginScreen').style.display = 'none';

        document.getElementById('userName').textContent = user.displayName || '';
        document.getElementById('userEmail').textContent = user.email || '';
        document.getElementById('welcomeMsg').textContent = 'Welcome, ' + firstName;
        setUserAvatar(user, firstName);
        systemSyncUserIdentity(user, firstName);
        showAuthenticatedRoute();
        hideError();
        restoreCalendarCache(calendarViewDate);
        renderCalendarGrid();
        await calendarRedirectResultPromise;
        if (!googleAccessToken) {
          const savedToken = loadSavedAccessToken();
          if (savedToken) googleAccessToken = savedToken;
        }
        if (googleAccessToken) {
          loadCalendar({ refreshIfStale: true });
        } else {
          const hasCachedMeetings = Boolean(monthCache[getMonthKey(calendarViewDate)]);
          setCalendarStatus(hasCachedMeetings ? 'Showing saved meetings while Calendar reconnects…' : 'Reconnecting Calendar…');
          scheduleCalendarAutoReconnect();
        }
      } else {
        currentUser = null;
        googleAccessToken = null;
        document.body.classList.remove('crm-authenticated');
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('appScreen').style.display = 'none';
        document.getElementById('appScreen').setAttribute('aria-hidden', 'true');
      }
    });

    function signIn() {
      // First sign-in requests Calendar permission once. After that, Sync reuses the token.
      provider = buildGoogleProvider(true);

      auth.signInWithPopup(provider).then(result => {
        const token = getAccessTokenFromResult(result);

        if (!token) {
          throw new Error('Google login worked, but no Calendar access token was returned.');
        }

        googleAccessToken = token;
        saveAccessToken(token);
        loadCalendar({ force: true });

      }).catch(err => {
        if (err.code === 'auth/popup-closed-by-user') return;

        showError('Sign in failed: ' + (err.message || err.code || 'Please try again.'));
        console.error('Sign-in error:', err);
      });
    }

    function doSignOut() {
      googleAccessToken = null;
      clearSavedAccessToken();
      clearMeetingDraft();
      calendarEventsByDate = {};
      monthCache = {};
      monthCacheTimestamps = {};
      selectedDateKey = null;
      closeDayDetail();
      auth.signOut();
    }

    function showError(msg) {
      const el = document.getElementById('errorMsg');
      el.textContent = msg; el.style.display = 'block';
    }
    function hideError() {
      document.getElementById('errorMsg').style.display = 'none';
    }
