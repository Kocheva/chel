const DATA_URL = "./data/chelyabinsk_leaders_map.json";

const app = document.querySelector("#app");
let data;

const state = {
  mode: "organizations",
  municipalityId: "",
  topicId: "",
  roleId: "",
  fund: "",
  year: "",
  orgProfile: "",
  moreOpen: false,
  topicPageId: "",
  topicPeopleMode: "all",
  topicPersonRole: "",
  topicPersonMunicipality: "",
  topicPersonSort: "activity",
  topicProjectMunicipality: "",
  topicProjectFund: "",
  topicProjectYear: "",
};

const esc = (value = "") => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    if (key !== null && key !== undefined) (groups[key] ||= []).push(item);
    return groups;
  }, {});
}

function sumKnownFunding(projects) {
  return projects.reduce((sum, p) => sum + (p.amount_available && Number.isFinite(Number(p.grant_amount)) ? Number(p.grant_amount) : 0), 0);
}

function urlSafe(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function buildIndexes() {
  data.topicById = Object.fromEntries(data.topics.map((x) => [x.topic_id, x]));
  data.municipalityById = Object.fromEntries(data.municipalities.map((x) => [x.municipality_id, x]));
  data.roleById = Object.fromEntries(data.roles.map((x) => [x.role_id, x]));
  data.orgById = Object.fromEntries(data.organizations.map((x) => [x.org_id, x]));
  data.personById = Object.fromEntries(data.people.map((x) => [x.person_id, x]));
  data.projectById = Object.fromEntries(data.projects.map((x) => [x.project_id, x]));
  data.practiceById = Object.fromEntries(data.practices.map((x) => [x.practice_id, x]));
  data.orgLinksByPerson = groupBy(data.person_organization_links, (x) => x.person_id);
  data.personLinksByOrg = groupBy(data.person_organization_links, (x) => x.org_id);
  data.activitiesByPerson = groupBy(data.activities.filter((x) => x.person_evidence_status === "person_verified"), (x) => x.person_id);
  data.recognitionByPerson = groupBy(data.activities.filter((x) => x.activity_kind === "recognition" && x.person_id), (x) => x.person_id);
  data.activitiesByTopic = groupBy(data.activities, (x) => x.topic_id);
  data.councilsByPerson = groupBy(data.council_memberships, (x) => x.person_id);
  data.practicesByPerson = groupBy(data.practices, (x) => x.person_id);
  data.projectsByOrg = groupBy(data.projects, (x) => x.org_id);
  data.projectLinksByPerson = groupBy(data.person_project_links, (x) => x.person_id);
}

function selectedFilters(overrides = {}) {
  return {
    municipalityId: state.municipalityId,
    topicId: state.topicId,
    roleId: state.roleId,
    fund: state.fund,
    year: state.year,
    orgProfile: state.orgProfile,
    ...overrides,
  };
}

function personsForRole(roleId) {
  return roleId ? data.people.filter((p) => p.role_ids.includes(roleId)) : data.people;
}

function eligibleOrgIds(filters) {
  if (!filters.roleId) return null;
  const personIds = new Set(personsForRole(filters.roleId).map((p) => p.person_id));
  return new Set(data.person_organization_links.filter((l) => personIds.has(l.person_id)).map((l) => l.org_id));
}

function computeScope(filters = selectedFilters()) {
  const roleOrgIds = eligibleOrgIds(filters);
  const hasAdditionalProjectFilter = Boolean(filters.fund || filters.year);

  const matchingProjectForOrg = (orgId) => (data.projectsByOrg[orgId] || []).some((p) =>
    (!filters.fund || p.fund === filters.fund) &&
    (!filters.year || String(p.year) === String(filters.year))
  );

  const organizations = data.organizations.filter((org) =>
    (!filters.municipalityId || org.municipality_id === filters.municipalityId) &&
    (!filters.topicId || org.primary_topic_id === filters.topicId) &&
    (!filters.orgProfile || org.org_profile_type === filters.orgProfile) &&
    (!roleOrgIds || roleOrgIds.has(org.org_id)) &&
    (!hasAdditionalProjectFilter || matchingProjectForOrg(org.org_id))
  );

  const projects = data.projects.filter((project) => {
    const org = data.orgById[project.org_id];
    return Boolean(org) &&
      (!filters.municipalityId || project.municipality_id === filters.municipalityId) &&
      (!filters.topicId || project.topic_id === filters.topicId) &&
      (!filters.orgProfile || org.org_profile_type === filters.orgProfile) &&
      (!roleOrgIds || roleOrgIds.has(project.org_id)) &&
      (!filters.fund || project.fund === filters.fund) &&
      (!filters.year || String(project.year) === String(filters.year));
  });

  const people = data.people.filter((person) => {
    const orgIds = person.organization_ids || [];
    const projectPool = orgIds.flatMap((id) => data.projectsByOrg[id] || []);
    const hasProjectFilterMatch = projectPool.some((p) =>
      (!filters.fund || p.fund === filters.fund) &&
      (!filters.year || String(p.year) === String(filters.year))
    );
    return (!filters.municipalityId || (person.municipality_ids || [person.municipality_id]).includes(filters.municipalityId)) &&
      (!filters.topicId || person.topic_ids.includes(filters.topicId)) &&
      (!filters.roleId || person.role_ids.includes(filters.roleId)) &&
      (!filters.orgProfile || orgIds.some((id) => data.orgById[id]?.org_profile_type === filters.orgProfile)) &&
      (!hasAdditionalProjectFilter || hasProjectFilterMatch);
  });

  return {
    organizations,
    projects,
    people,
    funding: sumKnownFunding(projects),
    unknownFundingCount: projects.filter((p) => !p.amount_available).length,
  };
}

function header() {
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#/" aria-label="На главную">
          <span class="brand-logo-frame"><img class="brand-logo" src="./assets/grani-logo-base.png" alt="Центр ГРАНИ" /></span>
          <span><strong>Карта проектных лидеров Челябинской области</strong><span>Организации · проекты · практики</span></span>
        </a>
        <div class="global-search">
          <label class="hidden" for="global-search-input">Поиск по людям, организациям и проектам</label>
          <input id="global-search-input" type="search" autocomplete="off" placeholder="Найти человека, организацию или проект" aria-controls="search-results" />
          <div id="search-results" class="search-results hidden" role="listbox"></div>
        </div>
        <span class="search-hint">${integer.format(data.config.counts.people)} персон</span>
      </div>
    </header>`;
}

const SELECTION_TEXT = "Основа карты — руководители и представители организаций Челябинской области, реализовавших не менее двух проектов при поддержке ФПГ и ФГГ.";
const PROJECT_URL = "https://grany-center.org/note/komanda-centra-grani-pristupila-k-realizacii-proekta-tehnikum-mestnogo-eksperta-razvitie-kadrovogo-potenciala-dlya-ustoychivyh-soobshchestv-chelyabinskoy-oblasti-1774890579/";
const FOUNDATION_URL = "https://xn--74-6kcaaembt1fdnsfdygm4m.xn--p1ai/";
const SOURCE_NAMES = {
  "asi.org.ru":"Агентство социальной информации (АСИ)", "31tv.ru":"31 канал", "chel.kp.ru":"Комсомольская правда — Челябинск", "kp.ru":"Комсомольская правда", "1obl.ru":"Первый областной", "1obl.tv":"Первый областной — видео", "up74.ru":"Южноуральская панорама", "chel.aif.ru":"Аргументы и факты — Челябинск", "aif.ru":"Аргументы и факты", "mr-info.ru":"Магнитогорский рабочий", "magmetall.ru":"Магнитогорский металл", "vecherka.su":"Вечерний Челябинск", "verstov.info":"Верстов.Инфо", "op74.ru":"Общественная палата Челябинской области", "pchela.news":"Пчела", "ura.news":"URA.RU", "bfm74.ru":"Business FM Челябинск", "cheltv.ru":"ГТРК «Южный Урал»", "uralpress.ru":"Урал-пресс-информ", "polit74.ru":"Полит74", "chel.mk.ru":"Московский комсомолец — Челябинск", "74.ru":"74.RU", "kommersant.ru":"Коммерсантъ", "donorsforum.ru":"Форум Доноров", "fondpotanin.ru":"Благотворительный фонд Владимира Потанина", "fmb.chelreglib.ru":"Челябинская областная универсальная научная библиотека — ФМБ", "socioforum.pro":"Форум СОЦИО", "2024.socioforum.pro":"Форум СОЦИО — 2024", "2023.socioforum.pro":"Форум СОЦИО — 2023", "2022.socioforum.pro":"Форум СОЦИО — 2022", "leader-id.ru":"Leader-ID", "roscongress.ru":"Фонд Росконгресс", "culture.ru":"Культура.РФ", "cyberleninka.ru":"КиберЛенинка", "csu.ru":"Челябинский государственный университет", "susu.ru":"Южно-Уральский государственный университет", "rg.ru":"Российская газета", "fondmetallurg.ru":"Благотворительный фонд «Металлург»", "xn--74-6kcaaembt1fdnsfdygm4m.xn--p1ai":"Гранты Губернатора Челябинской области", "vk.com":"ВКонтакте", "t.me":"Telegram"
};
function publicSourceLink(href, label) {
  const safe = urlSafe(href);
  return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "";
}
function sourcePlatform(value, label = "") {
  const safe = urlSafe(value);
  if (!safe) return null;
  const u = new URL(safe), host = u.hostname.replace(/^www\./, "");
  const social = /(^|\.)(vk\.com|t\.me|telegram\.me|ok\.ru|youtube\.com|youtu\.be|dzen\.ru)$/.test(host);
  const fileHost = /(^|\.)(yandexcloud\.net|nubex\.ru)$/.test(host);
  // Organization profiles keep their own URL; media link to the publication platform.
  const href = label || social || fileHost ? safe : `${u.protocol}//${u.host}/`;
  return {href, label: label || SOURCE_NAMES[host] || host};
}
function sourceGroup(title, records, countLabel = "") {
  const distinct = new Map();
  records.filter(Boolean).forEach(x => { if (!distinct.has(x.href)) distinct.set(x.href, x); });
  const links = [...distinct.values()].sort((a,b) => a.label.localeCompare(b.label,"ru"));
  if (!links.length) return "";
  return `<details class="source-group"><summary>${esc(title)}${countLabel ? ` <span>${esc(countLabel)}</span>` : ""}<small>${links.length} источников</small></summary><ul class="source-links">${links.map(x => `<li>${publicSourceLink(x.href,x.label)}</li>`).join("")}</ul></details>`;
}
function sourcesContent() {
  const groups = [
    ["publication", "Публикации, интервью и экспертные комментарии"],
    ["event_role", "Выступления и экспертная работа"],
    ["recognition", "Публичное признание"]
  ];
  return `<section class="sources-content" aria-label="Источники данных">
    <h2>Источники</h2><p>Данные собраны из открытых источников. Ниже — фонды, СМИ, площадки и страницы организаций, использованные при подготовке карты. Ссылки на конкретные материалы доступны в карточках.</p>
    <div class="source-funds"><h3>Фонды — источники сведений о проектах</h3><ul>
      <li>${publicSourceLink("https://президентскиегранты.рф/", "Фонд президентских грантов (ФПГ)")}</li>
      <li>${publicSourceLink(FOUNDATION_URL, "Фонд поддержки гражданских инициатив Южного Урала — гранты Губернатора Челябинской области (ФГГ)")}</li>
    </ul></div>
    ${groups.map(([kind,title]) => {const rows=data.activities.filter(a=>a.activity_kind===kind);return sourceGroup(title,rows.map(a=>sourcePlatform(a.source_url)),`${rows.length} записей`);}).join("")}
    ${sourceGroup("Сайты и социальные сети организаций",data.organizations.flatMap(org => [...new Set([...splitUrls(org.website_urls),...splitUrls(org.site_url),...splitUrls(org.social_urls),...splitUrls(org.social_url),...splitUrls(org.tg_url)])].map(url=> { const safe=urlSafe(url);return safe ? sourcePlatform(safe,`${organizationName(org)} · ${new URL(safe).hostname.replace(/^www\./, "")}`) : null; })))}
  </section>`;
}
function footer() {
  return `<footer class="footer"><div class="footer-inner">
    <a class="methodology-link" href="#/methodology">Методология отбора</a>
    ${sourcesContent()}
    <div class="project-credit"><p>Создано в рамках проекта ${publicSourceLink(PROJECT_URL, "«Техникум местного эксперта: развитие кадрового потенциала для устойчивых сообществ Челябинской области»")} при поддержке ${publicSourceLink(FOUNDATION_URL, "Фонда «Центр поддержки гражданских инициатив и развития некоммерческого сектора экономики Челябинской области»")}</p>
    <p>${publicSourceLink("https://grany-center.org/", "Центр ГРАНИ")}</p></div>
  </div></footer>`;
}
function methodologyPage() {
  return `${header()}<main id="main" class="page-shell methodology-page"><a class="back-link" href="#/">← Вернуться к карте</a><h1>Методология отбора</h1>
    <section class="detail-section"><p class="lead">${esc(SELECTION_TEXT)}</p><p>ФПГ — Фонд президентских грантов; ФГГ — гранты Губернатора Челябинской области. Критерий относится к проектному опыту организации, а не к числу личных выступлений или публикаций её руководителя.</p><p>Сведения о публичной деятельности дополняют проектный опыт: роли спикера, тренера, эксперта и автора показаны по именным материалам открытых источников. В набор также включены самостоятельные публичные персоны; их карточки не означают соответствия организационному критерию.</p><p>Один человек учитывается один раз, даже если связан с несколькими организациями. Проекты организации и её награды не приписываются человеку как личные достижения.</p></section>
  </main>${footer()}`;
}

function option(value, label, selected = false) {
  return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
}

function filterLabel(type, id) {
  if (type === "municipalityId") return data.municipalityById[id]?.display_name || id;
  if (type === "topicId") return data.topicById[id]?.topic_short_name || id;
  if (type === "roleId") return data.roleById[id]?.role_short_name || id;
  if (type === "orgProfile") return id;
  return id;
}

function activeChips() {
  const keys = ["municipalityId", "topicId", "roleId", "fund", "year", "orgProfile"];
  const chips = keys.filter((key) => state[key]).map((key) => `
    <span class="filter-chip">${esc(filterLabel(key, state[key]))}<button type="button" data-clear-filter="${key}" aria-label="Убрать фильтр">×</button></span>`);
  return chips.length ? `<div class="active-chips">${chips.join("")}</div>` : "";
}

function filters() {
  const profiles = [...new Set(data.organization_profiles.map((x) => x.profile_name))];
  return `
    <section class="filter-card" aria-label="Фильтры карты">
      <div class="filter-main">
        <div><strong>Дополнительные фильтры</strong><span style="display:block;color:var(--muted);font-size:12px;margin-top:3px">Фонд и год</span></div>
        <div class="filter-actions">
          <button class="button" type="button" data-action="toggle-more" aria-expanded="${state.moreOpen}">${state.moreOpen ? "Скрыть" : "Показать"}</button>
          <button class="button ghost" type="button" data-action="reset">Сбросить</button>
        </div>
      </div>
      <div class="more-filters ${state.moreOpen ? "" : "hidden"}">
        <div class="field"><label for="fund-filter">Фонд</label><select id="fund-filter" data-filter="fund"><option value="">Все фонды</option>${data.config.funds.map((x) => option(x, x, state.fund === x)).join("")}</select></div>
        <div class="field"><label for="year-filter">Год</label><select id="year-filter" data-filter="year"><option value="">Все годы</option>${[...data.config.years].reverse().map((x) => option(x, x, String(state.year) === String(x))).join("")}</select></div>
        ${profiles.length ? `<div class="field"><label for="profile-filter">Профиль организации</label><select id="profile-filter" data-filter="orgProfile"><option value="">Все профили</option>${profiles.map((x) => option(x, x, state.orgProfile === x)).join("")}</select></div>` : ""}
      </div>
      ${activeChips()}
    </section>`;
}

function facetFilters() {
  const allRoleCount = computeScope(selectedFilters({ roleId: "" })).people.length;
  const roleChips = [
    `<button type="button" class="facet-chip ${!state.roleId ? "active" : ""}" data-role=""><span>Все роли</span><span class="facet-count">${allRoleCount}</span></button>`,
    ...data.roles.map((role) => {
      const count = computeScope(selectedFilters({ roleId: role.role_id })).people.length;
      return `<button type="button" class="facet-chip ${state.roleId === role.role_id ? "active" : ""}" data-role="${esc(role.role_id)}"><span>${esc(role.role_short_name)}</span><span class="facet-count">${count}</span></button>`;
    }),
  ];
  const allTopicCount = computeScope(selectedFilters({ topicId: "" })).people.length;
  const topicChips = [
    `<button type="button" class="facet-chip ${!state.topicId ? "active" : ""}" data-topic=""><span>Все темы</span><span class="facet-count">${allTopicCount}</span></button>`,
    ...data.topics.map((topic) => {
      const count = computeScope(selectedFilters({ topicId: topic.topic_id })).people.length;
      return `<button type="button" class="facet-chip ${state.topicId === topic.topic_id ? "active" : ""}" data-topic="${esc(topic.topic_id)}"><span>${esc(topic.topic_short_name)}</span><span class="facet-count">${count}</span></button>`;
    }),
  ];
  return `<div class="facet-grid"><div><p class="facet-group-title">Роль</p><div class="facet-chips">${roleChips.join("")}</div></div><div><p class="facet-group-title">Тема</p><div class="facet-chips">${topicChips.join("")}</div></div></div>`;
}

function modeSwitch() {
  const modes = [
    ["organizations", "Организации"], ["projects", "Проекты"], ["funding", "Финансирование"],
  ];
  return `<div class="mode-switch" role="group" aria-label="Режим данных">${modes.map(([id, label]) => `<button type="button" data-mode="${id}" class="${state.mode === id ? "active" : ""}">${label}</button>`).join("")}</div>`;
}

function contextTitle() {
  const bits = [];
  if (state.municipalityId) bits.push(data.municipalityById[state.municipalityId]?.display_name);
  if (state.topicId) bits.push(data.topicById[state.topicId]?.topic_name);
  return bits.length ? bits.join(" · ") : "Вся Челябинская область";
}

function summary(scope) {
  const knownProjects = scope.projects.length - scope.unknownFundingCount;
  const orgIds = new Set(scope.organizations.map((org) => org.org_id));
  const linked = data.person_organization_links.filter((link) => orgIds.has(link.org_id));
  const linkedPersonIds = new Set(linked.map((link) => link.person_id));
  const linkedLeaderIds = new Set(linked.filter((link) => link.is_leader).map((link) => link.person_id));
  const representativeCount = linkedPersonIds.size - linkedLeaderIds.size;
  return `
    <section class="summary-card" aria-label="Сводка выбранного среза">
      <div class="summary-copy">
        <p class="eyebrow">Текущий срез</p>
        <h2>${esc(contextTitle())}</h2>
        <p>Карточки ниже пересчитаны по выбранным условиям. Темы организаций и темы проектов считаются независимо, чтобы не смешивать две логики классификации.</p>
      </div>
      <div class="metric metric-people"><strong>${integer.format(linkedPersonIds.size)}</strong><span>персон в организациях · ${linkedLeaderIds.size} руководителей · ${representativeCount} представителей</span></div>
      <div class="metric"><strong>${integer.format(scope.organizations.length)}</strong><span>организаций</span></div>
      <div class="metric"><strong>${integer.format(scope.projects.length)}</strong><span>проектов</span></div>
      <div class="metric"><strong>${compact.format(scope.funding)} ₽</strong><span>известное финансирование · ${knownProjects} проектов</span></div>
    </section>`;
}

function municipalityCards() {
  const ranked = data.municipalities
    .map((m) => ({ m, scope: computeScope(selectedFilters({ municipalityId: m.municipality_id })) }))
    .sort((a, b) => b.scope.people.length - a.scope.people.length || b.scope.projects.length - a.scope.projects.length || a.m.display_name.localeCompare(b.m.display_name, "ru"));
  const cards = ranked.map(({ m, scope }, index) => {
    const topicCount = new Set([
      ...scope.organizations.map((o) => o.primary_topic_id),
      ...scope.projects.map((p) => p.topic_id),
      ...scope.people.flatMap((p) => p.topic_ids || []),
    ].filter(Boolean)).size;
    const publicPeopleCount = scope.people.filter((person) => person.has_confirmed_public_activity).length;
    return `
      <button type="button" class="municipality-card ${index < 3 ? "top-rank" : ""} ${state.municipalityId === m.municipality_id ? "active" : ""}" data-municipality="${esc(m.municipality_id)}">
        <span class="municipality-public"><b>${publicPeopleCount}</b><span>с публичной<br>деятельностью</span></span>
        <strong>${esc(m.display_name)}</strong>
        <span class="municipality-people"><b>${scope.people.length}</b><span>${scope.people.length === 1 ? "персона" : "персон"}</span></span>
        <span class="micro-metrics">
          <span><b>${scope.organizations.length}</b>организаций</span>
          <span><b>${scope.projects.length}</b>проектов</span>
          <span><b>${topicCount}</b>тем</span>
          <span><b>${compact.format(scope.funding)}</b>₽</span>
        </span>
      </button>`;
  });
  return `<section class="panel"><div class="panel-head"><h2>${data.municipalities.length} муниципалитет</h2><p>Рейтинг по числу персон · нажмите карточку для выбора территории</p></div><div class="municipality-grid">${cards.join("")}</div></section>`;
}

function topicCards() {
  const brandColors = ["#E51A4B", "#7A87A2", "#B2B3B3"];
  const cards = data.topics.map((t, index) => {
    const scope = computeScope(selectedFilters({ topicId: t.topic_id }));
    const modeValue = state.mode === "organizations" ? scope.organizations.length : state.mode === "projects" ? scope.projects.length : scope.funding;
    const modeLabel = state.mode === "organizations" ? "организаций" : state.mode === "projects" ? "проектов" : "₽ известного финансирования";
    return `
      <article class="topic-card ${state.topicId === t.topic_id ? "active" : ""}" style="--topic-color:${brandColors[index % brandColors.length]}">
        <h3>${esc(t.topic_name)}</h3>
        <div class="topic-count"><b>${integer.format(scope.people.length)}</b><span>персон</span></div>
        <div class="topic-mode-value"><b>${state.mode === "funding" ? compact.format(modeValue) : integer.format(modeValue)}</b><span>${modeLabel}</span></div>
        <div class="topic-actions"><button type="button" data-topic="${esc(t.topic_id)}">Выбрать</button><a href="#/topic/${encodeURIComponent(t.topic_id)}">Открыть тему →</a></div>
      </article>`;
  });
  return `${modeSwitch()}<section class="panel"><div class="panel-head"><h2>Темы</h2><p>Число персон — главный показатель; переключатель меняет дополнительный показатель</p></div><div class="topic-grid">${cards.join("")}</div></section>`;
}

function personCard(person) {
  const municipality = (person.municipality_ids || [person.municipality_id]).map(id => data.municipalityById[id]?.display_name).filter(Boolean).join(" · ");
  const preferredOrgId = person.leader_organization_ids?.[0] || person.organization_ids?.[0];
  const preferredOrg = preferredOrgId ? data.orgById[preferredOrgId] : null;
  const roles = person.role_ids.slice(0, 3).map((id) => `<span class="tag role">${esc(data.roleById[id]?.role_short_name || id)}</span>`).join("");
  const topics = person.topic_ids.slice(0, 2).map((id) => `<span class="tag">${esc(data.topicById[id]?.topic_short_name || id)}</span>`).join("");
  return `<a class="person-card" href="#/person/${encodeURIComponent(person.person_id)}">
    <div class="person-card-top"><div><h3>${esc(person.person_name)}</h3>${preferredOrg ? `<p class="person-card-org">${esc(organizationName(preferredOrg))}</p>` : ""}<p>${esc(municipality || "Муниципалитет не указан")}</p></div><span class="confirmations">${person.confirmations_count} подтв.</span></div>
    <div class="tags">${roles}${topics}${person.practice_count ? `<span class="tag">Практики · ${person.practice_count}</span>` : ""}</div>
  </a>`;
}

function peoplePanel(scope) {
  const sorted = [...scope.people].sort((a, b) => b.confirmations_count - a.confirmations_count || a.person_name.localeCompare(b.person_name, "ru"));
  return `<aside class="panel people-panel"><div class="panel-head"><h2>Лидеры</h2><p>${sorted.length} в срезе</p></div><div class="people-list">${sorted.length ? sorted.map(personCard).join("") : `<div class="empty">По выбранным условиям персон не найдено</div>`}</div></aside>`;
}

function mainPage() {
  const scope = computeScope();
  return `${header()}<main id="main" class="page-shell">
    <p class="eyebrow">Публичная навигация по социальной сфере</p>
    <h1>Карта проектных лидеров Челябинской области</h1>
    <p class="lead selection-summary">${esc(SELECTION_TEXT)} <a href="#/methodology">Методология и источники →</a></p>
    <section class="filter-card primary-filters" aria-label="Основные фильтры"><div class="panel-head"><h2>Темы и роли</h2><p>Можно выбрать тему и роль одновременно</p></div>${facetFilters()}</section>
    ${filters()}
    ${summary(scope)}
    <div class="dashboard-grid"><div>${topicCards()}${municipalityCards()}</div>${peoplePanel(scope)}</div>
  </main>${footer()}`;
}

function roleTags(person) {
  return person.role_ids.length ? `<div class="tags">${person.role_ids.map((id) => `<span class="tag role">${esc(data.roleById[id]?.role_name || id)}</span>`).join("")}</div>` : `<p class="notice">Публичная роль по именным источникам пока не подтверждена.</p>`;
}

function practiceBox(practice) {
  const source = practice.source_urls?.map((url) => urlSafe(url)).find(Boolean);
  return `<article class="practice-box">
    <h3>${esc(practice.practice_name)}</h3>
    <p>${esc(practice.format_or_technology || "Механизм требует дополнительного описания.")}</p>
    ${practice.transferability_summary ? `<p><strong>Что можно тиражировать:</strong> ${esc(practice.transferability_summary)}</p>` : ""}
    ${practice.territory ? `<small>${esc(practice.territory)}</small>` : ""}
    ${source ? `<p><a class="source-link" target="_blank" rel="noopener noreferrer" href="${esc(source)}">Источник ↗</a></p>` : ""}
  </article>`;
}

function organizationName(org) {
  if (!org) return "Организация";
  if (cleanPublicValue(org.organization_name_short)) return org.organization_name_short;
  const full = cleanPublicValue(org.organization_name);
  if (!full) return org.org_id || "Организация";
  const quoted = [...full.matchAll(/["«]([^"»]{3,})["»]/g)].map((match) => match[1].trim()).filter(Boolean);
  return quoted[0] || full;
}

function cleanPublicValue(value) {
  const text = String(value ?? "").trim();
  return !text || /^(unknown|undefined|null|неизвестно|не указано)$/i.test(text) ? "" : text;
}

function splitUrls(value) {
  if (Array.isArray(value)) return value.flatMap(splitUrls);
  return String(value || "").split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
}

function personExternalLinks(orgs) {
  const seen = new Set();
  const links = [];
  orgs.forEach((org) => {
    const candidates = [
      ...splitUrls(org.website_urls), ...splitUrls(org.site_url),
      ...splitUrls(org.social_urls), ...splitUrls(org.social_url), ...splitUrls(org.tg_url),
    ];
    candidates.forEach((value) => {
      const url = urlSafe(value);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      const type = host === "vk.com" || host.endsWith(".vk.com") ? "vk" : host === "t.me" || host.endsWith(".t.me") || host === "telegram.me" ? "telegram" : "site";
      const label = type === "vk" ? "VK" : type === "telegram" ? "Telegram" : host;
      links.push({ url, type, label });
    });
  });
  if (!links.length) return "";
  return `<div class="person-links" aria-label="Сайт и социальные сети организации"><span>Сайт и соцсети организации</span><div>${links.map((link) => `<a class="person-link ${link.type}" target="_blank" rel="noopener noreferrer" href="${esc(link.url)}">${esc(link.label)} ↗</a>`).join("")}</div></div>`;
}

function personOrganizationIntro(person, orgs) {
  const leaderIds = new Set(person.leader_organization_ids || []);
  if (!orgs.length) return "";
  return `<div class="person-org-intro">${orgs.map((org) => `<div><span>${leaderIds.has(org.org_id) ? "Руководитель" : "Связь с организацией"}</span> — <a href="#/organization/${encodeURIComponent(org.org_id)}">${esc(organizationName(org))}</a></div>`).join("")}</div>${personExternalLinks(orgs)}`;
}

const activityRoleNames = {
  speaker: "Спикер",
  trainer: "Тренер",
  expert: "Эксперт",
  moderator: "Модератор",
  organizer: "Организатор",
  author: "Автор",
};

function activityRoleName(value) {
  const key = cleanPublicValue(value).toLowerCase();
  return activityRoleNames[key] || cleanPublicValue(value);
}

function activityTitleLink(activity, fallback) {
  const title = cleanPublicValue(activity.activity_title) || fallback;
  const url = urlSafe(activity.source_url);
  return url ? `<a target="_blank" rel="noopener noreferrer" href="${esc(url)}"><strong>${esc(title)}</strong></a>` : `<strong>${esc(title)}</strong>`;
}

function expandableCards(items, renderItem, limit = 6) {
  const first = items.slice(0, limit).map(renderItem).join("");
  const rest = items.slice(limit);
  return `${first}${rest.length ? `<details class="content-more"><summary>Показать ещё ${rest.length}</summary><div class="content-more-list">${rest.map(renderItem).join("")}</div></details>` : ""}`;
}

function eventCard(activity) {
  const roleKey = cleanPublicValue(activity.role_class).toLowerCase();
  const role = activityRoleName(roleKey);
  const meta = [activity.year, cleanPublicValue(activity.platform_name)].filter(Boolean).join(" · ");
  return `<article class="activity-card" data-event-item data-event-role="${esc(roleKey)}">
    <div class="activity-card-meta"><span>${esc(meta || "Сведения о площадке не указаны")}</span>${role ? `<span class="activity-role">${esc(role)}</span>` : ""}</div>
    ${activityTitleLink(activity, "Участие в публичном мероприятии")}
    ${activity.quote ? `<p>${esc(activity.quote)}</p>` : ""}
  </article>`;
}

function publicationCard(activity) {
  const typeKey = cleanPublicValue(activity.publication_type) || "other";
  const typeLabel = typeKey === "other" ? "Публикация" : typeKey.charAt(0).toUpperCase() + typeKey.slice(1);
  const meta = [cleanPublicValue(activity.platform_name), activity.year].filter(Boolean).join(" · ");
  return `<article class="publication-card" data-publication-item data-publication-type="${esc(typeKey)}">
    <div class="activity-card-meta"><span>${esc(meta || "Источник не указан")}</span><span class="activity-role">${esc(typeLabel)}</span></div>
    ${activityTitleLink(activity, "Публикация")}
    ${activity.quote ? `<blockquote>${esc(activity.quote)}</blockquote>` : ""}
  </article>`;
}

function recognitionCard(activity) {
  const org = data.orgById[activity.org_id];
  const result = cleanPublicValue(activity.award_or_nomination) || cleanPublicValue(activity.project_or_practice_name);
  const recipient = activity.person_evidence_status === "person_verified" ? "" : organizationName(org);
  return `<article class="recognition-card">
    <div class="recognition-mark" aria-hidden="true">★</div><div>
      ${activityTitleLink(activity, "Публичное признание")}
      ${result ? `<p>${esc(result)}</p>` : ""}
      <small>${[recipient ? `Получатель: ${recipient}` : "", activity.year].filter(Boolean).map(esc).join(" · ")}</small>
    </div>
  </article>`;
}

function councilCard(council) {
  const role = cleanPublicValue(council.person_role);
  const period = council.start_year && council.end_year ? `${council.start_year}–${council.end_year}` : council.start_year ? `с ${council.start_year} года` : council.end_year ? `до ${council.end_year} года` : cleanPublicValue(council.period_note);
  const url = urlSafe(council.source_url);
  const title = esc(council.council_name || "Совет или экспертный орган");
  return `<li>${url ? `<a target="_blank" rel="noopener noreferrer" href="${esc(url)}"><strong>${title}</strong></a>` : `<strong>${title}</strong>`}${[role, period].filter(Boolean).length ? `<small>${[role, period].filter(Boolean).map(esc).join(" · ")}</small>` : ""}</li>`;
}

function roleCountChips(events) {
  const counts = new Map();
  events.forEach((activity) => {
    const key = cleanPublicValue(activity.role_class).toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  const order = ["speaker", "trainer", "expert", "moderator", "organizer", "author"];
  const keys = [...order.filter((key) => counts.has(key)), ...[...counts.keys()].filter((key) => !order.includes(key))];
  if (!keys.length) return "";
  return `<div class="activity-filters" role="group" aria-label="Фильтр мероприятий по роли"><button class="activity-filter active" type="button" data-person-event-role="" aria-pressed="true">Все <b>${events.length}</b></button>${keys.map((key) => `<button class="activity-filter" type="button" data-person-event-role="${esc(key)}" aria-pressed="false">${esc(activityRoleName(key))} <b>${counts.get(key)}</b></button>`).join("")}</div>`;
}

function publicationCountChips(publications) {
  const counts = new Map();
  publications.forEach((activity) => {
    const key = cleanPublicValue(activity.publication_type) || "other";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const label = (key) => key === "other" ? "Другие" : key.charAt(0).toUpperCase() + key.slice(1);
  return `<div class="activity-filters" role="group" aria-label="Фильтр публикаций по типу"><button class="activity-filter active" type="button" data-person-publication-type="" aria-pressed="true">Все <b>${publications.length}</b></button>${[...counts].map(([key, count]) => `<button class="activity-filter" type="button" data-person-publication-type="${esc(key)}" aria-pressed="false">${esc(label(key))} <b>${count}</b></button>`).join("")}</div>`;
}

function personPage(personId) {
  const person = data.personById[personId];
  if (!person) return notFound("Персона не найдена");
  const orgs = person.organization_ids.map((id) => data.orgById[id]).filter(Boolean);
  const activities = [...(data.activitiesByPerson[personId] || [])].sort((a, b) => (b.year || 0) - (a.year || 0));
  const events = activities.filter((a) => a.activity_kind === "event_role");
  const publications = activities.filter((a) => a.activity_kind === "publication");
  const recognition = [...(data.recognitionByPerson[personId] || [])].sort((a, b) => (b.year || 0) - (a.year || 0));
  const councils = data.councilsByPerson[personId] || [];
  const practices = data.practicesByPerson[personId] || [];
  const projectLinks = data.projectLinksByPerson[personId] || [];
  const projects = projectLinks.map((x) => data.projectById[x.project_id]).filter(Boolean);
  const municipality = (person.municipality_ids || [person.municipality_id]).map(id => data.municipalityById[id]?.display_name).filter(Boolean).join(" · ");
  return `${header()}<main id="main" class="page-shell">
    <section class="detail-hero person-hero"><a class="back-link" href="#/">← Вернуться к карте</a><p class="eyebrow">Карточка персоны</p><h1>${esc(person.person_name)}</h1><p class="lead">${esc(person.person_summary || "Краткое описание пока не заполнено.")}</p>${personOrganizationIntro(person, orgs)}${roleTags(person)}</section>
    <div class="detail-layout"><div>
      <section class="detail-section"><h2>Публичная деятельность</h2><div class="fact-grid person-fact-grid">
        <div class="fact-box"><strong>${events.length}</strong><span>выступлений и экспертных участий</span></div>
        <div class="fact-box"><strong>${publications.length}</strong><span>публикаций и комментариев</span></div>
        <div class="fact-box"><strong>${councils.length}</strong><span>участий в советах</span></div>
        <div class="fact-box"><strong>${practices.length}</strong><span>практик</span></div>
      </div></section>
      ${practices.length ? `<section class="detail-section"><h2>Практики</h2>${practices.map(practiceBox).join("")}</section>` : ""}
      ${events.length ? `<section class="detail-section"><div class="section-heading-row"><h2>Выступления и экспертная работа</h2><span>${events.length}</span></div>${roleCountChips(events)}<div class="activity-list">${expandableCards(events, eventCard, 7)}</div></section>` : ""}
      ${publications.length ? `<section class="detail-section"><div class="section-heading-row"><h2>Публикации и комментарии</h2><span>${publications.length}</span></div>${publicationCountChips(publications)}<div class="publication-list">${expandableCards(publications, publicationCard, 6)}</div></section>` : ""}
      ${recognition.length ? `<section class="detail-section"><h2>Публичное признание</h2><div class="recognition-list">${recognition.map(recognitionCard).join("")}</div></section>` : ""}
      ${councils.length ? `<section class="detail-section"><h2>Советы и экспертные органы</h2><ul class="data-list council-list">${councils.map(councilCard).join("")}</ul></section>` : ""}
      ${projects.length ? `<section class="detail-section"><h2>Проекты организации</h2><ul class="data-list project-list">${projects.sort((a,b) => (b.year || 0) - (a.year || 0)).map((p) => `<li><a href="#/project/${encodeURIComponent(p.project_id)}"><strong>${esc(p.project_title)}</strong></a><small>${[p.year, p.fund, p.amount_available ? `${money.format(p.grant_amount)} ₽` : "сумма неизвестна"].filter(Boolean).map(esc).join(" · ")}</small>${p.project_goal ? `<p class="project-goal"><span>Цель:</span> ${esc(p.project_goal)}</p>` : ""}</li>`).join("")}</ul></section>` : ""}
    </div><aside>
      <section class="detail-section"><h2>Профиль</h2><ul class="data-list"><li><strong>Муниципалитет</strong><small>${esc(municipality || "Не указан")}</small></li><li><strong>Последний год активности</strong><small>${esc(person.last_activity_year || "Не указан")}</small></li></ul></section>
      <section class="detail-section"><h2>Темы</h2><div class="tags">${person.topic_ids.map((id) => `<a class="tag" href="#/topic/${encodeURIComponent(id)}">${esc(data.topicById[id]?.topic_name || id)}</a>`).join("")}</div></section>
      <section class="detail-section"><h2>Организации</h2><ul class="data-list">${orgs.map((o) => `<li><a href="#/organization/${encodeURIComponent(o.org_id)}"><strong>${esc(o.organization_name_short || o.organization_name)}</strong></a><small>${esc(o.org_profile_type || "")}</small></li>`).join("") || `<li><small>Связи не указаны</small></li>`}</ul></section>
    </aside></div>
  </main>${footer()}`;
}

function topicPeopleSets(topicId, topicOrgIds) {
  const all = data.people.filter((person) =>
    person.topic_ids.includes(topicId) || (person.organization_ids || []).some((orgId) => topicOrgIds.has(orgId))
  );
  const leaders = all.filter((person) =>
    person.role_ids.includes("ROLE_ORG_LEADER") && (person.leader_organization_ids || []).some((orgId) => topicOrgIds.has(orgId))
  );
  const publicPeople = data.people.filter((person) =>
    person.has_confirmed_public_activity && (person.evidence_topic_ids || []).includes(topicId)
  );
  return { leaders, all, public: publicPeople };
}

function topicPersonCard(person, topicId, topicOrgIds) {
  const topicLeaderOrgId = (person.leader_organization_ids || []).find((orgId) => topicOrgIds.has(orgId));
  const topicOrgId = topicLeaderOrgId || (person.organization_ids || []).find((orgId) => topicOrgIds.has(orgId)) || person.organization_ids?.[0];
  const org = topicOrgId ? data.orgById[topicOrgId] : null;
  const municipality = (person.municipality_ids || [person.municipality_id]).map(id => data.municipalityById[id]?.display_name).filter(Boolean).join(" · ");
  const projectCount = (data.projectLinksByPerson[person.person_id] || []).filter((link) => data.projectById[link.project_id]?.topic_id === topicId).length;
  const reason = topicLeaderOrgId ? "Руководитель организации темы" : (person.evidence_topic_ids || []).includes(topicId) ? "Публичная деятельность по теме" : "Представитель организации темы";
  const roles = person.role_ids.map((roleId) => `<span class="tag role">${esc(data.roleById[roleId]?.role_short_name || roleId)}</span>`).join("");
  return `<a class="topic-person-card" href="#/person/${encodeURIComponent(person.person_id)}">
    <div class="topic-person-main"><div><h3>${esc(person.person_name)}</h3>${org ? `<p class="topic-person-org">${esc(organizationName(org))}</p>` : ""}<p>${esc(municipality || "Муниципалитет не указан")}</p></div><span class="confirmations">${person.confirmations_count} подтв.</span></div>
    <p class="topic-person-reason">${esc(reason)}</p>
    <div class="tags">${roles}${projectCount ? `<span class="tag">Проекты · ${projectCount}</span>` : ""}${person.practice_count ? `<span class="tag">Практики · ${person.practice_count}</span>` : ""}</div>
  </a>`;
}

function topicPracticeBox(practice) {
  const person = data.personById[practice.person_id];
  const orgId = person?.leader_organization_ids?.[0] || person?.organization_ids?.[0];
  const org = orgId ? data.orgById[orgId] : null;
  const municipality = person ? (person.municipality_ids || [person.municipality_id]).map(id => data.municipalityById[id]?.display_name).filter(Boolean).join(" · ") : cleanPublicValue(practice.territory);
  const source = practice.source_urls?.map((url) => urlSafe(url)).find(Boolean);
  return `<article class="practice-box topic-practice-box">
    <h3>${esc(practice.practice_name)}</h3>
    ${person ? `<div class="practice-holder"><span>Носитель практики</span><a href="#/person/${encodeURIComponent(person.person_id)}">${esc(person.person_name)}</a></div>` : ""}
    <p class="practice-context">${[org ? organizationName(org) : "", municipality, cleanPublicValue(practice.person_role_in_practice)].filter(Boolean).map(esc).join(" · ")}</p>
    ${practice.format_or_technology ? `<p>${esc(practice.format_or_technology)}</p>` : ""}
    ${practice.transferability_summary ? `<p><strong>Что можно тиражировать:</strong> ${esc(practice.transferability_summary)}</p>` : ""}
    ${source ? `<p><a class="source-link" target="_blank" rel="noopener noreferrer" href="${esc(source)}">Источник ↗</a></p>` : ""}
  </article>`;
}

function topicEvidenceSection(title, items, renderer, emptyText) {
  return `<details class="detail-section topic-evidence" ${items.length ? "" : "disabled"}>
    <summary><span>${esc(title)}</span><b>${items.length}</b></summary>
    <div class="topic-evidence-body">${items.length ? expandableCards(items, renderer, 5) : `<div class="empty">${esc(emptyText)}</div>`}</div>
  </details>`;
}

function topicPage(topicId) {
  const topic = data.topicById[topicId];
  if (!topic) return notFound("Тема не найдена");
  if (state.topicPageId !== topicId) Object.assign(state, {
    topicPageId: topicId, topicPeopleMode: "all", topicPersonRole: "", topicPersonMunicipality: "", topicPersonSort: "activity",
    topicProjectMunicipality: "", topicProjectFund: "", topicProjectYear: "",
  });

  const topicOrganizations = data.organizations.filter((org) => org.primary_topic_id === topicId);
  const topicProjects = data.projects.filter((project) => project.topic_id === topicId);
  const topicOrgIds = new Set([...topicOrganizations.map((org) => org.org_id), ...topicProjects.map((project) => project.org_id)]);
  const peopleSets = topicPeopleSets(topicId, topicOrgIds);
  const basePeople = peopleSets[state.topicPeopleMode] || peopleSets.all;
  const roleBase = basePeople.filter((person) => !state.topicPersonMunicipality || (person.municipality_ids || [person.municipality_id]).includes(state.topicPersonMunicipality));
  const roleCounts = data.roles.map((role) => ({ ...role, count: roleBase.filter((person) => person.role_ids.includes(role.role_id)).length })).filter((role) => role.count);
  const municipalityBase = basePeople.filter((person) => !state.topicPersonRole || person.role_ids.includes(state.topicPersonRole));
  const municipalityRows = data.municipalities.map((municipality) => ({ municipality, count: municipalityBase.filter((person) => (person.municipality_ids || [person.municipality_id]).includes(municipality.municipality_id)).length })).filter((row) => row.count).sort((a, b) => b.count - a.count || a.municipality.display_name.localeCompare(b.municipality.display_name, "ru"));
  const filteredPeople = basePeople.filter((person) =>
    (!state.topicPersonRole || person.role_ids.includes(state.topicPersonRole)) &&
    (!state.topicPersonMunicipality || (person.municipality_ids || [person.municipality_id]).includes(state.topicPersonMunicipality))
  ).sort((a, b) => {
    if (state.topicPersonSort === "name") return a.person_name.localeCompare(b.person_name, "ru");
    if (state.topicPersonSort === "projects") {
      const projectCount = (person) => (data.projectLinksByPerson[person.person_id] || []).filter((link) => data.projectById[link.project_id]?.topic_id === topicId).length;
      return projectCount(b) - projectCount(a) || b.confirmations_count - a.confirmations_count;
    }
    return b.confirmations_count - a.confirmations_count || b.activity_count - a.activity_count || a.person_name.localeCompare(b.person_name, "ru");
  });

  const practices = data.practices.filter((practice) => practice.primary_topic_id === topicId);
  const allTopicActivities = [...(data.activitiesByTopic[topicId] || [])].sort((a, b) => (b.year || 0) - (a.year || 0));
  const events = allTopicActivities.filter((activity) => activity.activity_kind === "event_role" && activity.person_evidence_status === "person_verified");
  const publications = allTopicActivities.filter((activity) => activity.activity_kind === "publication" && activity.person_evidence_status === "person_verified");
  const recognition = allTopicActivities.filter((activity) => activity.activity_kind === "recognition");
  const knownFunding = sumKnownFunding(topicProjects);
  const representedMunicipalities = new Set([...topicProjects.map((project) => project.municipality_id), ...peopleSets.all.flatMap((person) => person.municipality_ids || [person.municipality_id])].filter(Boolean)).size;

  const projectMunicipalities = [...new Set(topicProjects.map((project) => project.municipality_id).filter(Boolean))].sort((a, b) => (data.municipalityById[a]?.display_name || "").localeCompare(data.municipalityById[b]?.display_name || "", "ru"));
  const projectFunds = [...new Set(topicProjects.map((project) => project.fund).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  const projectYears = [...new Set(topicProjects.map((project) => project.year).filter(Boolean))].sort((a, b) => b - a);
  const filteredProjects = topicProjects.filter((project) =>
    (!state.topicProjectMunicipality || project.municipality_id === state.topicProjectMunicipality) &&
    (!state.topicProjectFund || project.fund === state.topicProjectFund) &&
    (!state.topicProjectYear || String(project.year) === String(state.topicProjectYear))
  ).sort((a, b) => (b.year || 0) - (a.year || 0) || a.project_title.localeCompare(b.project_title, "ru"));

  const peopleModeTabs = [
    ["leaders", "Руководители", peopleSets.leaders.length],
    ["all", "Все персоны", peopleSets.all.length],
    ["public", "С публичной деятельностью", peopleSets.public.length],
  ];
  return `${header()}<main id="main" class="page-shell">
    <section class="detail-hero topic-hero"><a class="back-link" href="#/">← Вернуться к карте</a><p class="eyebrow">Тема проектной деятельности</p><h1>${esc(topic.topic_name)}</h1><p class="lead">Организации учитываются по своей основной теме, а проекты и финансирование — по теме конкретного проекта. Наборы персон можно переключать отдельно.</p>
      <div class="fact-grid topic-fact-grid"><div class="fact-box"><strong>${topicOrganizations.length}</strong><span>организаций</span></div><div class="fact-box"><strong>${topicProjects.length}</strong><span>проектов</span></div><div class="fact-box"><strong>${compact.format(knownFunding)} ₽</strong><span>известное финансирование</span></div><div class="fact-box fact-people"><strong>${peopleSets.all.length}</strong><span>всех связанных персон</span></div><div class="fact-box"><strong>${peopleSets.public.length}</strong><span>с публичной деятельностью</span></div></div>
    </section>
    <section class="detail-section topic-insight"><div><p class="eyebrow">Связь с темой</p><h2>Масштаб и публичная представленность</h2></div><div class="topic-insight-metrics"><span><b>${representedMunicipalities}</b> муниципалитетов</span><span><b>${practices.length}</b> практик</span><span><b>${events.length}</b> мероприятий</span><span><b>${publications.length}</b> публикаций</span><span><b>${recognition.length}</b> фактов признания</span></div></section>

    <section class="detail-section topic-people-section">
      <div class="section-heading-row"><div><p class="eyebrow">Люди темы</p><h2>Лидеры и представители</h2></div><span>${filteredPeople.length}</span></div>
      <div class="topic-people-tabs" role="group" aria-label="Набор персон">${peopleModeTabs.map(([id, label, count]) => `<button type="button" class="${state.topicPeopleMode === id ? "active" : ""}" data-topic-people-mode="${id}">${label}<b>${count}</b></button>`).join("")}</div>
      <div class="topic-person-controls">
        <div class="field"><label for="topic-role-filter">Роль</label><select id="topic-role-filter" data-topic-person-filter="role"><option value="">Все роли</option>${roleCounts.map((role) => option(role.role_id, `${role.role_short_name} · ${role.count}`, state.topicPersonRole === role.role_id)).join("")}</select></div>
        <div class="field"><label for="topic-municipality-filter">Муниципалитет</label><select id="topic-municipality-filter" data-topic-person-filter="municipality"><option value="">Все муниципалитеты</option>${municipalityRows.map(({ municipality, count }) => option(municipality.municipality_id, `${municipality.display_name} · ${count}`, state.topicPersonMunicipality === municipality.municipality_id)).join("")}</select></div>
        <div class="field"><label for="topic-person-sort">Сортировка</label><select id="topic-person-sort" data-topic-person-sort><option value="activity" ${state.topicPersonSort === "activity" ? "selected" : ""}>По публичной активности</option><option value="projects" ${state.topicPersonSort === "projects" ? "selected" : ""}>По числу проектов</option><option value="name" ${state.topicPersonSort === "name" ? "selected" : ""}>По алфавиту</option></select></div>
      </div>
      <div class="topic-analytics-grid"><div><h3>Ролевой профиль</h3><div class="role-profile">${roleCounts.map((role) => `<button type="button" class="role-profile-row ${state.topicPersonRole === role.role_id ? "active" : ""}" data-topic-role="${esc(role.role_id)}"><span>${esc(role.role_short_name)}</span><i><b style="width:${Math.max(5, (role.count / Math.max(...roleCounts.map((item) => item.count), 1)) * 100)}%"></b></i><strong>${role.count}</strong></button>`).join("") || `<p class="empty">Роли не указаны</p>`}</div></div><div><h3>Муниципалитеты</h3><div class="municipality-chips">${municipalityRows.map(({ municipality, count }) => `<button type="button" class="${state.topicPersonMunicipality === municipality.municipality_id ? "active" : ""}" data-topic-municipality="${esc(municipality.municipality_id)}">${esc(municipality.display_name)} <b>${count}</b></button>`).join("") || `<p class="empty">Территории не указаны</p>`}</div></div></div>
      <div class="topic-people-grid">${filteredPeople.map((person) => topicPersonCard(person, topicId, topicOrgIds)).join("") || `<div class="empty">По выбранным условиям персон не найдено</div>`}</div>
    </section>

    ${practices.length ? `<section class="detail-section"><div class="section-heading-row"><div><p class="eyebrow">Опыт для тиражирования</p><h2>Практики</h2></div><span>${practices.length}</span></div><div class="topic-practice-grid">${practices.map(topicPracticeBox).join("")}</div></section>` : ""}

    <section class="detail-section"><div class="section-heading-row"><div><p class="eyebrow">Проектная деятельность</p><h2>Все проекты по теме</h2></div><span>${filteredProjects.length}</span></div>
      <div class="topic-project-filters"><div class="field"><label for="topic-project-municipality">Муниципалитет</label><select id="topic-project-municipality" data-topic-project-filter="municipality"><option value="">Все муниципалитеты</option>${projectMunicipalities.map((id) => option(id, data.municipalityById[id]?.display_name || id, state.topicProjectMunicipality === id)).join("")}</select></div><div class="field"><label for="topic-project-year">Год</label><select id="topic-project-year" data-topic-project-filter="year"><option value="">Все годы</option>${projectYears.map((year) => option(year, year, String(state.topicProjectYear) === String(year))).join("")}</select></div><div class="field"><label for="topic-project-fund">Фонд</label><select id="topic-project-fund" data-topic-project-filter="fund"><option value="">Все фонды</option>${projectFunds.map((fund) => option(fund, fund, state.topicProjectFund === fund)).join("")}</select></div></div>
      <ul class="data-list topic-project-list">${filteredProjects.map((project) => { const org = data.orgById[project.org_id]; const municipality = data.municipalityById[project.municipality_id]?.display_name; return `<li><a href="#/project/${encodeURIComponent(project.project_id)}"><strong>${esc(project.project_title)}</strong></a>${org ? `<a class="project-org" href="#/organization/${encodeURIComponent(org.org_id)}">${esc(organizationName(org))}</a>` : ""}<small>${[municipality, project.year, project.fund, project.amount_available ? `${money.format(project.grant_amount)} ₽` : ""].filter(Boolean).map(esc).join(" · ")}</small>${project.project_goal ? `<p class="project-goal"><span>Цель:</span> ${esc(project.project_goal)}</p>` : ""}</li>`; }).join("") || `<li><small>По выбранным условиям проектов нет</small></li>`}</ul>
    </section>

    <section class="topic-evidence-grid">${topicEvidenceSection("Площадки и события", events, eventCard, "События по теме пока не представлены")}${topicEvidenceSection("Публикации и комментарии", publications, publicationCard, "Публикации по теме пока не представлены")}${topicEvidenceSection("Публичное признание", recognition, recognitionCard, "Факты признания по теме пока не представлены")}</section>
  </main>${footer()}`;
}

function organizationPage(orgId) {
  const org = data.orgById[orgId];
  if (!org) return notFound("Организация не найдена");
  const topic = data.topicById[org.primary_topic_id];
  const municipality = data.municipalityById[org.municipality_id];
  const people = (data.personLinksByOrg[orgId] || []).map((l) => data.personById[l.person_id]).filter(Boolean);
  const projects = data.projectsByOrg[orgId] || [];
  const known = projects.filter((p) => p.amount_available);
  const websites = [...(org.website_urls || []), ...(org.social_urls || [])].map(urlSafe).filter(Boolean);
  return `${header()}<main id="main" class="page-shell"><section class="detail-hero"><a class="back-link" href="#/">← Вернуться к карте</a><p class="eyebrow">Карточка организации</p><h1>${esc(org.organization_name_short || org.organization_name)}</h1><p class="lead">${esc(org.organization_name)}</p><div class="fact-grid"><div class="fact-box"><strong>${projects.length}</strong><span>проектов</span></div><div class="fact-box"><strong>${compact.format(sumKnownFunding(projects))} ₽</strong><span>известное финансирование</span></div><div class="fact-box"><strong>${people.length}</strong><span>связанных персон</span></div></div></section>
  <div class="detail-layout"><div><section class="detail-section"><h2>Проекты</h2><ul class="data-list">${projects.map((p) => `<li><a href="#/project/${encodeURIComponent(p.project_id)}"><strong>${esc(p.project_title)}</strong></a><small>${esc(p.year)} · ${esc(p.fund)} · ${p.amount_available ? `${money.format(p.grant_amount)} ₽` : "сумма неизвестна"}${p.project_goal ? ` · Цель: ${esc(p.project_goal)}` : ""}</small></li>`).join("") || `<li><small>Нет проектов</small></li>`}</ul></section></div><aside><section class="detail-section"><h2>Профиль</h2><ul class="data-list"><li><strong>Муниципалитет</strong><small>${esc(municipality?.display_name || "Не указан")}</small></li><li><strong>Тема</strong><small><a href="#/topic/${encodeURIComponent(org.primary_topic_id)}">${esc(topic?.topic_name || "Не указана")}</a></small></li><li><strong>Профиль</strong><small>${esc(org.org_profile_type || "Не указан")}</small></li><li><strong>Известные суммы</strong><small>${known.length} из ${projects.length} проектов</small></li></ul>${websites.map((x) => `<p><a class="source-link" target="_blank" rel="noopener noreferrer" href="${esc(x)}">Внешняя ссылка ↗</a></p>`).join("")}</section><section class="detail-section"><h2>Люди</h2>${people.map(personCard).join("") || `<div class="empty">Связи не указаны</div>`}</section></aside></div></main>${footer()}`;
}

function projectPage(projectId) {
  const p = data.projectById[projectId];
  if (!p) return notFound("Проект не найден");
  const org = data.orgById[p.org_id];
  const topic = data.topicById[p.topic_id];
  const municipality = data.municipalityById[p.municipality_id];
  return `${header()}<main id="main" class="page-shell"><section class="detail-hero"><a class="back-link" href="#/">← Вернуться к карте</a><p class="eyebrow">Карточка проекта</p><h1>${esc(p.project_title)}</h1>${p.project_goal ? `<p class="lead"><strong>Цель:</strong> ${esc(p.project_goal)}</p>` : ""}</section><div class="detail-layout"><div><section class="detail-section"><h2>Основные сведения</h2><ul class="data-list"><li><strong>Организация</strong><small><a href="#/organization/${encodeURIComponent(p.org_id)}">${esc(org?.organization_name_short || org?.organization_name || p.org_id)}</a></small></li><li><strong>Тема проекта</strong><small><a href="#/topic/${encodeURIComponent(p.topic_id)}">${esc(topic?.topic_name || p.topic_id)}</a></small></li><li><strong>Муниципалитет</strong><small>${esc(municipality?.display_name || "Не указан")}</small></li></ul></section></div><aside><section class="detail-section"><h2>Финансирование</h2><div class="fact-box"><strong>${p.amount_available ? `${money.format(p.grant_amount)} ₽` : "Сумма не указана"}</strong><span>${esc(p.fund || "Фонд не указан")} · ${esc(p.year || "Год не указан")}</span></div></section></aside></div></main>${footer()}`;
}

function notFound(title) {
  return `${header()}<main id="main" class="page-shell"><section class="error-card"><h1>${esc(title)}</h1><p><a href="#/">Вернуться на главную</a></p></section></main>${footer()}`;
}

function parseRoute() {
  const path = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { section: path[0] || "home", id: decodeURIComponent(path[1] || "") };
}

function render(options = {}) {
  const preserveScroll = Boolean(options?.preserveScroll);
  const previousScroll = Number.isFinite(window.scrollY) ? window.scrollY : 0;
  const route = parseRoute();
  if (route.section === "methodology") app.innerHTML = methodologyPage();
  else if (route.section === "person") app.innerHTML = personPage(route.id);
  else if (route.section === "topic") app.innerHTML = topicPage(route.id);
  else if (route.section === "organization") app.innerHTML = organizationPage(route.id);
  else if (route.section === "project") app.innerHTML = projectPage(route.id);
  else app.innerHTML = mainPage();
  bindCommon();
  if (route.section === "home") bindMain();
  if (route.section === "person") bindPerson();
  if (route.section === "topic") bindTopic();
  document.title = route.section === "home" ? data.config.title : `${document.querySelector("h1")?.textContent || "Карточка"} — ${data.config.title}`;
  window.scrollTo({ top: preserveScroll ? previousScroll : 0, behavior: "auto" });
}

function bindCommon() {
  const input = document.querySelector("#global-search-input");
  const results = document.querySelector("#search-results");
  if (!input || !results) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase("ru");
    if (query.length < 2) { results.classList.add("hidden"); results.innerHTML = ""; return; }
    const contains = (value) => String(value || "").toLocaleLowerCase("ru").includes(query);
    const people = data.people.filter((p) => contains(p.person_name)).slice(0, 6);
    const orgs = data.organizations.filter((o) => contains(o.organization_name) || contains(o.organization_name_short)).slice(0, 5);
    const projects = data.projects.filter((p) => contains(p.project_title) || contains(p.project_goal)).slice(0, 5);
    const block = (title, items, renderer) => items.length ? `<div class="search-section-title">${title}</div>${items.map(renderer).join("")}` : "";
    results.innerHTML = block("Люди", people, (p) => `<a class="search-item" role="option" href="#/person/${encodeURIComponent(p.person_id)}">${esc(p.person_name)}<small>${esc(data.municipalityById[p.municipality_id]?.display_name || "")}</small></a>`) +
      block("Организации", orgs, (o) => `<a class="search-item" role="option" href="#/organization/${encodeURIComponent(o.org_id)}">${esc(o.organization_name_short || o.organization_name)}<small>${esc(data.topicById[o.primary_topic_id]?.topic_short_name || "")}</small></a>`) +
      block("Проекты", projects, (p) => `<a class="search-item" role="option" href="#/project/${encodeURIComponent(p.project_id)}">${esc(p.project_title)}<small>${esc(p.year || "")} · ${esc(p.fund || "")}</small></a>`);
    if (!results.innerHTML) results.innerHTML = `<div class="empty">Совпадений нет</div>`;
    results.classList.remove("hidden");
  });
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") results.classList.add("hidden"); });
  document.addEventListener("click", (event) => { if (!event.target.closest(".global-search")) results.classList.add("hidden"); }, { once: true });
}

function bindMain() {
  const rerender = () => render({ preserveScroll: true });
  document.querySelectorAll("[data-filter]").forEach((select) => select.addEventListener("change", () => { state[select.dataset.filter] = select.value; rerender(); }));
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.mode; rerender(); }));
  document.querySelectorAll("[data-municipality]").forEach((button) => button.addEventListener("click", () => { state.municipalityId = state.municipalityId === button.dataset.municipality ? "" : button.dataset.municipality; rerender(); }));
  document.querySelectorAll("[data-topic]").forEach((button) => button.addEventListener("click", () => { state.topicId = state.topicId === button.dataset.topic ? "" : button.dataset.topic; rerender(); }));
  document.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", () => { state.roleId = state.roleId === button.dataset.role ? "" : button.dataset.role; rerender(); }));
  document.querySelectorAll("[data-clear-filter]").forEach((button) => button.addEventListener("click", () => { state[button.dataset.clearFilter] = ""; rerender(); }));
  document.querySelector("[data-action='toggle-more']")?.addEventListener("click", () => { state.moreOpen = !state.moreOpen; rerender(); });
  document.querySelector("[data-action='reset']")?.addEventListener("click", () => {
    Object.assign(state, { municipalityId: "", topicId: "", roleId: "", fund: "", year: "", orgProfile: "" });
    rerender();
  });
}

function bindPerson() {
  const bindFilter = ({ buttonSelector, itemSelector, buttonKey, itemKey }) => {
    const buttons = [...document.querySelectorAll(buttonSelector)];
    const items = [...document.querySelectorAll(itemSelector)];
    buttons.forEach((button) => button.addEventListener("click", () => {
      const value = button.dataset[buttonKey] || "";
      buttons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      items.forEach((item) => { item.hidden = Boolean(value) && item.dataset[itemKey] !== value; });
      button.closest(".detail-section")?.querySelectorAll(".content-more").forEach((details) => { details.open = Boolean(value); });
    }));
  };
  bindFilter({ buttonSelector: "[data-person-event-role]", itemSelector: "[data-event-item]", buttonKey: "personEventRole", itemKey: "eventRole" });
  bindFilter({ buttonSelector: "[data-person-publication-type]", itemSelector: "[data-publication-item]", buttonKey: "personPublicationType", itemKey: "publicationType" });
}

function bindTopic() {
  const rerender = () => render({ preserveScroll: true });
  document.querySelectorAll("[data-topic-people-mode]").forEach((button) => button.addEventListener("click", () => {
    state.topicPeopleMode = button.dataset.topicPeopleMode;
    state.topicPersonRole = "";
    state.topicPersonMunicipality = "";
    rerender();
  }));
  document.querySelector("[data-topic-person-filter='role']")?.addEventListener("change", (event) => { state.topicPersonRole = event.target.value; rerender(); });
  document.querySelector("[data-topic-person-filter='municipality']")?.addEventListener("change", (event) => { state.topicPersonMunicipality = event.target.value; rerender(); });
  document.querySelector("[data-topic-person-sort]")?.addEventListener("change", (event) => { state.topicPersonSort = event.target.value; rerender(); });
  document.querySelectorAll("[data-topic-role]").forEach((button) => button.addEventListener("click", () => {
    state.topicPersonRole = state.topicPersonRole === button.dataset.topicRole ? "" : button.dataset.topicRole;
    rerender();
  }));
  document.querySelectorAll("[data-topic-municipality]").forEach((button) => button.addEventListener("click", () => {
    state.topicPersonMunicipality = state.topicPersonMunicipality === button.dataset.topicMunicipality ? "" : button.dataset.topicMunicipality;
    rerender();
  }));
  document.querySelector("[data-topic-project-filter='municipality']")?.addEventListener("change", (event) => { state.topicProjectMunicipality = event.target.value; rerender(); });
  document.querySelector("[data-topic-project-filter='year']")?.addEventListener("change", (event) => { state.topicProjectYear = event.target.value; rerender(); });
  document.querySelector("[data-topic-project-filter='fund']")?.addEventListener("change", (event) => { state.topicProjectFund = event.target.value; rerender(); });
}

async function start() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    buildIndexes();
    window.addEventListener("hashchange", render);
    render();
  } catch (error) {
    app.innerHTML = `<main class="error-card"><h1>Не удалось загрузить данные</h1><p>Откройте сайт через HTTP-сервер, а не напрямую как локальный файл.</p><pre>${esc(error.message)}</pre></main>`;
  }
}

start();
