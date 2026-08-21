const MODE_OPTIONS = [
  ["bounty", "Bounty"],
  ["claim", "Claim"],
  ["pitch", "Pitch"],
  ["benchmark", "Benchmark"],
  ["auction", "Auction"],
];

const ACTIVITY_OPTIONS = [
  ["active", "Active tasks"],
  ["completed", "Completed use"],
  ["multiUse", "Used more than once"],
];

const PROPERTY_OPTIONS = [
  ["currentDefault", "Current default"],
  ["curated", "Curated metadata"],
  ["verifiedSource", "Verified source"],
  ["audited", "Audited"],
  ["proxy", "Proxy"],
];

const deploymentConfig = globalThis.TASKMARKET_HOOKLIST_CONFIG || {};
const registryMode = deploymentConfig.registryMode === "static" ? "static" : "auto";
const liveRegistryUrl = new URL("./api/hooks", document.baseURI).href;
const registrySnapshotUrl = new URL("./registry.json", document.baseURI).href;

const ACTIVE_STATUSES = new Set([
  "open",
  "claimed",
  "worker_selected",
  "pending_approval",
  "review",
  "appealing",
  "disputed",
]);

const optionValues = {
  modes: new Set(MODE_OPTIONS.map(([value]) => value)),
  activity: new Set(ACTIVITY_OPTIONS.map(([value]) => value)),
  properties: new Set(PROPERTY_OPTIONS.map(([value]) => value)),
};

const state = {
  registry: null,
  hooks: [],
  filteredHooks: [],
  search: "",
  modes: new Set(),
  activity: new Set(),
  properties: new Set(),
  loading: true,
  unavailable: false,
  selectedHook: null,
  lastFocused: null,
  requestController: null,
};

