/* Branded Pagefind results with query-bound recovery only when search fails. */
(function () {
  "use strict";

  const INSTANCE_NAME = "decarb-search";
  const MAX_TERM_LENGTH = 120;
  const COMPONENT_TIMEOUT_MS = 8000;
  const GOOGLE_SEARCH_URL = "https://www.google.com/search";
  const GOOGLE_SITE_PREFIX = "site:www.decarbenergypartners.com ";
  const componentUrl = new URL("pagefind/pagefind-component-ui.js", document.currentScript.src);
  const previewUrl = new URL("pagefind-preview.js", document.currentScript.src);

  const state = {
    initialTerm: "",
    currentTerm: "",
    fallbackReason: "manual",
    instance: null,
    hasSearched: false,
    unavailable: false,
    searchTimeout: null,
    landingRecorded: false,
    recordedResultStates: new Set()
  };

  function normalizeTerm(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_TERM_LENGTH);
  }

  function resultCountBand(count) {
    const value = Number(count);
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (value === 1) return "1";
    if (value <= 3) return "2_3";
    return "4_plus";
  }

  function analyticsCall(method, ...args) {
    const analytics = window.DecarbAnalytics;
    if (analytics && typeof analytics[method] === "function") analytics[method](...args);
  }

  function setStatus(message, isError) {
    const status = document.getElementById("search-status");
    if (!status) return;
    status.textContent = String(message || "");
    status.dataset.state = isError ? "error" : (message ? "message" : "idle");
  }

  function setCurrentTerm(value) {
    state.currentTerm = normalizeTerm(value);
    return state.currentTerm;
  }

  function currentInstanceTerm() {
    return normalizeTerm(state.instance && state.hasSearched ? state.instance.searchTerm : state.currentTerm);
  }

  function buildGoogleUrl(term) {
    const url = new URL(GOOGLE_SEARCH_URL);
    url.searchParams.set("q", GOOGLE_SITE_PREFIX + term);
    return url;
  }

  function showAlternative(message, isError) {
    setStatus(message, isError);
    const status = document.getElementById("search-status");
    if (!state.currentTerm) {
      status.append(" Enter a search term to continue with an alternative engine.");
      return;
    }
    const link = document.createElement("a");
    link.id = "search-alternative-link";
    link.href = buildGoogleUrl(state.currentTerm).href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    link.textContent = "Click here";
    link.setAttribute("aria-label", "Search on Google (opens in a new tab)");
    link.addEventListener("click", function () {
      analyticsCall("trackSiteSearchFallbackClick", state.fallbackReason);
    });
    status.append(" ", link, " to continue your search with an alternative engine");
  }

  function showUnavailable() {
    // Latch failure once: disconnected components cannot retry on each keystroke
    // or append a separate raw bundle-path error under every component.
    if (state.unavailable) return;
    setCurrentTerm(currentInstanceTerm());
    state.unavailable = true;
    state.fallbackReason = "pagefind_error";
    window.clearTimeout(state.searchTimeout);
    const component = document.querySelector("pagefind-input");
    const restoreFocus = Boolean(component && component.contains(document.activeElement));
    const form = document.getElementById("search-unavailable-form");
    const input = document.getElementById("search-unavailable-input");
    input.value = state.currentTerm;
    document.querySelectorAll(".search-interface pagefind-config, .search-interface pagefind-input, .search-interface pagefind-summary, .search-interface pagefind-results")
      .forEach(function (element) { element.remove(); });
    form.hidden = false;
    showAlternative("Search currently unavailable.", true);
    if (restoreFocus) input.focus();
  }

  function classifyResultDestination(anchor) {
    try {
      const url = new URL(anchor.href, window.location.origin);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      let destinationPage = "future";
      if (path === "/" || path === "/index.html") destinationPage = "home";
      else if (path === "/privacy.html") destinationPage = "privacy";
      else if (path === "/404.html") destinationPage = "error_404";
      return {
        resultType: url.hash ? "heading" : "page",
        destinationPage
      };
    } catch (_error) {
      return null;
    }
  }

  function handleResultClick(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const anchor = path.find(function (node) { return node instanceof HTMLAnchorElement; })
      || (event.target && typeof event.target.closest === "function" ? event.target.closest("a[href]") : null);
    if (!anchor) return;
    const classification = classifyResultDestination(anchor);
    if (classification) {
      analyticsCall(
        "trackSiteSearchResultClick",
        classification.resultType,
        classification.destinationPage
      );
    }
  }

  function enforceComponentInputLimit(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const component = path.find(function (node) {
      return node && node.nodeType === 1 && node.tagName === "PAGEFIND-INPUT";
    });
    const input = path.find(function (node) { return node instanceof HTMLInputElement; });
    if (component && input && input.value.length > MAX_TERM_LENGTH) {
      input.value = input.value.slice(0, MAX_TERM_LENGTH);
    }
  }

  function applyNativeInputLimit(component) {
    function findInput() {
      const root = component.shadowRoot || component;
      const input = root.querySelector ? root.querySelector("input") : null;
      if (input) input.maxLength = MAX_TERM_LENGTH;
      return Boolean(input);
    }
    if (findInput()) return;
    const observer = new MutationObserver(function () {
      if (findInput()) observer.disconnect();
    });
    observer.observe(component, { childList: true, subtree: true });
    window.setTimeout(function () { observer.disconnect(); }, COMPONENT_TIMEOUT_MS);
  }

  function recordResults(searchResult) {
    if (state.unavailable) return;
    window.clearTimeout(state.searchTimeout);
    const term = setCurrentTerm(currentInstanceTerm());
    const count = Array.isArray(searchResult && searchResult.results)
      ? searchResult.results.length
      : 0;

    if (!term) {
      setStatus("Enter a search term to search this site.", false);
      return;
    }
    // Pagefind owns the result summary, including a healthy empty result set.
    setStatus("", false);

    if (state.recordedResultStates.has(term)) return;
    state.recordedResultStates.add(term);
    const isLanding = !state.landingRecorded && Boolean(state.initialTerm) && term === state.initialTerm;
    if (isLanding) state.landingRecorded = true;
    analyticsCall(
      "trackPagefindResultsRendered",
      resultCountBand(count),
      isLanding ? "landing" : "refinement"
    );
  }

  function bindInstance(instance) {
    state.instance = instance;
    instance.on("search", function (term) {
      if (state.unavailable) return;
      state.hasSearched = true;
      const normalized = setCurrentTerm(term);
      state.fallbackReason = "manual";
      window.clearTimeout(state.searchTimeout);
      if (normalized) state.searchTimeout = window.setTimeout(showUnavailable, COMPONENT_TIMEOUT_MS);
      if (!normalized) setStatus("Enter a search term to search this site.", false);
      else setStatus("Searching...", false);
      if (String(term || "") !== normalized) instance.triggerSearch(normalized);
    });
    instance.on("loading", function () {
      if (!state.unavailable && currentInstanceTerm()) setStatus("Searching...", false);
    });
    instance.on("results", recordResults);
    instance.on("error", showUnavailable);
  }

  async function withTimeout(promise) {
    let timer;
    const timeout = new Promise(function (_resolve, reject) {
      timer = window.setTimeout(function () { reject(new Error("Search load timeout")); }, COMPONENT_TIMEOUT_MS);
    });
    try { return await Promise.race([promise, timeout]); }
    finally { window.clearTimeout(timer); }
  }

  async function loadScript(url) {
    await withTimeout(new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = url.href;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    }));
  }

  async function waitForComponents() {
    if (window.location.protocol === "file:") {
      // A classic script supplies the exact Pagefind bytes to an in-memory
      // module. No file fetch, external service, or browser-security override.
      await loadScript(previewUrl);
      if (!window.DecarbPagefindPreview) throw new Error("Local search transport unavailable");
      const config = document.querySelector("pagefind-config");
      config.setAttribute("bundle-path", window.DecarbPagefindPreview.bundlePath);
      config.setAttribute("base-url", new URL("./", previewUrl).href);
      config.setAttribute("no-worker", "");
    }
    await loadScript(componentUrl);
    await withTimeout(customElements.whenDefined("pagefind-input"));
    if (!window.PagefindComponents || typeof window.PagefindComponents.getInstanceManager !== "function") {
      throw new Error("Pagefind component manager unavailable");
    }
  }

  async function initialize() {
    const fallbackForm = document.getElementById("search-unavailable-form");
    const fallbackInput = document.getElementById("search-unavailable-input");
    const results = document.querySelector("pagefind-results");
    const inputComponent = document.querySelector("pagefind-input");
    if (!fallbackForm || !fallbackInput || !results || !inputComponent) return;

    fallbackInput.addEventListener("input", function () {
      setCurrentTerm(fallbackInput.value);
      showAlternative("Search currently unavailable.", true);
    });
    fallbackForm.addEventListener("submit", function (event) {
      event.preventDefault();
      fallbackInput.value = setCurrentTerm(fallbackInput.value);
      showAlternative("Search currently unavailable.", true);
    });
    document.querySelector(".search-interface").addEventListener("pagefind-error", showUnavailable);
    results.addEventListener("click", handleResultClick, true);
    document.addEventListener("input", enforceComponentInputLimit, true);

    const parameters = new URLSearchParams(window.location.search);
    state.initialTerm = normalizeTerm(parameters.get("q"));
    setCurrentTerm(state.initialTerm);
    setStatus(state.initialTerm ? "Loading search..." : "Enter a search term to search this site.", false);

    if (!/^(https?|file):$/.test(window.location.protocol)) {
      showUnavailable();
      return;
    }

    try {
      await waitForComponents();
      if (state.unavailable) return;
      const manager = window.PagefindComponents.getInstanceManager();
      const instance = manager.getInstance(INSTANCE_NAME);
      instance.setTranslations({ zero_results: "No results found." });
      applyNativeInputLimit(inputComponent);
      const nativeInput = (inputComponent.shadowRoot || inputComponent).querySelector("input");
      if (nativeInput) nativeInput.disabled = true;
      bindInstance(instance);
      // Catch module/index initialization failures before enabling refinement.
      await withTimeout(instance.triggerLoad());
      if (state.unavailable) return;
      if (nativeInput) nativeInput.disabled = false;
      if (state.initialTerm) instance.triggerSearch(state.initialTerm);
    } catch (_error) {
      showUnavailable();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}());
