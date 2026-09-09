(function initialiseCoreSearch(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CoreSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoreSearch() {
  'use strict';

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(value) {
    const normalized = normalize(value);
    return normalized ? normalized.split(' ') : [];
  }

  function tokenPrefixMatch(query, candidate) {
    const queryTokens = tokens(query);
    const candidateTokens = tokens(candidate);
    if (!queryTokens.length || !candidateTokens.length) return false;
    return queryTokens.every(queryToken => candidateTokens.some(candidateToken => candidateToken.startsWith(queryToken)));
  }

  function exactMatch(query, candidate) {
    const normalizedQuery = normalize(query);
    return Boolean(normalizedQuery && normalizedQuery === normalize(candidate));
  }

  function emailOrDomainMatch(query, email) {
    const rawQuery = String(query || '').trim().toLowerCase();
    const rawEmail = String(email || '').trim().toLowerCase();
    if (!rawQuery || !rawEmail) return false;
    if (rawEmail === rawQuery || rawEmail.startsWith(rawQuery)) return true;
    const domain = rawEmail.split('@')[1] || '';
    return domain === rawQuery || domain.startsWith(rawQuery) || tokenPrefixMatch(rawQuery, rawEmail);
  }

  function partialPhoneMatch(query, phone) {
    const digits = String(query || '').replace(/\D/g, '');
    const phoneDigits = String(phone || '').replace(/\D/g, '');
    return Boolean(digits.length >= 3 && phoneDigits.includes(digits));
  }

  function validDateScore(value) {
    if (!value) return 0;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
    const withoutWeekday = String(value).replace(/^[A-Za-z]{3,9},\s*/, '');
    const fallback = new Date(withoutWeekday);
    return Number.isNaN(fallback.getTime()) ? 0 : fallback.getTime();
  }

  function recordOrderingScore(record) {
    const value = record || {};
    const meetingScore = [value.meetingDate, value.startDateTime, value.startTime].map(validDateScore).find(Boolean) || 0;
    const inputScore = [value.timeUploaded, value.submittedAt, value.createdAt, value.createdDate, value.lastUpdated].map(validDateScore).find(Boolean) || 0;
    return meetingScore || inputScore;
  }

  function recordScore(record, query) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return 1;
    const value = record || {};
    const names = [value.personName, value.companyName, value.organisation, value.organization];
    const primary = names.filter(Boolean);
    if (primary.some(candidate => exactMatch(normalizedQuery, candidate))) return 500;
    if (primary.some(candidate => tokenPrefixMatch(normalizedQuery, candidate))) return 400;
    if (emailOrDomainMatch(query, value.email)) return 320;
    if (partialPhoneMatch(query, value.phone || value.contactNumber)) return 300;

    const usefulContext = [
      value.jobTitle, value.meetingTitle, value.attendees, value.reason,
      value.meetingNotes, value.uploaderName, value.uploaderEmail,
      Array.isArray(value.actionItems) ? value.actionItems.map(item => typeof item === 'string' ? item : [item?.action, item?.owner, item?.status].join(' ')).join(' ') : value.actionItems,
      Array.isArray(value.meetingDocuments) ? value.meetingDocuments.map(document => document?.name || '').join(' ') : ''
    ];
    if (usefulContext.some(candidate => tokenPrefixMatch(normalizedQuery, candidate))) return 200;
    if (tokenPrefixMatch(normalizedQuery, value.searchIndex)) return 100;
    return 0;
  }

  function preferredResultFloor(scores) {
    const positive = (Array.isArray(scores) ? scores : [])
      .map(Number)
      .filter(score => Number.isFinite(score) && score > 0);
    if (!positive.length) return 0;
    const maxScore = Math.max(...positive);
    if (maxScore >= 400) return 400;
    if (maxScore >= 300) return 300;
    if (maxScore >= 200) return 200;
    if (maxScore >= 100) return 100;
    return 1;
  }

  function graphScore(record, query, fullCompanyName) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return 1;
    const value = record || {};
    const company = typeof fullCompanyName === 'function' ? fullCompanyName(value) : (value.companyFull || value.company || value.clientShort);
    const primary = [value.person, value.company, value.companyFull, company, value.clientShort, value.uploader, value.uploaderShort];
    if (primary.some(candidate => exactMatch(normalizedQuery, candidate))) return 500;
    if (primary.some(candidate => tokenPrefixMatch(normalizedQuery, candidate))) return 400;
    if (emailOrDomainMatch(query, value.email) || emailOrDomainMatch(query, value.uploaderEmail)) return 320;
    if (partialPhoneMatch(query, value.phone)) return 300;
    if ([value.reason, value.meetingTitle, value.notes, value.actionItems].some(candidate => tokenPrefixMatch(normalizedQuery, candidate))) return 200;
    if (tokenPrefixMatch(normalizedQuery, value.searchIndex)) return 100;
    return 0;
  }

  return Object.freeze({ normalize, tokens, tokenPrefixMatch, exactMatch, emailOrDomainMatch, partialPhoneMatch, validDateScore, recordOrderingScore, recordScore, preferredResultFloor, graphScore });
});