const ui = {
  filters: document.querySelector("#filters"),
  search: document.querySelector("#hook-search"),
  modeFilters: document.querySelector("#mode-filters"),
  activityFilters: document.querySelector("#activity-filters"),
  propertyFilters: document.querySelector("#property-filters"),
  clearFilters: document.querySelector("#clear-filters"),
  emptyClear: document.querySelector("#empty-clear"),
  grid: document.querySelector("#hook-grid"),
  empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyCopy: document.querySelector("#empty-copy"),
  resultsCount: document.querySelector("#results-count"),
  lastUpdated: document.querySelector("#last-updated"),
  summary: document.querySelector("#registry-summary"),
  errorBanner: document.querySelector("#error-banner"),
  errorTitle: document.querySelector("#error-title"),
  errorMessage: document.querySelector("#error-message"),
  retry: document.querySelector("#retry-button"),
  cardTemplate: document.querySelector("#hook-card-template"),
  drawerLayer: document.querySelector("#drawer-layer"),
  drawer: document.querySelector("#hook-drawer"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  drawerContent: document.querySelector("#drawer-content"),
};

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function shortAddress(address) {
  const value = String(address || "");
  return value.length >= 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || "Unknown";
}

function titleCase(value) {
  return String(value || "unknown")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function hookName(hook) {
  return hook.name || `Hook ${shortAddress(hook.address)}`;
}

function isCurated(hook) {
  return Boolean(
    hook.name
    || hook.description
    || hook.author
    || hook.repository
    || hook.homepage
    || hook.license
    || safeArray(hook.categories).length,
  );
}

function hookDescription(hook) {
  if (hook.description) return hook.description;
  const modes = safeArray(hook.modes).map(titleCase);
  const modeCopy = modes.length ? ` across ${modes.join(", ")} task modes` : "";
  return `Observed on ${plural(safeCount(hook.taskCount), "public Taskmarket task")}${modeCopy}. Community metadata has not been added yet.`;
}

function parseSetParam(params, key, allowed) {
  const values = (params.get(key) || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => allowed.has(value));
  return new Set(values);
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.search = (params.get("search") || "").trim();
  state.modes = parseSetParam(params, "modes", optionValues.modes);
  state.activity = parseSetParam(params, "activity", optionValues.activity);
  state.properties = parseSetParam(params, "properties", optionValues.properties);
  ui.search.value = state.search;
}

function writeUrlState() {
  const params = new URLSearchParams();
  const search = state.search.trim();
  if (search) params.set("search", search);
  if (state.modes.size) params.set("modes", [...state.modes].join(","));
  if (state.activity.size) params.set("activity", [...state.activity].join(","));
  if (state.properties.size) params.set("properties", [...state.properties].join(","));
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function createFilterButtons(container, options, stateKey) {
  container.replaceChildren(...options.map(([value, label]) => {
    const button = makeElement("button", "filter-chip", label);
    button.type = "button";
    button.dataset.filterValue = value;
    button.dataset.filterGroup = stateKey;
    button.setAttribute("aria-pressed", String(state[stateKey].has(value)));
    button.addEventListener("click", () => {
      if (state[stateKey].has(value)) state[stateKey].delete(value);
      else state[stateKey].add(value);
      button.setAttribute("aria-pressed", String(state[stateKey].has(value)));
      writeUrlState();
      applyFilters();
    });
    return button;
  }));
}

function renderFilterButtons() {
  createFilterButtons(ui.modeFilters, MODE_OPTIONS, "modes");
  createFilterButtons(ui.activityFilters, ACTIVITY_OPTIONS, "activity");
  createFilterButtons(ui.propertyFilters, PROPERTY_OPTIONS, "properties");
}

function matchesSearch(hook, query) {
  if (!query) return true;
  const haystack = [
    hook.address,
    hook.name,
    hook.description,
    hook.author,
    hook.license,
    ...safeArray(hook.categories),
    ...safeArray(hook.tags),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return haystack.includes(query);
}

function matchesActivity(hook, activity) {
  if (activity === "active") return safeCount(hook.activeTaskCount) > 0;
  if (activity === "completed") return safeArray(hook.statuses).includes("completed");
  if (activity === "multiUse") return safeCount(hook.taskCount) > 1;
  return true;
}

function matchesProperty(hook, property) {
  if (property === "currentDefault") return hook.currentDefault === true;
  if (property === "curated") return isCurated(hook);
  if (property === "verifiedSource") return hook.verified === true;
  if (property === "audited") return Boolean(hook.auditUrl);
  if (property === "proxy") return hook.proxyKind === "erc1967";
  return true;
}

function filterHooks() {
  const query = state.search.trim().toLocaleLowerCase();
  return state.hooks.filter((hook) => {
    if (!matchesSearch(hook, query)) return false;
    if (state.modes.size && !safeArray(hook.modes).some((mode) => state.modes.has(mode))) return false;
    if ([...state.activity].some((activity) => !matchesActivity(hook, activity))) return false;
    if ([...state.properties].some((property) => !matchesProperty(hook, property))) return false;
    return true;
  });
}

function modePill(mode) {
  const pill = makeElement("span", `property-pill mode-${mode}`, titleCase(mode));
  return pill;
}

function cardPropertyNodes(hook) {
  const nodes = [];
  if (hook.currentDefault === true) {
    nodes.push(makeElement("span", "property-pill is-default", "Current default"));
  }
  if (hook.proxyKind === "erc1967") {
    nodes.push(makeElement("span", "property-pill is-proxy", "ERC-1967"));
  }
  if (hook.verified === true) {
    nodes.push(makeElement("span", "property-pill is-verified", "Verified source"));
  }
  for (const mode of safeArray(hook.modes)) {
    if (nodes.length >= 3) break;
    nodes.push(modePill(mode));
  }
  return nodes;
}

function renderHookCard(hook) {
  const fragment = ui.cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".hook-card");
  const observed = fragment.querySelector(".observed-badge");
  const observedLabel = fragment.querySelector(".observed-label");
  const curated = isCurated(hook);

  card.dataset.address = hook.address;
  card.setAttribute("aria-haspopup", "dialog");
  card.setAttribute("aria-controls", "hook-drawer");
  fragment.querySelector(".card-title").textContent = hookName(hook);
  fragment.querySelector(".card-description").textContent = hookDescription(hook);

  if (hook.currentDefault === true) {
    observed.classList.add("is-curated");
    observedLabel.textContent = "Current default";
  } else if (curated) {
    observed.classList.add("is-curated");
    observedLabel.textContent = "Curated";
  } else {
    observedLabel.textContent = "Observed";
  }

  const taskCount = safeCount(hook.taskCount);
  const activeCount = safeCount(hook.activeTaskCount);
  fragment.querySelector(".usage-stat").textContent = activeCount
    ? `${plural(taskCount, "task")} · ${activeCount} active`
    : plural(taskCount, "task");
  fragment.querySelector(".card-properties").replaceChildren(...cardPropertyNodes(hook));

  card.addEventListener("click", () => openDrawer(hook, card));
  return fragment;
}

function hasFilters() {
  return Boolean(state.search.trim() || state.modes.size || state.activity.size || state.properties.size);
}

function renderResults() {
  const total = state.hooks.length;
  const shown = state.filteredHooks.length;
  if (state.unavailable) {
    ui.resultsCount.textContent = "Registry unavailable";
  } else {
    ui.resultsCount.textContent = `Showing ${shown} of ${total} ${total === 1 ? "hook" : "hooks"}`;
  }
  ui.clearFilters.hidden = !hasFilters();
  ui.grid.hidden = shown === 0 || state.unavailable;
  ui.empty.hidden = shown !== 0 || state.unavailable;

  if (!state.unavailable && shown === 0) {
    const registryIsEmpty = total === 0;
    ui.emptyTitle.textContent = registryIsEmpty ? "No public hooks indexed yet" : "No hooks match your filters";
    ui.emptyCopy.textContent = registryIsEmpty
      ? "The registry has not observed a hook contract on a public Taskmarket task yet."
      : "Try a different address, task mode, or activity filter.";
    ui.emptyClear.hidden = registryIsEmpty;
  }

  if (shown) {
    ui.grid.replaceChildren(...state.filteredHooks.map(renderHookCard));
  } else {
    ui.grid.replaceChildren();
  }
}

function applyFilters() {
  if (state.loading) return;
  state.filteredHooks = filterHooks();
  renderResults();
}

function clearAllFilters() {
  state.search = "";
  state.modes.clear();
  state.activity.clear();
  state.properties.clear();
  ui.search.value = "";
  renderFilterButtons();
  writeUrlState();
  applyFilters();
}

function validateRegistry(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.hooks)) {
    throw new TypeError("Registry response does not include a hooks array.");
  }
  return payload;
}

async function fetchPayload(url, signal) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return validateRegistry(await response.json());
}

