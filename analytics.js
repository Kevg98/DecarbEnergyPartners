/* DECARB-GA4-MODULE
 * First-party GA4 loader, consent control, and allowlisted event adapter.
 * Google code is not requested until affirmative analytics consent.
 */
(function () {
  "use strict";

  const GLOBAL_STATE_KEY = "__DECARB_GA4_STATE_V1__";
  const PUBLIC_API_KEY = "DecarbAnalytics";
  const CONSENT_STORAGE_KEY = "decarb.analytics.consent.v1";
  const CONSENT_SCHEMA_VERSION = 1;
  const CONSENT_DURATION_MS = 180 * 24 * 60 * 60 * 1000;
  const MODULE_STYLE_ID = "decarb-analytics-consent-style";

  if (window[GLOBAL_STATE_KEY]) return;

  const HOST_MAP = Object.freeze({
    "www.decarbenergypartners.com": Object.freeze({
      measurementId: "G-L47P585JRP",
      environment: "production"
    })
  });

  // There is no standing test stream. Loopback validation mappings exist only
  // in bounded copies outside the repository. Unknown hosts always no-load.
  const PAGE_MAP = Object.freeze({
    home: Object.freeze({
      location: "https://www.decarbenergypartners.com/",
      title: "Decarb Energy Partners"
    }),
    privacy: Object.freeze({
      location: "https://www.decarbenergypartners.com/privacy.html",
      title: "Privacy Policy | Decarb Energy Partners"
    }),
    search: Object.freeze({
      location: "https://www.decarbenergypartners.com/search.html",
      title: "Search | Decarb Energy Partners"
    }),
    error_404: Object.freeze({
      location: "https://www.decarbenergypartners.com/404.html",
      title: "Page Not Found | Decarb Energy Partners"
    })
  });

  const EVENT_NAMES = new Set([
    "page_view",
    "cta_click",
    "outbound_link_click",
    "document_download_intent",
    "page_not_found",
    "error_recovery_click",
    "brick_breaker_start",
    "brick_breaker_round_complete",
    "brick_breaker_game_over",
    "pagefind_results_rendered",
    "site_search_fallback_click",
    "site_search_result_click"
  ]);

  const CTA_IDS = new Set([
    "general_inquiry",
    "waitlist",
    "biofuel_inquiry",
    "media_inquiry",
    "careers",
    "community",
    "newsletter",
    "learn_more",
    "privacy_question",
    "privacy_request"
  ]);
  const CTA_PLACEMENTS = new Set([
    "header",
    "mobile_menu",
    "hero",
    "technology",
    "biofuel",
    "contact",
    "footer",
    "privacy"
  ]);
  const CTA_DESTINATIONS = new Set(["section", "email", "newsletter"]);
  const OUTBOUND_DOMAINS = new Set([
    "newea.org",
    "whova.com",
    "forgeimpact.org",
    "cbia.com",
    "yaledailynews.com",
    "uconn.edu",
    "climatehaven.tech",
    "yaleventures.thumbraise.com",
    "linkedin.com"
  ]);
  const LINK_CATEGORIES = new Set([
    "conference",
    "event",
    "media",
    "program",
    "ecosystem",
    "social"
  ]);
  const OUTBOUND_PLACEMENTS = new Set(["news", "header", "footer"]);
  const DOCUMENT_IDS = new Set(["newea_2026_program"]);
  const FILE_TYPES = new Set(["pdf"]);
  const RECOVERY_DESTINATIONS = new Set([
    "home",
    "highlights",
    "technology",
    "biofuel",
    "news",
    "contact",
    "privacy"
  ]);
  const RECOVERY_PLACEMENTS = new Set(["header", "body", "footer"]);
  const START_TYPES = new Set(["first", "restart"]);
  const SEARCH_PROVIDERS = new Set(["pagefind"]);
  const RESULT_COUNT_BANDS = new Set(["0", "1", "2_3", "4_plus"]);
  const QUERY_ORIGINS = new Set(["landing", "refinement"]);
  const FALLBACK_PROVIDERS = new Set(["google"]);
  const FALLBACK_REASONS = new Set(["manual", "zero_results", "pagefind_error"]);
  const SEARCH_RESULT_TYPES = new Set(["page", "heading"]);
  const SEARCH_DESTINATION_PAGES = new Set(["home", "privacy", "error_404", "future"]);

  const state = {
    initialized: false,
    consent: "unset",
    hostConfig: null,
    pageContext: null,
    defaultsQueued: false,
    configured: false,
    pageViewSent: false,
    notFoundSent: false,
    scriptInserted: false,
    tagLoaded: false,
    tagFailed: false,
    enabled: false
  };

  Object.defineProperty(window, GLOBAL_STATE_KEY, {
    value: state,
    configurable: false,
    enumerable: false,
    writable: false
  });

  function enumValue(value, allowed, maxLength) {
    if (typeof value !== "string") return null;
    if (value.length < 1 || value.length > maxLength) return null;
    return allowed.has(value) ? value : null;
  }

  function validMeasurementId(value) {
    return typeof value === "string" && /^G-[A-Z0-9]{6,20}$/.test(value);
  }

  function getHostConfig() {
    if (window.location.protocol !== "https:") return null;
    const hostname = String(window.location.hostname || "").toLowerCase();
    const config = HOST_MAP[hostname] || null;
    if (!config || !validMeasurementId(config.measurementId)) return null;
    return config;
  }

  function classifyReferrer() {
    const raw = String(document.referrer || "");
    if (!raw) return "direct";
    try {
      const hostname = new URL(raw).hostname.toLowerCase();
      if (hostname === "decarbenergypartners.com" || hostname.endsWith(".decarbenergypartners.com")) {
        return "internal";
      }
      return "external";
    } catch (_error) {
      return "unknown";
    }
  }

  function sanitizedReferrer() {
    return classifyReferrer() === "internal"
      ? "https://www.decarbenergypartners.com/"
      : "";
  }

  function getPageContext() {
    const pageType = document.body && document.body.dataset
      ? document.body.dataset.analyticsPage
      : "";
    const page = PAGE_MAP[pageType] || null;
    if (!page || !state.hostConfig) return null;
    return Object.freeze({
      page_type: pageType,
      page_location: page.location,
      page_title: page.title,
      page_referrer: sanitizedReferrer(),
      environment: state.hostConfig.environment
    });
  }

  function normalizedSearchTermFromLocation() {
    if (!state.pageContext || state.pageContext.page_type !== "search") return "";
    try {
      return String(new URLSearchParams(window.location.search).get("q") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 120);
    } catch (_error) {
      return "";
    }
  }

  function controlledConfigurationLocation() {
    if (!state.pageContext || state.pageContext.page_type !== "search") {
      return state.pageContext ? state.pageContext.page_location : "";
    }
    const term = normalizedSearchTermFromLocation();
    if (!term) return state.pageContext.page_location;
    const url = new URL(state.pageContext.page_location);
    url.searchParams.set("q", term);
    return url.href;
  }

  function classifyRequestedPath() {
    const path = String(window.location.pathname || "");
    if (!path) return "unknown";
    if (/\.(?:css|js|mjs|json|xml|txt|pdf|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|glb|map)$/i.test(path)) {
      return "asset_like";
    }
    const segments = path.split("/").filter(Boolean);
    return segments.length > 1 ? "nested" : "root";
  }

  function readConsent() {
    try {
      const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!raw) return "unset";
      const saved = JSON.parse(raw);
      const valid = saved
        && saved.schema === CONSENT_SCHEMA_VERSION
        && saved.purpose === "analytics"
        && (saved.state === "granted" || saved.state === "denied")
        && Number.isFinite(saved.expires_at);
      if (!valid || saved.expires_at <= Date.now()) {
        window.localStorage.removeItem(CONSENT_STORAGE_KEY);
        return "unset";
      }
      return saved.state;
    } catch (_error) {
      return "unset";
    }
  }

  function writeConsent(choice) {
    const value = {
      schema: CONSENT_SCHEMA_VERSION,
      purpose: "analytics",
      state: choice,
      expires_at: Date.now() + CONSENT_DURATION_MS
    };
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function ensureGtagQueue() {
    window.dataLayer = Array.isArray(window.dataLayer) ? window.dataLayer : [];
    if (typeof window.gtag !== "function") {
      window.gtag = function gtag() {
        window.dataLayer.push(arguments);
      };
    }
  }

  function deniedConsentValues() {
    return {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    };
  }

  function grantedAnalyticsValues() {
    return {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    };
  }

  function queueConsentDefaults() {
    if (state.defaultsQueued) return;
    ensureGtagQueue();
    window.gtag("consent", "default", deniedConsentValues());
    state.defaultsQueued = true;
  }

  function queueEvent(name, parameters) {
    if (!state.enabled || state.consent !== "granted") return false;
    if (!state.pageContext || !EVENT_NAMES.has(name)) return false;
    ensureGtagQueue();
    const payload = Object.assign({
      page_type: state.pageContext.page_type,
      environment: state.pageContext.environment
    }, parameters || {});
    window.gtag("event", name, payload);
    return true;
  }

  function sendPageViewOnce() {
    if (state.pageViewSent || !state.pageContext) return;
    state.pageViewSent = true;
    queueEvent("page_view", {
      page_location: state.pageContext.page_location,
      page_title: state.pageContext.page_title,
      page_referrer: state.pageContext.page_referrer
    });
  }

  function sendNotFoundOnce() {
    if (state.notFoundSent || !state.pageContext || state.pageContext.page_type !== "error_404") return;
    state.notFoundSent = true;
    queueEvent("page_not_found", {
      requested_path_class: classifyRequestedPath(),
      referrer_class: classifyReferrer()
    });
  }

  function configureTag() {
    if (!state.hostConfig || !state.pageContext || state.configured) return;
    ensureGtagQueue();
    window.gtag("set", "url_passthrough", false);
    window.gtag("set", "ads_data_redaction", true);
    window.gtag("js", new Date());
    window.gtag("config", state.hostConfig.measurementId, {
      send_page_view: false,
      page_location: controlledConfigurationLocation(),
      page_title: state.pageContext.page_title,
      page_referrer: state.pageContext.page_referrer,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      url_passthrough: false,
      ads_data_redaction: true
    });
    state.configured = true;
  }

  function insertGoogleTag() {
    if (!state.hostConfig || state.scriptInserted || state.tagFailed) return;
    if (document.querySelector("script[data-decarb-ga4]")) {
      state.scriptInserted = true;
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id="
      + encodeURIComponent(state.hostConfig.measurementId);
    script.dataset.decarbGa4 = "true";
    script.addEventListener("load", function () {
      state.tagLoaded = true;
    }, { once: true });
    script.addEventListener("error", function () {
      state.tagFailed = true;
      state.enabled = false;
      window["ga-disable-" + state.hostConfig.measurementId] = true;
    }, { once: true });
    try {
      state.scriptInserted = true;
      document.head.appendChild(script);
    } catch (_error) {
      state.scriptInserted = false;
      state.tagFailed = true;
      state.enabled = false;
      window["ga-disable-" + state.hostConfig.measurementId] = true;
    }
  }

  function enableAnalytics() {
    state.consent = "granted";
    if (!state.hostConfig || !state.pageContext || state.tagFailed) return;
    queueConsentDefaults();
    window["ga-disable-" + state.hostConfig.measurementId] = false;
    window.gtag("consent", "update", grantedAnalyticsValues());
    state.enabled = true;
    configureTag();
    sendPageViewOnce();
    sendNotFoundOnce();
    insertGoogleTag();
  }

  function analyticsCookieName(name) {
    return name === "_ga"
      || name === "_gid"
      || name.startsWith("_ga_")
      || name.startsWith("_gat")
      || name.startsWith("_gac_");
  }

  function expireCookie(name, domain) {
    let cookie = name + "=; Max-Age=0; Path=/; SameSite=Lax";
    if (domain) cookie += "; Domain=" + domain;
    if (window.location.protocol === "https:") cookie += "; Secure";
    try {
      document.cookie = cookie;
    } catch (_error) {
      // Cookie access can be blocked; analytics remains disabled regardless.
    }
  }

  function clearAnalyticsCookies() {
    let cookieNames = [];
    try {
      cookieNames = String(document.cookie || "")
        .split(";")
        .map(function (item) { return item.split("=")[0].trim(); })
        .filter(analyticsCookieName);
    } catch (_error) {
      cookieNames = [];
    }
    const configuredSuffix = state.hostConfig
      ? state.hostConfig.measurementId.replace(/^G-/, "")
      : "";
    cookieNames.push("_ga", "_gid");
    if (configuredSuffix) cookieNames.push("_ga_" + configuredSuffix);
    const uniqueNames = Array.from(new Set(cookieNames));
    const hostname = String(window.location.hostname || "").toLowerCase();
    const domains = [null];
    if (hostname) domains.push(hostname);
    if (hostname === "decarbenergypartners.com" || hostname.endsWith(".decarbenergypartners.com")) {
      domains.push(".decarbenergypartners.com");
    }
    for (const name of uniqueNames) {
      for (const domain of domains) expireCookie(name, domain);
    }
  }

  function disableAnalytics() {
    state.consent = "denied";
    state.enabled = false;
    if (state.hostConfig) {
      window["ga-disable-" + state.hostConfig.measurementId] = true;
    }
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", deniedConsentValues());
    }
    clearAnalyticsCookies();
    const pendingScript = document.querySelector("script[data-decarb-ga4]");
    if (pendingScript && !state.tagLoaded) {
      pendingScript.remove();
      state.scriptInserted = false;
    }
  }

  function installConsentStyles() {
    if (document.getElementById(MODULE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MODULE_STYLE_ID;
    style.textContent = [
      ".analytics-consent[hidden],#analytics-settings[hidden]{display:none!important}",
      ".analytics-consent{position:fixed;z-index:100000;right:0;bottom:0;left:0;padding:.4rem .75rem;background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(14px) saturate(130%);backdrop-filter:blur(14px) saturate(130%);color:#16212b;border-top:1px solid #00648a;box-shadow:0 -.2rem .8rem rgba(0,0,0,.14);font:400 .95rem/1.3 Arial,Helvetica,sans-serif}",
      ".analytics-consent__inner{width:100%;margin:0;display:grid;grid-template-columns:minmax(0,1fr) auto 2.75rem;grid-template-areas:'header actions close' 'message actions close';align-items:center;column-gap:.65rem;row-gap:.05rem}",
      ".analytics-consent__header{grid-area:header;display:flex;align-items:center;min-width:0}",
      ".analytics-consent h2{margin:0;color:#004a66;font:700 clamp(1.05rem,2.2vw,1.25rem)/1.2 Arial,Helvetica,sans-serif}",
      ".analytics-consent__message{grid-area:message;min-width:0}",
      ".analytics-consent p{margin:0;color:#263946}",
      ".analytics-consent a{color:#004a66;font-weight:700;text-underline-offset:.2em}",
      ".analytics-consent__actions{grid-area:actions;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:.6rem}",
      ".analytics-consent__choice{min-height:2.75rem;min-width:7rem;padding:.55rem .9rem;border:2px solid #00648a;border-radius:.35rem;background:#fff;color:#004a66;font:700 .95rem/1.2 Arial,Helvetica,sans-serif;cursor:pointer}",
      ".analytics-consent__choice:hover{background:#eaf4f2}",
      ".analytics-consent__close{grid-area:close;align-self:start;justify-self:end;display:inline-grid;place-items:center;width:2.75rem;height:2.75rem;padding:0;border:0;border-radius:0;background:transparent;color:#004a66;font:700 1.1rem/1 Arial,Helvetica,sans-serif;cursor:pointer}",
      ".analytics-consent__close:hover{background:transparent;color:#002f41;text-decoration:underline;text-underline-offset:.15em}",
      ".analytics-consent__status{display:inline;margin-left:.45rem;font-size:.82rem;line-height:inherit;white-space:nowrap}",
      "#analytics-settings{position:fixed;z-index:99999;left:1rem;bottom:1rem;min-height:2.75rem;padding:.65rem .9rem;border:2px solid #fff;border-radius:.35rem;background:#004a66;color:#fff;box-shadow:0 .25rem .9rem rgba(0,0,0,.25);font:700 .95rem/1.2 Arial,Helvetica,sans-serif;cursor:pointer}",
      ".analytics-text-button{padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:750;text-decoration:underline;text-underline-offset:.2em;cursor:pointer}",
      ".analytics-consent button:focus-visible,#analytics-settings:focus-visible,.analytics-text-button:focus-visible,.analytics-consent a:focus-visible{outline:3px solid #000;outline-offset:3px}",
      "@media(max-width:42rem){.analytics-consent{max-height:80vh;overflow:auto;padding:.4rem .75rem}.analytics-consent__inner{grid-template-columns:minmax(0,1fr) 2.75rem;grid-template-areas:'header close' 'message message' 'actions actions';column-gap:.5rem;row-gap:.25rem}.analytics-consent__actions{justify-content:flex-end}.analytics-consent__choice{min-width:7rem}}",
      "@media(prefers-reduced-motion:reduce){.analytics-consent *,#analytics-settings{scroll-behavior:auto!important;transition:none!important;animation:none!important}}"
    ].join("");
    document.head.appendChild(style);
  }

  function consentElements() {
    return {
      panel: document.getElementById("analytics-consent"),
      heading: document.getElementById("analytics-consent-title"),
      accept: document.getElementById("analytics-consent-accept"),
      decline: document.getElementById("analytics-consent-decline"),
      close: document.getElementById("analytics-consent-close"),
      status: document.getElementById("analytics-consent-status"),
      settings: document.getElementById("analytics-settings")
    };
  }

  function consentStatusText() {
    if (state.consent === "granted") return "Analytics is accepted for this browser.";
    if (state.consent === "denied") return "Analytics is declined for this browser.";
    return "No analytics choice is saved.";
  }

  function focusWithoutScrolling(element) {
    if (!element || typeof element.focus !== "function") return;
    try {
      element.focus({ preventScroll: true });
    } catch (_error) {
      element.focus();
    }
  }

  function updateConsentUi(showPanel, moveFocus) {
    const ui = consentElements();
    if (!ui.panel || !ui.accept || !ui.decline || !ui.settings) return;
    ui.panel.hidden = !showPanel;
    const isPrivacyPage = document.body.dataset.analyticsPage === "privacy";
    ui.settings.hidden = showPanel || (state.consent !== "unset" && !isPrivacyPage);
    ui.settings.setAttribute("aria-label", "Analytics choices. " + consentStatusText());
    if (ui.close) ui.close.hidden = false;
    if (ui.status) ui.status.textContent = consentStatusText();
    if (showPanel && moveFocus) focusWithoutScrolling(ui.heading);
  }

  function focusAfterConsent(ui) {
    const destination = ui.settings.hidden
      ? document.querySelector(".site-header a[href]") : ui.settings;
    focusWithoutScrolling(destination);
  }

  function chooseConsent(choice) {
    const saved = writeConsent(choice);
    if (choice === "granted") enableAnalytics();
    else disableAnalytics();
    updateConsentUi(false, false);
    const ui = consentElements();
    focusAfterConsent(ui);
    if (!saved) {
      if (ui.status) {
        ui.status.textContent = consentStatusText()
          + " This browser did not retain the choice, so it may ask again.";
      }
    }
  }

  function bindConsentUi() {
    const ui = consentElements();
    if (!ui.panel || !ui.accept || !ui.decline || !ui.settings) return;
    ui.accept.addEventListener("click", function () { chooseConsent("granted"); });
    ui.decline.addEventListener("click", function () { chooseConsent("denied"); });
    ui.settings.addEventListener("click", function () { updateConsentUi(true, true); });
    if (ui.close) {
      ui.close.addEventListener("click", function () {
        updateConsentUi(false, false);
        focusAfterConsent(ui);
      });
    }
    document.addEventListener("click", function (event) {
      const target = event.target;
      if (target && typeof target.closest === "function" && target.closest("[data-analytics-open-settings]")) {
        event.preventDefault();
        updateConsentUi(true, true);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !ui.panel.hidden) {
        updateConsentUi(false, false);
        focusAfterConsent(ui);
      }
    });
  }

  function trackedClickParameters(element, eventName) {
    const data = element.dataset || {};
    if (eventName === "cta_click") {
      const ctaId = enumValue(data.analyticsCtaId, CTA_IDS, 32);
      const placement = enumValue(data.analyticsPlacement, CTA_PLACEMENTS, 24);
      const destinationType = enumValue(data.analyticsDestinationType, CTA_DESTINATIONS, 16);
      return ctaId && placement && destinationType
        ? { cta_id: ctaId, placement: placement, destination_type: destinationType }
        : null;
    }
    if (eventName === "outbound_link_click") {
      const destinationDomain = enumValue(data.analyticsDestinationDomain, OUTBOUND_DOMAINS, 40);
      const linkCategory = enumValue(data.analyticsLinkCategory, LINK_CATEGORIES, 20);
      const placement = enumValue(data.analyticsPlacement, OUTBOUND_PLACEMENTS, 16);
      return destinationDomain && linkCategory && placement
        ? { destination_domain: destinationDomain, link_category: linkCategory, placement: placement }
        : null;
    }
    if (eventName === "document_download_intent") {
      const documentId = enumValue(data.analyticsDocumentId, DOCUMENT_IDS, 40);
      const fileType = enumValue(data.analyticsFileType, FILE_TYPES, 8);
      const destinationDomain = enumValue(data.analyticsDestinationDomain, OUTBOUND_DOMAINS, 40);
      return documentId && fileType && destinationDomain
        ? { document_id: documentId, file_type: fileType, destination_domain: destinationDomain }
        : null;
    }
    if (eventName === "error_recovery_click") {
      const destination = enumValue(data.analyticsDestination, RECOVERY_DESTINATIONS, 20);
      const placement = enumValue(data.analyticsPlacement, RECOVERY_PLACEMENTS, 12);
      return destination && placement
        ? { destination: destination, placement: placement }
        : null;
    }
    return null;
  }

  function bindTrackedClicks() {
    document.addEventListener("click", function (event) {
      const target = event.target;
      if (!target || typeof target.closest !== "function") return;
      const element = target.closest("[data-analytics-event]");
      if (!element) return;
      const eventName = enumValue(element.dataset.analyticsEvent, EVENT_NAMES, 40);
      if (!eventName || eventName === "page_view" || eventName === "page_not_found") return;
      const parameters = trackedClickParameters(element, eventName);
      if (parameters) queueEvent(eventName, parameters);
    });
  }

  function roundBucket(round) {
    const value = Number(round);
    if (!Number.isFinite(value) || value < 1) return null;
    if (value === 1) return "1";
    if (value <= 3) return "2_3";
    return "4_plus";
  }

  function scoreBucket(score) {
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0) return null;
    if (value < 100) return "0_99";
    if (value < 500) return "100_499";
    return "500_plus";
  }

  const publicApi = Object.freeze({
    trackBrickBreakerStart: function (startType) {
      const safeStartType = enumValue(startType, START_TYPES, 12);
      if (safeStartType) queueEvent("brick_breaker_start", { start_type: safeStartType });
    },
    trackBrickBreakerRoundComplete: function (round) {
      const bucket = roundBucket(round);
      if (bucket) queueEvent("brick_breaker_round_complete", { round_bucket: bucket });
    },
    trackBrickBreakerGameOver: function (round, score) {
      const roundValue = roundBucket(round);
      const scoreValue = scoreBucket(score);
      if (roundValue && scoreValue) {
        queueEvent("brick_breaker_game_over", {
          round_bucket: roundValue,
          score_bucket: scoreValue
        });
      }
    },
    trackPagefindResultsRendered: function (resultCountBand, queryOrigin) {
      const provider = enumValue("pagefind", SEARCH_PROVIDERS, 12);
      const countBand = enumValue(resultCountBand, RESULT_COUNT_BANDS, 12);
      const origin = enumValue(queryOrigin, QUERY_ORIGINS, 12);
      if (provider && countBand && origin) {
        queueEvent("pagefind_results_rendered", {
          search_provider: provider,
          result_count_band: countBand,
          query_origin: origin
        });
      }
    },
    trackSiteSearchFallbackClick: function (fallbackReason) {
      const provider = enumValue("google", FALLBACK_PROVIDERS, 12);
      const reason = enumValue(fallbackReason, FALLBACK_REASONS, 20);
      if (provider && reason) {
        queueEvent("site_search_fallback_click", {
          fallback_provider: provider,
          fallback_reason: reason
        });
      }
    },
    trackSiteSearchResultClick: function (resultType, destinationPage) {
      const type = enumValue(resultType, SEARCH_RESULT_TYPES, 12);
      const destination = enumValue(destinationPage, SEARCH_DESTINATION_PAGES, 12);
      if (type && destination) {
        queueEvent("site_search_result_click", {
          result_type: type,
          destination_page: destination
        });
      }
    }
  });

  Object.defineProperty(window, PUBLIC_API_KEY, {
    value: publicApi,
    configurable: false,
    enumerable: false,
    writable: false
  });

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    state.hostConfig = getHostConfig();
    state.pageContext = getPageContext();
    installConsentStyles();
    bindConsentUi();
    bindTrackedClicks();
    state.consent = readConsent();
    if (state.consent === "granted") enableAnalytics();
    else if (state.consent === "denied") disableAnalytics();
    updateConsentUi(state.consent === "unset", false);
  }

  window.addEventListener("storage", function (event) {
    if (event.key !== CONSENT_STORAGE_KEY) return;
    const choice = readConsent();
    if (choice === "granted") enableAnalytics();
    else if (choice === "denied") disableAnalytics();
    else state.consent = "unset";
    updateConsentUi(choice === "unset", false);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}());
