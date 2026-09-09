console.log('MRANTI CORE Batch 1 loaded');
    const firebaseConfig = {
      apiKey: "AIzaSyDXz0gL67r9BafTg8nL6VdHYdw1tfcxhto",
      authDomain: "mranticrm.firebaseapp.com",
      projectId: "mranticrm",
      storageBucket: "mranticrm.firebasestorage.app",
      messagingSenderId: "314966643466",
      appId: "1:314966643466:web:aff9ad95262d1df8f960f3"
    };

    const ALLOWED_DOMAIN = "mranti.my";

    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();

    // Prevent Chrome from restoring an old vertical scroll position when this
    // GitHub Pages URL is reloaded after a deployment or Firebase auth refresh.
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    function resetDashboardScrollPosition() {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }

    window.addEventListener('pageshow', () => {
      resetDashboardScrollPosition();
    });

    function buildGoogleProvider(promptMode = 'default') {
      const p = new firebase.auth.GoogleAuthProvider();

      p.addScope('email');
      p.addScope('profile');
      p.addScope('https://www.googleapis.com/auth/calendar.readonly');

      const params = {
        hd: ALLOWED_DOMAIN,
        include_granted_scopes: 'true'
      };

      // Only force the permission screen when the user first signs in or when the token is missing.
      // This avoids asking for Calendar access every time the user presses Sync.
      if (promptMode === true || promptMode === 'consent') {
        params.prompt = 'consent';
      } else if (promptMode === 'none') {
        params.prompt = 'none';
      }

      p.setCustomParameters(params);
      return p;
    }

    let provider = buildGoogleProvider(false);

    function getAccessTokenFromResult(result) {
      let token = null;

      try {
        const cred = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
        if (cred && cred.accessToken) {
          token = cred.accessToken;
        }
      } catch (e) {
        console.warn('credentialFromResult failed:', e);
      }

      if (!token && result.credential && result.credential.accessToken) {
        token = result.credential.accessToken;
      }

      if (!token && result._tokenResponse && result._tokenResponse.oauthAccessToken) {
        token = result._tokenResponse.oauthAccessToken;
      }

      if (!token && result.user && result.user.stsTokenManager && result.user.stsTokenManager.accessToken) {
        console.warn('Firebase ID token exists, but this is not the Google Calendar OAuth token.');
      }

      return token;
    }

    // ── ACCESS TOKEN PERSISTENCE ──
    // Firebase keeps the user signed in across reloads, but the Google Calendar
    // access token it hands back is only ever held in a JS variable, so it is
    // lost every time this page reloads.
    //
    // sessionStorage was tried first, but it's scoped to a single tab and only
    // gets copied to a *new* tab when that tab is opened via a plain link click
    // (no rel="noopener"). Closing tabs, reopening the browser, or any other
    // navigation path loses it. Since this token is read-only Calendar access
    // and already self-expires, localStorage is the better fit: it's shared
    // across every tab for this origin and survives closing/reopening the
    // browser. The same TOKEN_MAX_AGE_MS expiry still applies, so it never
    // lives longer than ~50 minutes regardless of storage type - it just
    // isn't artificially tied to one tab anymore.
    const TOKEN_STORAGE_KEY = 'mranti_crm_gcal_token';
    const TOKEN_MAX_AGE_MS = 50 * 60 * 1000; // 50 min safety buffer under Google's ~60 min token lifetime
    const CALENDAR_CACHE_KEY_PREFIX = 'mranti_core_calendar_v1';
    const CALENDAR_CACHE_FRESH_MS = 10 * 60 * 1000;
    const CALENDAR_CACHE_MAX_STALE_MS = 36 * 60 * 60 * 1000;
    const CALENDAR_AUTO_REAUTH_KEY = 'mranti_core_calendar_auto_reauth';
    const CALENDAR_AUTO_REAUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

    function saveAccessToken(token) {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, savedAt: Date.now() }));
      } catch (e) {
        // storage unavailable (private browsing etc.) - falls back to manual sync, no big deal
      }
    }

    function loadSavedAccessToken() {
      try {
        const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (!raw) return null;
        const { token, savedAt } = JSON.parse(raw);
        if (!token || !savedAt) return null;
        if (Date.now() - savedAt > TOKEN_MAX_AGE_MS) return null;
        return token;
      } catch (e) {
        return null;
      }
    }

    function clearSavedAccessToken() {
      try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch (e) {}
    }

    let currentUser = null;
    let googleAccessToken = null;
    let calendarViewDate = new Date();
    calendarViewDate.setDate(1);
    let calendarEventsByDate = {};
    let selectedDateKey = null;
    let monthCache = {};
    let monthCacheTimestamps = {};
    let calendarLoadPromises = {};
    let calendarViewMode = 'month';
    let currentEvent = null;
    let meetingActionItems = [];
    window._eventsCache = {};
    let dashboardExpandedCards = { meetings: false, organisations: false };
    let dashboardSelectedMeetingWeek = Math.min(4, Math.max(0, Math.floor((new Date().getDate() - 1) / 7)));
    let dashboardOrganisationFilter = 'new';
    let dashboardOrganisationSearch = '';
    let dashboardMeetingWeeks = [[], [], [], [], []];
    let dashboardOrganisationRows = [];
    let dashboardOrganisationTotals = { total: 0, fresh: 0, returning: 0 };
    let dashboardExpandedMeetingCard = null;

    // Temporary meeting draft: scoped to this browser tab and cleared when the tab closes.
    const MEETING_DRAFT_KEY = 'mranti_crm_meeting_draft_v6';
    let meetingFormDirty = false;
    let suppressDraftAutosave = false;
    let draftSaveTimer = null;

    const BUSINESS_CARD_ANALYSIS_URL = 'https://mrantidata.app.n8n.cloud/webhook/analyze-business-cards-test';
    let reviewedBusinessCardContacts = [];
    let manualContacts = [];
    let businessCardAnalysisFileSignature = '';
    let businessCardAnalysisInProgress = false;
