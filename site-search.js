/* Shared expanding header search for Decarb's static pages. */
(function () {
  "use strict";

  // Resolve from this asset, not the current URL (which may be a nested 404).
  const searchUrl = new URL("search.html", document.currentScript.src);
  const SEARCH_PATH = searchUrl.protocol === "file:" ? searchUrl.href : searchUrl.pathname;
  const MAX_TERM_LENGTH = 120;

  function normalizeTerm(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_TERM_LENGTH);
  }

  function initializeForm(form) {
    if (form.dataset.siteSearchReady === "true") return false;
    const input = form.querySelector("[data-site-search-input]");
    const trigger = form.querySelector("[data-site-search-trigger]");
    if (!input || !trigger) return false;

    form.action = SEARCH_PATH;
    const root = document.documentElement;
    let open = false;

    function openSearch() {
      if (open) return;
      const contact = document.querySelector("[data-contact-menu-trigger]");
      if (contact && contact.getAttribute("aria-expanded") === "true") contact.click();
      open = true;
      input.disabled = false;
      input.tabIndex = 0;
      form.classList.add("is-open");
      root.classList.add("site-search-active");
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-label", "Search entire site");
      window.requestAnimationFrame(function () { input.focus(); });
    }

    function closeSearch(restoreFocus) {
      if (!open) return;
      open = false;
      form.classList.remove("is-open");
      root.classList.remove("site-search-active");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-label", "Open site search");
      input.value = "";
      input.disabled = true;
      input.tabIndex = -1;
      if (restoreFocus) trigger.focus();
    }

    trigger.addEventListener("click", function (event) {
      if (!open) {
        event.preventDefault();
        openSearch();
      } else if (!normalizeTerm(input.value)) {
        event.preventDefault();
        closeSearch(true);
      }
    });

    form.addEventListener("submit", function (event) {
      const term = normalizeTerm(input.value);
      if (!term) {
        event.preventDefault();
        closeSearch(true);
        return;
      }
      input.value = term;
      form.action = SEARCH_PATH;
      form.method = "get";
    });

    form.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSearch(true);
      }
    });

    form.addEventListener("focusout", function () {
      window.requestAnimationFrame(function () {
        if (open && !form.contains(document.activeElement)) closeSearch(false);
      });
    });

    document.addEventListener("pointerdown", function (event) {
      if (open && !form.contains(event.target)) closeSearch(false);
    });

    window.addEventListener("pageshow", function () {
      if (open) closeSearch(false);
    });

    form.dataset.siteSearchReady = "true";
    return true;
  }

  function initialize() {
    const forms = document.querySelectorAll("[data-site-search-form]");
    let initialized = false;
    for (const form of forms) initialized = initializeForm(form) || initialized;
    if (initialized) document.documentElement.classList.add("site-search-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}());