function renderRegistryMeta(registry) {
  const totalHooks = safeCount(registry.totalHooks ?? registry.hooks.length);
  const hookedTasks = registry.hooks.reduce((sum, hook) => sum + safeCount(hook.taskCount), 0);
  ui.summary.textContent = `Browse ${plural(totalHooks, "hook contract")} across ${plural(hookedTasks, "observed public task-hook use")} on Base. Filter by mode, activity, and metadata.`;
  ui.lastUpdated.textContent = registry.generatedAt
    ? `Indexed ${formatDate(registry.generatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "";
}

function setRegistry(registry) {
  state.registry = registry;
  state.hooks = registry.hooks.filter((hook) => hook && typeof hook === "object" && hook.address);
  state.loading = false;
  state.unavailable = false;
  renderRegistryMeta(registry);
  applyFilters();
}

function showError(message, title = "Live registry unavailable.") {
  ui.errorTitle.textContent = title;
  ui.errorMessage.textContent = message;
  ui.errorBanner.hidden = false;
}

function hideError() {
  ui.errorBanner.hidden = true;
}

async function loadRegistry() {
  state.requestController?.abort();
  const controller = new AbortController();
  state.requestController = controller;
  hideError();

  if (registryMode === "static") {
    try {
      const snapshot = await fetchPayload(registrySnapshotUrl, controller.signal);
      if (controller.signal.aborted) return;
      setRegistry(snapshot);
    } catch (snapshotError) {
      if (controller.signal.aborted) return;
      state.loading = false;
      state.unavailable = true;
      state.hooks = [];
      state.filteredHooks = [];
      renderResults();
      showError(
        `The generated registry could not be loaded (${snapshotError.message}).`,
        "Registry snapshot unavailable.",
      );
    }
    return;
  }

  try {
    const liveRegistry = await fetchPayload(liveRegistryUrl, controller.signal);
    if (controller.signal.aborted) return;
    setRegistry(liveRegistry);
  } catch (liveError) {
    if (controller.signal.aborted) return;
    try {
      const snapshot = await fetchPayload(registrySnapshotUrl, controller.signal);
      if (controller.signal.aborted) return;
      setRegistry(snapshot);
      showError(`Showing the generated snapshot because the live Taskmarket index could not refresh (${liveError.message}).`);
    } catch (snapshotError) {
      if (controller.signal.aborted) return;
      state.loading = false;
      state.unavailable = true;
      state.hooks = [];
      state.filteredHooks = [];
      renderResults();
      showError(`Neither the live index nor its generated snapshot could be loaded (${snapshotError.message}).`);
    }
  }
}

function networkBadge() {
  const badge = makeElement("span", "network-badge");
  const image = document.createElement("img");
  image.src = new URL("./assets/base-network.svg", document.baseURI).href;
  image.alt = "";
  badge.append(image, document.createTextNode("Base"));
  return badge;
}

function detailSection(title) {
  const section = makeElement("section", "detail-section");
  section.append(makeElement("h3", "", title));
  return section;
}

function detailChip(value, highlighted = false) {
  return makeElement("span", `detail-chip${highlighted ? " is-highlighted" : ""}`, value);
}

function statBox(label, value) {
  const box = makeElement("div", "stat-box");
  box.append(makeElement("span", "", label), makeElement("strong", "", value));
  return box;
}

function externalLink(label, href, className = "drawer-link") {
  const link = makeElement("a", className, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

async function copyAddress(address, button) {
  try {
    await navigator.clipboard.writeText(address);
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy"; }, 1400);
  } catch {
    button.textContent = "Copy failed";
    window.setTimeout(() => { button.textContent = "Copy"; }, 1800);
  }
}

function buildDrawer(hook) {
  const inner = makeElement("div", "drawer-inner");
  const headingRow = makeElement("div", "drawer-heading-row");
  const headingCopy = makeElement("div");
  headingCopy.append(networkBadge());
  const title = makeElement("h2", "drawer-title", hookName(hook));
  title.id = "drawer-title";
  headingCopy.append(title, makeElement("p", "drawer-description", hookDescription(hook)));

  const closeButton = makeElement("button", "drawer-close", "Close");
  closeButton.type = "button";
  closeButton.addEventListener("click", closeDrawer);
  headingRow.append(headingCopy, closeButton);
  inner.append(headingRow);

  const addressSection = detailSection("Contract address");
  const addressRow = makeElement("div", "address-row");
  const code = makeElement("code", "address-code", hook.address);
  code.title = hook.address;
  const copyButton = makeElement("button", "copy-address", "Copy");
  copyButton.type = "button";
  copyButton.addEventListener("click", () => copyAddress(hook.address, copyButton));
  addressRow.append(
    code,
    copyButton,
    externalLink("BaseScan →", `https://basescan.org/address/${hook.address}`),
  );
  if (hook.sourceUrl) addressRow.append(externalLink("Source →", hook.sourceUrl));
  addressSection.append(addressRow);
  inner.append(addressSection);

  const statsSection = detailSection("Public usage");
  const stats = makeElement("div", "stat-grid");
  stats.append(
    statBox("Tasks", safeCount(hook.taskCount)),
    statBox("Active now", safeCount(hook.activeTaskCount)),
    statBox("Requesters", safeCount(hook.requesterCount)),
    statBox("First observed", formatDate(hook.firstSeen, { month: "short", day: "numeric", year: "numeric" })),
  );
  statsSection.append(stats);
  inner.append(statsSection);

  const statusSection = detailSection("Registry metadata");
  const statusChips = makeElement("div", "detail-chip-list");
  if (hook.currentDefault === true) statusChips.append(detailChip("Current default", true));
  else if (String(hook.defaultStatus || "").startsWith("historical")) statusChips.append(detailChip("Historical default", true));
  statusChips.append(detailChip(hook.verified === true ? "Behavior source verified" : "Behavior source unverified", hook.verified === true));
  if (hook.proxyKind === "erc1967") statusChips.append(detailChip("ERC-1967 proxy", true));
  else if (hook.proxyKind === "none") statusChips.append(detailChip("Direct contract"));
  else if (hook.proxyKind === "none_or_unknown") statusChips.append(detailChip("Non-ERC-1967 or unknown"));
  for (const category of safeArray(hook.categories)) statusChips.append(detailChip(titleCase(category)));
  if (hook.auditUrl) statusChips.append(detailChip("Audit linked", true));
  statusSection.append(statusChips);
  inner.append(statusSection);

  if (hook.implementationAddress) {
    const implementationSection = detailSection("Current implementation");
    const implementationRow = makeElement("div", "address-row");
    const implementationCode = makeElement("code", "address-code", hook.implementationAddress);
    implementationCode.title = hook.implementationAddress;
    implementationRow.append(
      implementationCode,
      externalLink("BaseScan →", `https://basescan.org/address/${hook.implementationAddress}`),
    );
    implementationSection.append(implementationRow);
    inner.append(implementationSection);
  }

  const modes = safeArray(hook.modes);
  if (modes.length) {
    const modesSection = detailSection("Task modes");
    const modeChips = makeElement("div", "detail-chip-list");
    modeChips.append(...modes.map((mode) => detailChip(titleCase(mode), true)));
    modesSection.append(modeChips);
    inner.append(modesSection);
  }

  const statuses = safeArray(hook.statuses);
  if (statuses.length) {
    const statusesSection = detailSection("Observed task states");
    const statusList = makeElement("div", "detail-chip-list");
    statusList.append(...statuses.map((status) => detailChip(
      titleCase(status),
      ACTIVE_STATUSES.has(status),
    )));
    statusesSection.append(statusList);
    inner.append(statusesSection);
  }

  const examples = safeArray(hook.exampleTasks);
  if (examples.length) {
    const tasksSection = detailSection("Example public tasks");
    const taskList = makeElement("div", "detail-task-list");
    for (const task of examples) {
      const link = externalLink("", `https://taskmarket.dev/tasks/${task.id}`, "detail-task-link");
      link.append(makeElement("strong", "", task.title || shortAddress(task.id)));
      const meta = makeElement("span", "detail-task-meta");
      meta.append(
        makeElement("span", "", titleCase(task.mode)),
        makeElement("span", "", titleCase(task.status)),
        makeElement("span", "", shortAddress(task.id)),
      );
      link.append(meta);
      taskList.append(link);
    }
    tasksSection.append(taskList);
    inner.append(tasksSection);
  }

  const resourceLinks = [
    ["Repository →", hook.repository],
    ["Homepage →", hook.homepage],
    ["Audit →", hook.auditUrl],
  ].filter(([, href]) => href);
  if (resourceLinks.length) {
    const resourcesSection = detailSection("Resources");
    const resources = makeElement("div", "address-row");
    resources.append(...resourceLinks.map(([label, href]) => externalLink(label, href)));
    resourcesSection.append(resources);
    inner.append(resourcesSection);
  }

  const noteSection = detailSection("Safety note");
  noteSection.append(makeElement(
    "p",
    "detail-note",
    "Hook addresses are attached immutably when a task is created and may block lifecycle transitions. Verify the address, source, proxy implementation, and hook-data encoding before funding a task.",
  ));
  inner.append(noteSection);
  return inner;
}

