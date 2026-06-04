(function () {
  "use strict";

  const ANALYTICS_KEY = "soft404qa_analytics_events";
  const INTENT_KEY = "soft404qa_purchase_intents";
  const GITHUB_ISSUE_URL = "https://github.com/ert93333-ops/soft-404-qa-briefs/issues/new";

  const SAMPLE_ROWS = [
    "https://example.com/products/old-sku | status=200 | title=Product not found | body=Sorry, this product is unavailable. No product details found.",
    "https://example.com/search?q=purple | status=200 | title=No results | body=No results found for purple.",
    "https://example.com/category/empty | status=204 | title= | body=",
    "https://example.com/blog/spring-guide | status=404 | title=Spring Guide | body=Our spring guide is still available in the archive.",
    "https://example.com/deprecated | status=302 | hops=11 | title=Redirecting | body=Moved temporarily.",
    "https://example.com/api-limit | status=429 | title=Too many requests | body=Rate limited.",
    "https://example.com/server-error | status=503 | title=Service unavailable | body=Try again later.",
  ].join("\n");

  const SAMPLE_NOTES = [
    "Old product URLs should return 410 or redirect to replacement products.",
    "No-results search pages should be noindex or return a useful category path.",
    "Spring guide should remain live or redirect to the new article.",
  ].join("\n");

  const SAMPLE_REDIRECTS = [
    "https://example.com/deprecated | hops=11 | target=https://example.com/new-location",
    "https://example.com/products/old-sku | hops=0",
  ].join("\n");

  const ERROR_COPY = /not found|no results|zero results|unavailable|not available|does not exist|missing|removed|empty|error|sorry|try again later|service unavailable|rate limited/i;
  const VALID_COPY = /available|still available|product details|article|guide|category|collection|documentation|download|archive|details|in stock/i;
  const OWNER_DECISION = /keep|redirect|404|410|noindex|restore|remove|replace|canonical|deindex|gone/i;

  const state = {
    latestBrief: null,
    latestBriefText: "",
    lastRemoteBody: "",
    signupStarted: false,
    pricingTracked: false,
  };

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function setText(selector, value) {
    const element = qs(selector);
    if (element) element.textContent = value;
  }

  function readArray(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function writeArray(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Local storage can be unavailable in privacy modes. The workflow still works.
    }
  }

  function getUtm() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
    };
  }

  function track(eventName, detail) {
    const events = readArray(ANALYTICS_KEY);
    events.push({
      event: eventName,
      detail: detail || {},
      utm: getUtm(),
      path: window.location.pathname,
      createdAt: new Date().toISOString(),
    });
    writeArray(ANALYTICS_KEY, events.slice(-200));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function listHtml(items, emptyText) {
    if (!items.length) return "<p>" + escapeHtml(emptyText) + "</p>";
    return "<ul>" + items.map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    }).join("") + "</ul>";
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function unique(items) {
    return Array.from(new Set(items.map(clean).filter(Boolean)));
  }

  function extractUrls(raw) {
    const pattern = /https?:\/\/[^\s<>"'|,]+/gi;
    return Array.from(clean(raw).matchAll(pattern)).map(function (match) {
      return match[0].replace(/[),.;]+$/, "");
    }).filter(Boolean);
  }

  function statusFamily(status) {
    if (!Number.isFinite(status)) return "unknown";
    if (status >= 200 && status < 300) return "2xx";
    if (status >= 300 && status < 400) return "3xx";
    if (status >= 400 && status < 500) return "4xx";
    if (status >= 500 && status < 600) return "5xx";
    return "unknown";
  }

  function parseKeyValue(line, key) {
    const match = line.match(new RegExp(key + "\\s*=\\s*([^|]+)", "i"));
    return match ? clean(match[1]) : "";
  }

  function parseRows(raw) {
    return clean(raw).split(/\r?\n/).map(clean).filter(Boolean).map(function (line, index) {
      const url = extractUrls(line)[0] || "row-" + (index + 1);
      const statusValue = parseKeyValue(line, "status");
      const status = Number(statusValue);
      const hopsValue = parseKeyValue(line, "hops");
      const hops = hopsValue === "" ? null : Number(hopsValue);
      const title = parseKeyValue(line, "title");
      const body = parseKeyValue(line, "body");
      const outcome = parseKeyValue(line, "outcome") || parseKeyValue(line, "decision");
      return {
        url: url,
        status: Number.isFinite(status) ? status : null,
        title: title,
        body: body,
        hops: Number.isFinite(hops) ? hops : null,
        outcome: outcome,
        raw: line,
      };
    });
  }

  function parseRedirectRows(raw) {
    const map = {};
    clean(raw).split(/\r?\n/).map(clean).filter(Boolean).forEach(function (line) {
      const url = extractUrls(line)[0];
      const hops = Number(parseKeyValue(line, "hops"));
      const target = parseKeyValue(line, "target") || extractUrls(line).slice(1)[0] || "";
      if (url) {
        map[url] = {
          hops: Number.isFinite(hops) ? hops : null,
          target: target,
          raw: line,
        };
      }
    });
    return map;
  }

  function hasDecision(row) {
    return OWNER_DECISION.test(row.outcome || "");
  }

  function bodyText(row) {
    return clean([row.title, row.body].join(" "));
  }

  function analyzeSoft404(input) {
    const rows = parseRows(input.rows);
    const redirectMap = parseRedirectRows(input.redirectRows);
    const notes = clean(input.notes);
    const parseSummary = [
      "Parsed " + rows.length + " URL/status/body rows.",
      "Parsed " + Object.keys(redirectMap).length + " redirect hop rows.",
      "Template type: " + clean(input.templateType),
    ];
    const soft404Warnings = [];
    const mismatchWarnings = [];
    const redirectWarnings = [];
    const serverWarnings = [];
    const ownerDecisionReminders = [];
    const handoffReminders = [
      "Retest after routing, CDN, redirect, status-code, template-copy, or content-pruning changes ship.",
      "Treat this as launch QA guidance; it does not crawl pages, fetch URLs, replace Search Console, or guarantee crawling, indexing, or rankings.",
    ];

    if (!rows.length) {
      parseSummary.push("No status rows were provided.");
    }

    rows.forEach(function (row) {
      const text = bodyText(row);
      const family = statusFamily(row.status);
      const redirectInfo = redirectMap[row.url] || {};
      const hops = row.hops !== null ? row.hops : redirectInfo.hops;
      const hasErrorCopy = ERROR_COPY.test(text);
      const hasValidCopy = VALID_COPY.test(text);
      const bodyLength = clean(row.body).length;
      const label = row.url + " (" + (row.status || "status missing") + ")";

      if (row.status === null) {
        mismatchWarnings.push(label + " is missing an HTTP status, so status/body mismatch cannot be resolved.");
      }

      if (family === "2xx" && row.status === 200 && hasErrorCopy) {
        soft404Warnings.push(label + " is a 200 page that looks like not found, no results, unavailable, empty, or error copy.");
        mismatchWarnings.push(label + " has status/body mismatch: successful HTTP status with error-like visible copy.");
      }
      if (family === "2xx" && row.status === 204) {
        soft404Warnings.push(label + " is an HTTP 204 content gap; confirm no indexable content is expected at this URL.");
        mismatchWarnings.push(label + " has status/body mismatch if the launch intent expects an indexable page.");
      }
      if (family === "2xx" && bodyLength < 45) {
        soft404Warnings.push(label + " has thin or missing main content in the body snippet.");
      }
      if ((row.status === 404 || row.status === 410) && hasValidCopy) {
        mismatchWarnings.push(label + " is a 404/410 row that looks like valid content; decide whether to keep, restore, redirect, or confirm removal.");
      }
      if (family === "3xx" || hops !== null) {
        if (hops >= 10) {
          redirectWarnings.push(label + " has a redirect chain near or over 10 hops (" + hops + "); shorten the chain before launch.");
        } else if (hops >= 8) {
          redirectWarnings.push(label + " has a redirect chain near or over 10 hops (" + hops + "); verify it stays safely below crawler limits.");
        }
        if (family === "3xx" && !redirectInfo.target && !/target\s*=/i.test(row.raw)) {
          redirectWarnings.push(label + " is a redirect row without a target URL in the pasted sample.");
        }
      }
      if (family === "5xx" || row.status === 429) {
        serverWarnings.push(label + " is a 5xx/429 server-error row; keep it out of launch samples before final signoff.");
      }
      if ((hasErrorCopy || row.status === 204 || family === "3xx" || family === "4xx" || family === "5xx") && !hasDecision(row)) {
        ownerDecisionReminders.push(label + " has missing owner decision; choose keep, redirect, 404, 410, noindex, restore content, or remove from launch.");
      }
    });

    if (!notes) {
      ownerDecisionReminders.push("No intended outcome notes were provided, creating missing owner decision risk for status/body mismatches.");
    }
    if (/migration|pruning|product|archive|docs|documentation|search/i.test(input.templateType)) {
      handoffReminders.push("For " + clean(input.templateType).toLowerCase() + ", review removed URLs, replacement redirects, no-results templates, expired products, and archived content separately.");
    }

    const issueCount =
      soft404Warnings.length +
      mismatchWarnings.length +
      redirectWarnings.length +
      serverWarnings.length +
      ownerDecisionReminders.length +
      (rows.length ? 0 : 1);
    const status = soft404Warnings.length || mismatchWarnings.length || redirectWarnings.length || serverWarnings.length
      ? "Fix before launch"
      : ownerDecisionReminders.length
        ? "Manual review"
        : "Ready for final soft 404 QA";

    return {
      status: status,
      issueCount: issueCount,
      rowCount: rows.length,
      redirectRowCount: Object.keys(redirectMap).length,
      templateType: clean(input.templateType),
      parseSummary: unique(parseSummary),
      soft404Warnings: unique(soft404Warnings),
      mismatchWarnings: unique(mismatchWarnings),
      redirectWarnings: unique(redirectWarnings),
      serverWarnings: unique(serverWarnings),
      ownerDecisionReminders: unique(ownerDecisionReminders),
      handoffReminders: unique(handoffReminders),
    };
  }

  function briefToText(brief) {
    return [
      "Soft 404 QA Briefs",
      "Status: " + brief.status,
      "Issue count: " + brief.issueCount,
      "Status rows: " + brief.rowCount,
      "Redirect hop rows: " + brief.redirectRowCount,
      "Template type: " + brief.templateType,
      "",
      "Parse summary:",
      brief.parseSummary.length ? brief.parseSummary.join("\n") : "None found.",
      "",
      "Soft 404 candidate warnings:",
      brief.soft404Warnings.length ? brief.soft404Warnings.join("\n") : "None found.",
      "",
      "HTTP status/body mismatch warnings:",
      brief.mismatchWarnings.length ? brief.mismatchWarnings.join("\n") : "None found.",
      "",
      "Redirect chain warnings:",
      brief.redirectWarnings.length ? brief.redirectWarnings.join("\n") : "None found.",
      "",
      "Server and rate-limit warnings:",
      brief.serverWarnings.length ? brief.serverWarnings.join("\n") : "None found.",
      "",
      "Owner decision reminders:",
      brief.ownerDecisionReminders.length ? brief.ownerDecisionReminders.join("\n") : "None found.",
      "",
      "Handoff reminders:",
      brief.handoffReminders.join("\n"),
      "",
      "Note: This is soft 404 launch QA guidance, not a crawler, Search Console replacement, or guarantee of crawling, indexing, rankings, or Search Console outcomes.",
    ].join("\n");
  }

  function renderBrief(brief) {
    const output = qs("#brief-output");
    const copyButton = qs("#copy-brief");
    const outputPanel = qs(".output-panel");
    const statusPill = qs("#status-pill");
    if (!output) return;

    output.classList.remove("empty");
    output.classList.add("is-updated");
    window.setTimeout(function () { output.classList.remove("is-updated"); }, 480);
    output.innerHTML = [
      '<div class="brief-summary">',
      '<strong>' + escapeHtml(brief.status) + '</strong>',
      '<span>' + brief.issueCount + ' checks need attention across ' + brief.rowCount + ' status rows</span>',
      "</div>",
      '<section class="brief-section"><h4>Parse summary</h4>' + listHtml(brief.parseSummary, "No parse notes found.") + "</section>",
      '<section class="brief-section"><h4>Soft 404 candidate warnings</h4>' + listHtml(brief.soft404Warnings, "No soft 404 candidates found.") + "</section>",
      '<section class="brief-section"><h4>HTTP status/body mismatch warnings</h4>' + listHtml(brief.mismatchWarnings, "No status/body mismatch warnings found.") + "</section>",
      '<section class="brief-section"><h4>Redirect chain warnings</h4>' + listHtml(brief.redirectWarnings, "No redirect chain warnings found.") + "</section>",
      '<section class="brief-section"><h4>Server and rate-limit warnings</h4>' + listHtml(brief.serverWarnings, "No server or rate-limit warnings found.") + "</section>",
      '<section class="brief-section"><h4>Owner decision reminders</h4>' + listHtml(brief.ownerDecisionReminders, "No owner decision reminders found.") + "</section>",
      '<section class="brief-section"><h4>Handoff reminders</h4>' + listHtml(brief.handoffReminders, "No handoff reminders found.") + "</section>",
    ].join("");
    setText("#output-title", "Soft 404 QA brief ready");
    setText("#status-pill", brief.status);
    if (copyButton) copyButton.disabled = false;
    if (outputPanel) {
      outputPanel.classList.add("has-brief");
      outputPanel.classList.toggle("status-good", brief.status === "Ready for final soft 404 QA");
      outputPanel.classList.toggle("status-warning", brief.status === "Manual review");
      outputPanel.classList.toggle("status-danger", brief.status === "Fix before launch");
    }
    if (statusPill) {
      statusPill.classList.toggle("status-good", brief.status === "Ready for final soft 404 QA");
      statusPill.classList.toggle("status-warning", brief.status === "Manual review");
      statusPill.classList.toggle("status-danger", brief.status === "Fix before launch");
    }
    state.latestBrief = brief;
    state.latestBriefText = briefToText(brief);
  }

  function pulseClass(element, className, duration) {
    if (!element) return;
    element.classList.add(className);
    window.setTimeout(function () { element.classList.remove(className); }, duration || 600);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall through to textarea fallback for headless browser clipboard blocks.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setupAuditor() {
    const form = qs("#auditor-form");
    const rowsInput = qs("#rows-input");
    const notesInput = qs("#notes-input");
    const redirectInput = qs("#redirect-input");
    const loadSample = qs("#load-sample");
    const error = qs("#workflow-error");
    const copyButton = qs("#copy-brief");
    if (!form || !rowsInput) return;

    if (loadSample) {
      loadSample.addEventListener("click", function () {
        rowsInput.value = SAMPLE_ROWS;
        if (notesInput) notesInput.value = SAMPLE_NOTES;
        if (redirectInput) redirectInput.value = SAMPLE_REDIRECTS;
        if (qs("#template-type")) qs("#template-type").value = "Migration cleanup";
        rowsInput.focus();
        pulseClass(loadSample, "is-confirmed", 520);
        track("sample_soft404_rows_loaded");
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      track("core_action_started", { triggerSource: "auditor_form" });
      if (error) error.textContent = "";

      const input = {
        rows: rowsInput.value.trim(),
        notes: notesInput ? notesInput.value.trim() : "",
        redirectRows: redirectInput ? redirectInput.value.trim() : "",
        templateType: qs("#template-type") ? qs("#template-type").value : "",
      };
      const inputLength = Object.keys(input).reduce(function (total, key) { return total + String(input[key]).length; }, 0);
      if (!input.rows) {
        if (error) error.textContent = "Paste URL/status/title/body rows or load the sample before generating a soft 404 QA brief.";
        track("core_action_failed", { reason: "empty_input" });
        return;
      }

      const brief = analyzeSoft404(input);
      renderBrief(brief);
      track("core_action_completed", {
        issueCount: brief.issueCount,
        status: brief.status,
        rowCount: brief.rowCount,
        redirectRowCount: brief.redirectRowCount,
        inputLength: inputLength,
      });
    });

    if (copyButton) {
      copyButton.addEventListener("click", function () {
        if (!state.latestBriefText) return;
        copyText(state.latestBriefText).then(function () {
          copyButton.textContent = "Copied brief";
          pulseClass(copyButton, "is-confirmed", 700);
          track("brief_copied", { issueCount: state.latestBrief ? state.latestBrief.issueCount : 0 });
          window.setTimeout(function () { copyButton.textContent = "Copy brief"; }, 1400);
        });
      });
    }
  }

  function buildRemoteIssue(intent) {
    const body = [
      "Soft 404 QA Briefs early-access request",
      "",
      "Role: " + intent.role,
      "Site type: " + intent.siteType,
      "URL templates: " + intent.templateCount,
      "Plan interest: " + intent.plan,
      "Willingness to pay: " + intent.budget,
      "Purchase intent: " + (intent.purchaseIntent ? "yes" : "no"),
      "",
      "Biggest soft 404 QA pain:",
      intent.pain,
      "",
      "Note: Email is intentionally omitted from this public issue body.",
    ].join("\n");
    state.lastRemoteBody = body;
    const params = new URLSearchParams({
      title: "Soft 404 QA Briefs early-access request",
      body: body,
      labels: "early-access,purchase-intent,demo-request",
      template: "demo_request.md",
    });
    return GITHUB_ISSUE_URL + "?" + params.toString();
  }

  function setupWaitlist() {
    const form = qs("#waitlist-form");
    const status = qs("#waitlist-status");
    const handoff = qs("#handoff-panel");
    const remoteLink = qs("#remote-intent-link");
    const copyRequest = qs("#copy-request");
    const planSelect = qs("#plan");
    if (!form) return;

    form.addEventListener("focusin", function () {
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_form" });
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_submit" });
      }
      const intent = {
        email: qs("#email") ? qs("#email").value.trim() : "",
        role: qs("#role") ? qs("#role").value : "",
        siteType: qs("#site-type-intent") ? qs("#site-type-intent").value : "",
        templateCount: qs("#template-count") ? qs("#template-count").value : "",
        plan: planSelect ? planSelect.value : "",
        budget: qs("#budget") ? qs("#budget").value : "",
        pain: qs("#pain") ? qs("#pain").value.trim() : "",
        purchaseIntent: qs("#purchase-intent") ? qs("#purchase-intent").checked : false,
        createdAt: new Date().toISOString(),
        utm: getUtm(),
      };
      const intents = readArray(INTENT_KEY);
      intents.push(intent);
      writeArray(INTENT_KEY, intents.slice(-100));

      const remoteHref = buildRemoteIssue(intent);
      if (remoteLink) remoteLink.href = remoteHref;
      if (handoff) {
        handoff.hidden = false;
        pulseClass(handoff, "is-confirmed", 700);
      }
      if (status) status.textContent = "You are on the early access list. Public-safe request details are ready.";

      track("waitlist_submitted", { role: intent.role, plan: intent.plan, templateCount: intent.templateCount });
      track("feedback_submitted", { triggerSource: "waitlist_form", painLength: intent.pain.length });
      track("remote_intent_ready", { hasRemoteLink: Boolean(remoteHref) });
      if (intent.purchaseIntent) track("checkout_intent", { plan: intent.plan, budget: intent.budget });
    });

    if (copyRequest) {
      copyRequest.addEventListener("click", function () {
        if (!state.lastRemoteBody) return;
        copyText(state.lastRemoteBody).then(function () {
          copyRequest.textContent = "Copied request details";
          pulseClass(copyRequest, "is-confirmed", 700);
          track("remote_intent_copied", { bodyLength: state.lastRemoteBody.length });
          window.setTimeout(function () { copyRequest.textContent = "Copy request details"; }, 1500);
        });
      });
    }
  }

  function setupPlanButtons() {
    const waitlist = qs("#waitlist");
    const planSelect = qs("#plan");
    qsa(".plan-button").forEach(function (button) {
      button.addEventListener("click", function () {
        const plan = button.getAttribute("data-plan") || "";
        if (planSelect && plan) planSelect.value = plan;
        track("pricing_viewed", { triggerSource: "plan_button" });
        state.pricingTracked = true;
        track("checkout_started", { plan: plan, triggerSource: "pricing_button" });
        pulseClass(button, "is-confirmed", 500);
        if (waitlist) waitlist.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function setupTracking() {
    track("landing_viewed", { product: "Soft 404 QA Briefs" });
    qsa("[data-track-cta]").forEach(function (element) {
      element.addEventListener("click", function () {
        track("cta_clicked", { cta: element.getAttribute("data-track-cta") || element.textContent.trim() });
      });
    });
    const pricing = qs("#pricing");
    if (pricing && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !state.pricingTracked) {
            state.pricingTracked = true;
            track("pricing_viewed", { triggerSource: "scroll" });
            observer.disconnect();
          }
        });
      }, { threshold: 0.35 });
      observer.observe(pricing);
    }
  }

  function setupChrome() {
    const header = qs("[data-header]");
    if (!header) return;
    function updateHeader() {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  function setupReveal() {
    const elements = qsa(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach(function (element) { observer.observe(element); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupTracking();
    setupChrome();
    setupReveal();
    setupAuditor();
    setupWaitlist();
    setupPlanButtons();
  });
}());