function openDrawer(hook, trigger) {
  state.selectedHook = hook;
  state.lastFocused = trigger || document.activeElement;
  ui.drawerContent.replaceChildren(buildDrawer(hook));
  ui.drawerLayer.hidden = false;
  document.body.classList.add("drawer-open");
  window.requestAnimationFrame(() => {
    ui.drawer.querySelector(".drawer-close")?.focus();
  });
}

function closeDrawer() {
  if (ui.drawerLayer.hidden) return;
  ui.drawerLayer.hidden = true;
  ui.drawerContent.replaceChildren();
  document.body.classList.remove("drawer-open");
  state.selectedHook = null;
  if (state.lastFocused instanceof HTMLElement && document.contains(state.lastFocused)) {
    state.lastFocused.focus();
  }
}

function trapDrawerFocus(event) {
  if (event.key !== "Tab" || ui.drawerLayer.hidden) return;
  const focusable = [...ui.drawer.querySelectorAll("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")]
    .filter((node) => !node.hidden && node.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    ui.drawer.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

ui.search.addEventListener("input", () => {
  state.search = ui.search.value;
  writeUrlState();
  applyFilters();
});

ui.filters.addEventListener("submit", (event) => {
  event.preventDefault();
  writeUrlState();
  applyFilters();
});

ui.clearFilters.addEventListener("click", clearAllFilters);
ui.emptyClear.addEventListener("click", clearAllFilters);
ui.retry.addEventListener("click", loadRegistry);
ui.drawerBackdrop.addEventListener("click", closeDrawer);
ui.drawer.addEventListener("keydown", trapDrawerFocus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.drawerLayer.hidden) closeDrawer();
});

window.addEventListener("popstate", () => {
  readUrlState();
  renderFilterButtons();
  applyFilters();
});

readUrlState();
renderFilterButtons();
loadRegistry();
