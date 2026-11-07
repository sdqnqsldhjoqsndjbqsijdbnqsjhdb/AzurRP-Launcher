'use strict';

/* ──────────────────────────────────────────────────────────────
   AzurRP Launcher — interface
   ────────────────────────────────────────────────────────────── */

const bridge = window.azur;

const FALLBACK_AVATAR = '../../assets/brand/avatar-fallback.svg';
const KNOWN_NEWS_IMAGES = new Set(['news-festival.svg', 'news-market.svg', 'news-lore.svg']);
const STATUS_LABELS = {
  idle: 'Prêt',
  preparing: 'Préparation',
  downloading: 'Téléchargement',
  running: 'En jeu'
};

const state = {
  session: null,
  settings: null,
  system: null,
  content: null,
  server: null,
  game: { status: 'idle' },
  serverBusy: false,
  refreshingContent: false,
  overlayMode: null,
  consoleLines: [],
  booted: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function icon(name) {
  return `<svg class="icon"><use href="#i-${name}"/></svg>`;
}

function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function setAvatar(image, username) {
  if (!image) return;
  const name = String(username || '').trim();
  if (/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    image.src = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/96`;
  } else {
    image.src = FALLBACK_AVATAR;
  }
  image.onerror = () => {
    image.onerror = null;
    image.src = FALLBACK_AVATAR;
  };
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(date);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} Mo`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond) || 0;
  if (value <= 0) return '';
  return `${formatBytes(value)}/s`;
}

function formatDuration(seconds) {
  const value = Math.round(Number(seconds) || 0);
  if (value <= 0) return '';
  if (value < 60) return `${value} s restantes`;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes} min ${String(rest).padStart(2, '0')} s restantes`;
}

function platformLabel(platform) {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return 'Desktop';
}

function serverAddress() {
  const settings = state.settings || {};
  const host = settings.serverHost || 'play.azur-rp.eu';
  const port = Number(settings.serverPort) || 25565;
  return port === 25565 ? host : `${host}:${port}`;
}

/* ── Toasts ─────────────────────────────────────────────── */

function toast(message, { type = 'info', title = '', timeout = 5200 } = {}) {
  const container = $('#toasts');
  if (!container) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  const heading = title || (type === 'success' ? 'Succès' : type === 'error' ? 'Erreur' : 'Information');
  element.innerHTML = `
    ${icon(iconName)}
    <div class="toast-body">
      <strong>${escapeHtml(heading)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
    <button type="button" class="toast-close" aria-label="Fermer">${icon('close')}</button>
  `;
  const remove = () => {
    if (!element.isConnected) return;
    element.classList.add('leaving');
    setTimeout(() => element.remove(), 260);
  };
  element.querySelector('.toast-close').addEventListener('click', remove);
  container.appendChild(element);
  if (timeout > 0) setTimeout(remove, timeout);
  while (container.children.length > 4) container.firstElementChild.remove();
}

/* ── Clipboard ──────────────────────────────────────────── */

async function copyText(text, successMessage = 'Copié dans le presse-papiers.') {
  const value = String(text ?? '');
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast(successMessage, { type: 'success', title: 'Copié' });
  } catch {
    toast('Impossible d’utiliser le presse-papiers.', { type: 'error' });
  }
}

/* ── Screens & navigation ───────────────────────────────── */

function setScreen(name) {
  const boot = $('#boot-screen');
  const login = $('#login-screen');
  const main = $('#main-screen');
  if (!boot || !login || !main) return;
  boot.classList.toggle('hidden', name !== 'boot');
  login.classList.toggle('hidden', name !== 'login');
  main.classList.toggle('hidden', name !== 'main');
  document.body.classList.toggle('in-app', name === 'main');
}

const VIEW_TITLES = {
  play: 'TABLEAU DE BORD',
  news: 'JOURNAL',
  server: 'SERVEUR',
  settings: 'CONFIGURATION'
};

function showView(name) {
  const target = VIEW_TITLES[name] ? name : 'play';
  $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.viewPanel === target));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === target));
  const eyebrow = $('#view-eyebrow');
  if (eyebrow) eyebrow.textContent = VIEW_TITLES[target];
  const workspace = $('.workspace');
  if (workspace) workspace.scrollTop = 0;
}

/* ── Auth ───────────────────────────────────────────────── */

let authMode = 'login';

function switchAuthTab(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  $$('.auth-tab').forEach((tab) => {
    const active = tab.dataset.authTab === authMode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  const isRegister = authMode === 'register';
  $('#login-form')?.classList.toggle('hidden', isRegister);
  $('#register-form')?.classList.toggle('hidden', !isRegister);
  const title = $('#auth-title');
  const subtitle = $('#auth-subtitle');
  if (title) title.textContent = isRegister ? 'Rejoins Azur City.' : 'Bon retour, citoyen.';
  if (subtitle) {
    subtitle.textContent = isRegister
      ? 'Un pseudo, un email, un mot de passe : ta vie en ville commence ici.'
      : 'Connecte-toi avec ton compte AzurRP pour retrouver ta vie en ville.';
  }
  clearFormError(isRegister ? 'register' : 'login');
  setTimeout(() => {
    const field = isRegister ? $('#register-username') : $('#login-identifier');
    field?.focus();
  }, 30);
}

function setFormError(which, message) {
  const element = $(`#${which}-error`);
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('visible', Boolean(message));
}

function clearFormError(which) {
  setFormError(which, '');
}

function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle('loading', busy);
  button.disabled = busy;
}

function updatePasswordMeter(value) {
  const bar = $('#password-meter-bar');
  if (!bar) return;
  const password = String(value || '');
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const percent = password ? Math.min(100, 18 + score * 16) : 0;
  const color = score <= 1 ? '#ff7b86' : score <= 3 ? '#e5bd72' : '#6ee7bd';
  bar.style.width = `${percent}%`;
  bar.style.background = color;
}

function togglePassword(button) {
  const targetId = button.dataset.togglePassword;
  const input = document.getElementById(targetId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  const use = button.querySelector('use');
  if (use) use.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
}

async function handleLogin(event) {
  event.preventDefault();
  clearFormError('login');
  const identifier = $('#login-identifier')?.value.trim() || '';
  const password = $('#login-password')?.value || '';
  if (!identifier) return setFormError('login', 'Indique ton pseudo ou ton email.');
  if (!password) return setFormError('login', 'Indique ton mot de passe.');

  const button = $('#login-submit');
  setBusy(button, true);
  try {
    const remember = Boolean($('#remember-me')?.checked);
    if (state.settings && state.settings.rememberSession !== remember) {
      state.settings = await bridge.settings.save({ rememberSession: remember });
    }
    const result = await bridge.auth.login({ identifier, password });
    $('#login-password').value = '';
    await enterApp(result.session);
    toast(`Heureux de te revoir, ${result.user.username}.`, { type: 'success', title: 'Connecté' });
  } catch (error) {
    setFormError('login', error.message || 'Connexion impossible.');
  } finally {
    setBusy(button, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  clearFormError('register');
  const username = $('#register-username')?.value.trim() || '';
  const email = $('#register-email')?.value.trim() || '';
  const password = $('#register-password')?.value || '';
  const confirm = $('#register-confirm')?.value || '';

  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    return setFormError('register', 'Le pseudo doit contenir 3 à 16 lettres, chiffres ou tirets bas.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return setFormError('register', 'Cette adresse email n’est pas valide.');
  }
  if (password.length < 8) {
    return setFormError('register', 'Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (password.length > 72) {
    return setFormError('register', 'Le mot de passe ne peut pas dépasser 72 caractères.');
  }
  if (password !== confirm) {
    return setFormError('register', 'Les deux mots de passe ne correspondent pas.');
  }

  const button = $('#register-submit');
  setBusy(button, true);
  try {
    const result = await bridge.auth.register({ username, email, password });
    if (state.settings && !state.settings.rememberSession) {
      state.settings = await bridge.settings.save({ rememberSession: true });
    }
    $$('#register-form input').forEach((input) => { input.value = ''; });
    updatePasswordMeter('');
    await enterApp(result.session);
    toast('Ton compte est créé. Bienvenue à Azur City.', { type: 'success', title: 'Compte créé' });
  } catch (error) {
    setFormError('register', error.message || 'Inscription impossible.');
  } finally {
    setBusy(button, false);
  }
}

async function logout() {
  try {
    await bridge.auth.logout();
  } catch {
    // La déconnexion locale est déjà faite côté processus principal.
  }
  state.session = null;
  applyFounderSettingsAccess(null);
  state.server = null;
  clearConsole();
  resetGameUi();
  openConsole(false);
  $('#launch-overlay')?.classList.add('hidden');
  state.overlayMode = null;
  switchAuthTab('login');
  setScreen('login');
  toast('Tu es déconnecté.', { type: 'info', title: 'À bientôt' });
}

function applyUser(user) {
  if (!user) return;
  const username = user.username || 'Citoyen';
  $$('[data-username]').forEach((element) => { element.textContent = username; });
  $$('[data-role]').forEach((element) => {
    element.textContent = user.role === 'admin' ? 'Fondateur' : user.role === 'staff' ? 'Staff' : 'Joueur';
  });
  const created = $('#account-created');
  if (created) created.textContent = formatDate(user.createdAt);
  const email = $('#account-email');
  if (email) email.textContent = user.email || '—';
  $$('[data-avatar]').forEach((image) => setAvatar(image, username));
  const greeting = $('#greeting');
  if (greeting) greeting.innerHTML = `Bonjour, <span data-username>${escapeHtml(username)}</span>.`;
  applyFounderSettingsAccess(user);
}

function applyFounderSettingsAccess(user = state.session?.user) {
  const allowed = user?.role === 'admin';
  $('#founder-server-settings')?.classList.toggle('hidden', !allowed);
  $('#founder-api-settings')?.classList.toggle('hidden', !allowed);
  $('#founder-forge-settings')?.classList.toggle('hidden', !allowed);
  $('#forge-required-note')?.classList.toggle('hidden', allowed);
}

/* ── App entry ──────────────────────────────────────────── */

async function enterApp(session) {
  if (session?.user) {
    state.session = session;
    applyUser(session.user);
  } else if (!state.session) {
    state.session = session;
  }
  setScreen('main');
  showView('play');
  await Promise.allSettled([loadContent(true), refreshServer(true)]);
}

/* ── Content ────────────────────────────────────────────── */

function resolveNewsImage(name) {
  const value = String(name || '').trim();
  // Une URL distante doit être HTTPS, sans guillemets ni chevrons : elle est
  // insérée dans un attribut `src`, donc on refuse tout caractère capable de
  // sortir de l'attribut (défense en profondeur contre l'injection HTML).
  if (value.length <= 2000 && /^https:\/\/[^\s"'<>`]+$/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch {
      // Repli sur l'illustration locale.
    }
  }
  const clean = value.split('/').pop();
  if (KNOWN_NEWS_IMAGES.has(clean)) return `../../assets/art/${clean}`;
  return '../../assets/art/news-lore.svg';
}

function renderNewsPreview() {
  const container = $('#news-preview');
  if (!container) return;
  const items = (state.content?.news || []).slice(0, 3);
  if (!items.length) {
    container.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line short"></div>';
    return;
  }
  container.innerHTML = items.map((item) => `
    <div class="news-preview-item">
      <img class="news-preview-thumb" src="${resolveNewsImage(item.image)}" alt="">
      <div class="news-preview-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.tag)} · ${escapeHtml(formatShortDate(item.publishedAt))}</span>
      </div>
    </div>
  `).join('');
}

function renderNewsGrid() {
  const grid = $('#news-grid');
  if (!grid) return;
  const items = state.content?.news || [];
  if (!items.length) {
    grid.innerHTML = `<article class="card detail-card"><h3>Aucune actualité</h3><p>Le serveur n’a pas encore publié de nouvelle. Reviens bientôt.</p></article>`;
    return;
  }
  grid.innerHTML = items.map((item, index) => `
    <article class="news-card${index === 0 ? ' news-card-wide' : ''}">
      <div class="news-image">
        <span class="news-tag">${escapeHtml(item.tag)}</span>
        <img src="${resolveNewsImage(item.image)}" alt="">
      </div>
      <div class="news-body">
        <span class="news-date">${escapeHtml(formatDate(item.publishedAt))}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.excerpt)}</p>
      </div>
    </article>
  `).join('');
}

function renderContent() {
  renderNewsPreview();
  renderNewsGrid();
  const offline = $('#news-offline-banner');
  if (offline) offline.classList.toggle('hidden', !state.content?.offline);
  if (state.content?.links) applyServerIp();
}

async function loadContent(force = false) {
  if (state.refreshingContent) return;
  state.refreshingContent = true;
  try {
    const data = await bridge.content.get();
    state.content = data;
    renderContent();
    if (data?.offline && force) {
      const announcement = data.announcement;
      if (announcement) toast(announcement, { type: 'info', title: 'Annonce', timeout: 8000 });
    }
  } catch (error) {
    state.content = null;
    renderNewsPreview();
    toast(error.message || 'Actualités indisponibles.', { type: 'error' });
  } finally {
    state.refreshingContent = false;
  }
}

/* ── Server status ──────────────────────────────────────── */

function applyStatusDot(element, online) {
  if (!element) return;
  element.classList.remove('online', 'offline', 'pending');
  if (online === null) element.classList.add('pending');
  else element.classList.add(online ? 'online' : 'offline');
}

function setText(selector, value) {
  $$(selector).forEach((element) => { element.textContent = value; });
}

function applyServerIp() {
  setText('[data-server-ip]', serverAddress());
}

function renderServerStatus() {
  const status = state.server;
  const online = status ? Boolean(status.online) : null;
  const players = status?.players;
  const playerText = players ? `${players.online} / ${players.max}` : '— / —';

  ['#titlebar-status .status-dot', '#header-server .status-dot', '#quick-status .status-dot', '#server-big-status .status-dot', '#sidebar-server .status-dot'].forEach((selector) => {
    applyStatusDot($(selector), online);
  });

  setText('#titlebar-status-text', status ? (online ? `Serveur en ligne · ${players?.online ?? 0} joueurs` : 'Serveur hors ligne') : 'Vérification du serveur…');
  setText('#header-status-text', status ? (online ? 'En ligne' : 'Hors ligne') : 'Vérification');
  setText('#header-players', players ? `${players.online} joueur${players.online > 1 ? 's' : ''}` : '— joueur');

  const heroOrb = $('.hero-status-orb');
  if (heroOrb) {
    heroOrb.classList.toggle('online', Boolean(online));
    heroOrb.classList.toggle('offline', online === false);
  }
  setText('#hero-status', status ? (online ? 'Serveur en ligne' : 'Serveur hors ligne') : 'Connexion…');
  setText('#hero-players', playerText);
  setText('#hero-online-label', online ? 'SERVEUR MODERN RP' : 'SERVEUR INDISPONIBLE');

  setText('#sidebar-status', status ? (online ? 'En ligne' : 'Hors ligne') : 'Vérification…');
  setText('#sidebar-players', players ? `${players.online} joueur${players.online > 1 ? 's' : ''}` : '— joueurs');

  const quick = $('#quick-status');
  if (quick) {
    quick.classList.toggle('online', Boolean(online));
    quick.classList.toggle('offline', online === false);
    quick.innerHTML = `<span class="status-dot ${online === null ? 'pending' : online ? 'online' : 'offline'}"></span>${status ? (online ? 'En ligne' : 'Hors ligne') : 'Vérification'}`;
  }
  setText('#quick-version', status?.version || '1.12.2');
  setText('#quick-players', players ? String(players.online) : '—');
  setText('#quick-ping', status?.ping != null ? `${status.ping} ms` : '—');
  setText('#quick-motd', status?.motd || (online === false ? 'Le serveur ne répond pas pour le moment.' : 'Connexion au serveur Azur City…'));

  const big = $('#server-big-status');
  if (big) {
    big.classList.toggle('online', Boolean(online));
    big.classList.toggle('offline', online === false);
    big.innerHTML = `<span class="status-dot ${online === null ? 'pending' : online ? 'online' : 'offline'}"></span>${status ? (online ? 'En ligne' : 'Hors ligne') : 'Vérification'}`;
  }
  setText('#server-big-motd', status?.motd || (online === false ? 'Le serveur ne répond pas pour le moment.' : 'Récupération des informations du serveur…'));
  setText('#server-big-players', playerText);
  setText('#server-big-ping', status?.ping != null ? `${status.ping} ms` : '—');
  setText('#server-big-version', status?.version || '1.12.2');
  applyServerIp();
}

async function refreshServer(force = false) {
  if (state.serverBusy) return;
  state.serverBusy = true;
  $$('#sidebar-refresh, #server-refresh, #server-refresh-big').forEach((button) => button.classList.add('spin'));
  try {
    state.server = await bridge.server.status(Boolean(force));
    renderServerStatus();
  } catch (error) {
    state.server = {
      online: false,
      host: state.settings?.serverHost,
      port: state.settings?.serverPort,
      players: null,
      error: error.message,
      ping: null,
      version: null,
      motd: null
    };
    renderServerStatus();
  } finally {
    state.serverBusy = false;
    $$('#sidebar-refresh, #server-refresh, #server-refresh-big').forEach((button) => button.classList.remove('spin'));
  }
}

/* ── Settings ───────────────────────────────────────────── */

function maxRamGb() {
  const total = state.system?.totalMemoryMb || 8192;
  return Math.max(2, Math.min(32, Math.floor((total - 1024) / 1024)));
}

function fillSettingsForm() {
  const settings = state.settings;
  if (!settings) return;
  const ram = Math.round((settings.memoryMaxMb || 4096) / 1024);
  const slider = $('#set-ram');
  if (slider) {
    slider.max = String(Math.max(maxRamGb(), ram));
    slider.value = String(Math.min(ram, Number(slider.max)));
    updateRamLabel();
  }
  const width = $('#set-width');
  const height = $('#set-height');
  const fullscreen = $('#set-fullscreen');
  if (width) width.value = String(settings.resolution?.width || 1280);
  if (height) height.value = String(settings.resolution?.height || 720);
  if (fullscreen) fullscreen.checked = Boolean(settings.resolution?.fullscreen);

  const host = $('#set-server-host');
  const port = $('#set-server-port');
  const auto = $('#set-autoconnect');
  const forge = $('#set-forge');
  const forgeBuild = $('#set-forge-build');
  if (host) host.value = settings.serverHost || '';
  if (port) port.value = String(settings.serverPort || 25565);
  if (auto) auto.checked = Boolean(settings.autoConnect);
  if (forge) forge.checked = Boolean(settings.useForge);
  if (forgeBuild) {
    forgeBuild.value = settings.forgeBuild || '';
    forgeBuild.disabled = !settings.useForge;
  }

  const gameDir = $('#set-game-dir');
  const javaPath = $('#set-java-path');
  const apiUrl = $('#set-api-url');
  const minimize = $('#set-minimize');
  const remember = $('#set-remember');
  if (gameDir) {
    gameDir.value = settings.gameDir || '';
    gameDir.placeholder = state.system?.defaultGameDir || 'Dossier par défaut';
  }
  if (javaPath) javaPath.value = settings.javaPath || '';
  if (apiUrl) apiUrl.value = settings.apiUrl || '';
  if (minimize) minimize.checked = Boolean(settings.minimizeOnLaunch);
  if (remember) remember.checked = Boolean(settings.rememberSession);

  const help = $('#game-dir-help');
  if (help) help.textContent = state.system?.defaultGameDir ? `Défaut : ${state.system.defaultGameDir}` : '';
  const javaDetected = $('#java-detected');
  if (javaDetected) {
    javaDetected.textContent = settings.javaPath ? 'Chemin enregistré.' : 'Aucun chemin personnalisé.';
    javaDetected.className = 'field-help';
  }
  updateSummaries();
}

function updateRamLabel() {
  const slider = $('#set-ram');
  const label = $('#ram-value');
  const help = $('#ram-help');
  if (!slider) return;
  const value = Number(slider.value) || 4;
  if (label) label.textContent = `${value} Go`;
  const percent = ((value - Number(slider.min)) / Math.max(1, Number(slider.max) - Number(slider.min))) * 100;
  slider.style.setProperty('--fill', `${percent}%`);
  if (help) {
    help.textContent = value < 3
      ? 'Allouer moins de 3 Go peut provoquer des ralentissements avec Forge.'
      : value > Math.max(4, maxRamGb() - 1)
        ? 'Attention : cette valeur laisse peu de mémoire au système.'
        : 'Recommandé : 4 Go pour 1.12.2 avec Forge.';
  }
}

function updateSummaries() {
  const settings = state.settings;
  if (!settings) return;
  setText('#memory-summary', `${Math.round((settings.memoryMaxMb || 4096) / 1024)} Go`);
  const java = settings.javaPath ? 'Manuel' : 'Auto';
  setText('#java-summary', java);
  const summary = $('#system-summary');
  if (summary) {
    const system = state.system;
    if (system) {
      summary.textContent = `${platformLabel(system.platform)} ${system.arch} · ${system.cpus} cœurs · ${Math.round(system.totalMemoryMb / 1024)} Go RAM · Electron ${system.electron}`;
    }
  }
  updateLaunchCaption();
}

function updateLaunchCaption() {
  const caption = $('#play-button small');
  if (!caption) return;
  const settings = state.settings;
  const forge = settings?.useForge ? 'Forge' : 'Vanilla';
  caption.textContent = `Lancer Minecraft 1.12.2 · ${forge}`;
}

function isGameBusy(status = state.game?.status) {
  return ['preparing', 'downloading', 'running'].includes(status);
}

function setPlayButtonBusy(busy) {
  const button = $('#play-button');
  if (!button) return;
  button.classList.toggle('loading', busy);
  button.disabled = busy;
}

async function browseForGameDir() {
  try {
    const selected = await bridge.dialog.selectDirectory({
      title: 'Choisir le dossier Minecraft',
      defaultPath: $('#set-game-dir')?.value || state.system?.defaultGameDir || ''
    });
    if (selected) $('#set-game-dir').value = selected;
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function browseForJava() {
  const current = $('#set-java-path')?.value || '';
  try {
    const selected = await bridge.dialog.selectJava({
      title: 'Choisir l’exécutable Java 8',
      defaultPath: current || ''
    });
    if (!selected) return;
    const input = $('#set-java-path');
    if (input) input.value = selected;
    toast('Pense à vérifier que ce runtime est bien Java 8.', { type: 'info' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function detectJava() {
  const label = $('#java-detected');
  if (label) {
    label.textContent = 'Détection en cours…';
    label.className = 'field-help';
  }
  try {
    const result = await bridge.system.detectJava();
    const best = result?.best;
    if (best) {
      const compatible = best.major === 8;
      if (label) {
        label.textContent = `Java ${best.major} · ${best.vendor}${compatible ? '' : ' — Java 8 est requis'}`;
        label.className = `field-help ${compatible ? 'ok' : 'err'}`;
      }
      if (compatible) {
        const input = $('#set-java-path');
        if (input) input.value = best.path;
      }
    } else if (label) {
      label.textContent = 'Aucun Java détecté. Un runtime sera téléchargé au premier lancement.';
      label.className = 'field-help';
    }
  } catch (error) {
    if (label) {
      label.textContent = error.message;
      label.className = 'field-help err';
    }
  }
}

async function testApi() {
  const input = $('#set-api-url');
  const label = $('#api-test-result');
  const url = input?.value.trim() || '';
  if (!url) {
    if (label) { label.textContent = 'Indique l’URL de l’API.'; label.className = 'field-help err'; }
    return;
  }
  if (label) { label.textContent = 'Test en cours…'; label.className = 'field-help'; }
  try {
    const result = await bridge.app.testApi(url);
    if (label) {
      label.textContent = `API joignable (${result.latency} ms)${result.version ? ` · v${result.version}` : ''}`;
      label.className = 'field-help ok';
    }
  } catch (error) {
    if (label) { label.textContent = error.message; label.className = 'field-help err'; }
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const button = $('#settings-save');
  const stateLabel = $('#save-state');
  const ram = Number($('#set-ram')?.value || 4);
  const patch = {
    memoryMaxMb: ram * 1024,
    memoryMinMb: Math.min(1024, Math.max(512, Math.floor((ram * 1024) / 2))),
    resolution: {
      width: Number($('#set-width')?.value || 1280),
      height: Number($('#set-height')?.value || 720),
      fullscreen: Boolean($('#set-fullscreen')?.checked)
    },
    useForge: Boolean($('#set-forge')?.checked),
    forgeBuild: $('#set-forge-build')?.value.trim() || '14.23.5.2860',
    gameDir: $('#set-game-dir')?.value.trim() || '',
    javaPath: $('#set-java-path')?.value.trim() || '',
    minimizeOnLaunch: Boolean($('#set-minimize')?.checked),
    rememberSession: Boolean($('#set-remember')?.checked)
  };
  if (state.session?.user?.role === 'admin') {
    Object.assign(patch, {
      serverHost: $('#set-server-host')?.value.trim() || '',
      serverPort: Number($('#set-server-port')?.value || 25565),
      autoConnect: Boolean($('#set-autoconnect')?.checked),
      apiUrl: $('#set-api-url')?.value.trim() || '',
      useForge: Boolean($('#set-forge')?.checked),
      forgeBuild: $('#set-forge-build')?.value.trim() || '14.23.5.2860'
    });
  }

  if (button) button.disabled = true;
  if (stateLabel) { stateLabel.textContent = 'Enregistrement…'; stateLabel.className = 'save-state'; }
  try {
    const previousApi = state.settings?.apiUrl;
    state.settings = await bridge.settings.save(patch);
    fillSettingsForm();
    renderServerStatus();
    if (previousApi !== state.settings.apiUrl) {
      await loadContent(true);
      await refreshServer(true);
    }
    if (stateLabel) { stateLabel.textContent = 'Enregistré'; stateLabel.className = 'save-state ok'; }
    toast('Tes paramètres ont été enregistrés.', { type: 'success', title: 'Enregistré' });
    setTimeout(() => {
      if (stateLabel) { stateLabel.textContent = ''; stateLabel.className = 'save-state'; }
    }, 3200);
  } catch (error) {
    if (stateLabel) { stateLabel.textContent = 'Échec'; stateLabel.className = 'save-state err'; }
    toast(error.message || 'Impossible d’enregistrer les paramètres.', { type: 'error' });
  } finally {
    if (button) button.disabled = false;
  }
}

async function resetSettings() {
  try {
    state.settings = await bridge.settings.reset();
    fillSettingsForm();
    renderServerStatus();
    toast('Les paramètres par défaut ont été restaurés.', { type: 'success', title: 'Réinitialisé' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

/* ── Console ────────────────────────────────────────────── */

const MAX_CONSOLE_LINES = 1200;

function classifyLog(line) {
  if (/\b(ERROR|FATAL|Exception|Caused by)\b/i.test(line)) return 'line-err';
  if (/\bWARN(ING)?\b/i.test(line)) return 'line-warn';
  if (/\b(Done|Successfully|Loaded|Starting|Authenticated)\b/i.test(line)) return 'line-ok';
  if (/^\s*\[?minecraft/i.test(line) || line.startsWith('>')) return 'line-dim';
  return '';
}

function appendConsole(lines) {
  const container = $('#console-lines');
  if (!container || !lines?.length) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  const fragment = document.createDocumentFragment();
  for (const raw of lines) {
    const line = String(raw ?? '').slice(0, 4000);
    state.consoleLines.push(line);
    const element = document.createElement('div');
    const kind = classifyLog(line);
    if (kind) element.className = kind;
    element.textContent = line;
    fragment.appendChild(element);
  }
  container.appendChild(fragment);
  while (container.childElementCount > MAX_CONSOLE_LINES) container.firstElementChild.remove();
  if (state.consoleLines.length > MAX_CONSOLE_LINES) {
    state.consoleLines.splice(0, state.consoleLines.length - MAX_CONSOLE_LINES);
  }
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

function clearConsole() {
  state.consoleLines = [];
  const container = $('#console-lines');
  if (container) container.innerHTML = '';
}

function openConsole(open = true) {
  const drawer = $('#console-drawer');
  if (!drawer) return;
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  if (open) {
    const container = $('#console-lines');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

async function copyConsole() {
  const text = state.consoleLines.join('\n');
  if (!text) return toast('La console est vide.', { type: 'info' });
  await copyText(text, 'Les logs ont été copiés.');
}

/* ── Launch overlay ─────────────────────────────────────── */

function openLaunchOverlay(mode = 'progress') {
  const overlay = $('#launch-overlay');
  const modal = $('#launch-modal');
  if (!overlay || !modal) return;
  overlay.classList.remove('hidden');
  modal.classList.remove('success', 'error');
  modal.classList.toggle('success', mode === 'success');
  modal.classList.toggle('error', mode === 'error');
  state.overlayMode = mode;
  $('#launch-close')?.classList.add('hidden');
  $('#launch-hide')?.classList.toggle('hidden', mode !== 'progress');
  $('#launch-console')?.classList.remove('hidden');
}

function closeLaunchOverlay() {
  const overlay = $('#launch-overlay');
  if (!overlay) return;
  if (isGameBusy()) {
    toast('Le lancement continue en arrière-plan. Suis la progression avec le bouton en haut.', { type: 'info' });
  }
  overlay.classList.add('hidden');
  state.overlayMode = null;
}

function setLaunchProgress(percent) {
  const bar = $('#launch-bar');
  const label = $('#launch-percent');
  const mini = $('#launch-mini-bar');
  const value = percent == null ? null : Math.max(0, Math.min(100, percent));
  if (bar) bar.style.width = `${value ?? 0}%`;
  if (label) label.textContent = value == null ? '—' : `${Math.floor(value)} %`;
  if (mini) mini.style.width = `${value ?? 0}%`;
}

function setLaunchPhase(phase, message) {
  const kicker = $('#launch-kicker');
  const title = $('#launch-title');
  const detail = $('#launch-detail');
  const labels = {
    preparing: ['PRÉPARATION DE LA VILLE', 'Initialisation de la ville…'],
    java: ['RUNTIME JAVA', 'Préparation de Java…'],
    download: ['TÉLÉCHARGEMENT', 'Assemblage des quartiers…'],
    verify: ['VÉRIFICATION', 'Contrôle des fichiers…'],
    extract: ['EXTRACTION', 'Installation des ressources…'],
    loader: ['FORGE', 'Installation du chargeur de mods…'],
    running: ['VILLE PRÊTE', 'Bienvenue à Azur City.'],
    success: ['VILLE PRÊTE', 'Bienvenue à Azur City.'],
    error: ['ÉCHEC DU LANCEMENT', 'Azur City n’a pas pu démarrer.'],
    closed: ['SESSION TERMINÉE', 'À bientôt en ville.']
  };
  const [kickerText, titleText] = labels[phase] || ['LANCEMENT', 'Préparation…'];
  if (kicker) kicker.textContent = kickerText;
  if (title) title.textContent = titleText;
  if (detail && message) detail.textContent = message;
  const status = $('#console-status');
  if (status && STATUS_LABELS[state.game?.status]) status.textContent = STATUS_LABELS[state.game.status];
}

function showLaunchError(message) {
  openLaunchOverlay('error');
  setLaunchPhase('error');
  const detail = $('#launch-detail');
  if (detail) detail.textContent = message || 'Une erreur inattendue est survenue.';
  setLaunchProgress(100);
  const kicker = $('#launch-kicker');
  if (kicker) kicker.textContent = 'ÉCHEC DU LANCEMENT';
  const close = $('#launch-close');
  if (close) {
    close.classList.remove('hidden');
    close.textContent = 'Fermer';
  }
  setPlayButtonBusy(false);
  $('#launch-hide')?.classList.add('hidden');
  $('#launch-console')?.classList.remove('hidden');
}

function showLaunchSuccess() {
  openLaunchOverlay('success');
  setLaunchPhase('success', 'Minecraft est lancé. Le launcher se réduit pour te laisser jouer.');
  setLaunchProgress(100);
  const close = $('#launch-close');
  if (close) {
    close.classList.remove('hidden');
    close.textContent = 'Masquer';
  }
  $('#launch-hide')?.classList.add('hidden');
  const speed = $('#launch-speed');
  if (speed) speed.textContent = '';
  setTimeout(() => {
    if (state.overlayMode === 'success') closeLaunchOverlay();
  }, 2600);
}

function resetGameUi() {
  state.game = { status: 'idle' };
  setPlayButtonBusy(false);
  $('#launch-mini')?.classList.add('hidden');
  $('#launch-hide')?.classList.remove('hidden');
  $('#launch-console')?.classList.remove('hidden');
  $('#launch-close')?.classList.add('hidden');
  setLaunchProgress(0);
  const speed = $('#launch-speed');
  if (speed) speed.textContent = '';
  const status = $('#console-status');
  if (status) status.textContent = 'En attente';
}

async function launchGame() {
  if (!state.session) {
    toast('Connecte-toi avant de lancer Minecraft.', { type: 'error' });
    return;
  }
  if (isGameBusy()) {
    openLaunchOverlay(state.overlayMode === 'error' ? 'error' : 'progress');
    return;
  }
  setPlayButtonBusy(true);
  openLaunchOverlay('progress');
  setLaunchPhase('preparing', 'Vérification de Java et des fichiers Minecraft…');
  setLaunchProgress(0);
  const mini = $('#launch-mini');
  if (mini) mini.classList.remove('hidden');
  const miniText = $('#launch-mini-text');
  if (miniText) miniText.textContent = 'Préparation…';
  const launchSpeed = $('#launch-speed');
  if (launchSpeed) launchSpeed.textContent = '';
  try {
    await bridge.game.launch();
  } catch (error) {
    showLaunchError(error.message || 'Impossible de lancer Minecraft.');
  }
}

/* ── Game events ────────────────────────────────────────── */

function handleGameEvent(event) {
  if (!event || typeof event !== 'object') return;
  switch (event.type) {
    case 'state': {
      state.game = event.state || state.game;
      const busy = isGameBusy();
      if (!busy) {
        setPlayButtonBusy(false);
        $('#launch-mini')?.classList.add('hidden');
      }
      if (event.state?.lastError && event.state.status === 'idle') {
        setPlayButtonBusy(false);
      }
      const status = $('#console-status');
      if (status) status.textContent = STATUS_LABELS[state.game.status] || 'En attente';
      break;
    }
    case 'phase': {
      setLaunchPhase(event.phase, event.message);
      if (state.overlayMode === 'error' && event.phase !== 'error') openLaunchOverlay('progress');
      break;
    }
    case 'progress': {
      if (event.phase === 'verify') setLaunchPhase('verify', event.detail ? `Vérification : ${event.detail}` : 'Contrôle des fichiers…');
      else setLaunchPhase('download', event.detail ? `Téléchargement : ${event.detail}` : 'Téléchargement des fichiers…');
      setLaunchProgress(event.percent);
      const miniText = $('#launch-mini-text');
      if (miniText && event.percent != null) miniText.textContent = `${Math.floor(event.percent)} %`;
      break;
    }
    case 'speed': {
      const speed = $('#launch-speed');
      if (speed) speed.textContent = formatSpeed(event.speed);
      break;
    }
    case 'estimated': {
      const speed = $('#launch-speed');
      if (speed) {
        const duration = formatDuration(event.seconds);
        if (duration) speed.textContent = duration;
      }
      break;
    }
    case 'spawned': {
      state.game = { ...state.game, status: 'running' };
      setPlayButtonBusy(false);
      showLaunchSuccess();
      break;
    }
    case 'log': {
      appendConsole(event.lines);
      break;
    }
    case 'closed': {
      resetGameUi();
      toast('Minecraft a été fermé. À bientôt en ville.', { type: 'info', title: 'Session terminée' });
      const overlay = $('#launch-overlay');
      if (overlay && !overlay.classList.contains('hidden') && state.overlayMode !== 'error') {
        closeLaunchOverlay();
      }
      break;
    }
    case 'error':
    case 'failed': {
      showLaunchError(event.message || 'Le lancement de Minecraft a échoué.');
      const mini = $('#launch-mini');
      if (mini) mini.classList.add('hidden');
      break;
    }
    default:
      break;
  }
}

/* ── Bootstrap ──────────────────────────────────────────── */

function applyBootstrap(data) {
  state.session = data.session || null;
  applyFounderSettingsAccess(state.session?.user);
  state.settings = data.settings;
  state.system = data.system;
  state.game = data.game || { status: 'idle' };
  document.body.classList.add(`platform-${state.system.platform}`);
  setText('[data-app-version]', state.system.appVersion);
  setText('[data-platform-label]', platformLabel(state.system.platform));
  const remember = $('#remember-me');
  if (remember) remember.checked = Boolean(state.settings.rememberSession);
  fillSettingsForm();
  applyServerIp();
  renderServerStatus();
  updateLaunchCaption();
  if (state.game && isGameBusy(state.game.status)) {
    setPlayButtonBusy(true);
    openLaunchOverlay('progress');
  }
}

async function boot() {
  if (!bridge) {
    const status = $('#boot-status');
    if (status) status.textContent = 'Le pont sécurisé du launcher est indisponible.';
    return;
  }
  try {
    const data = await bridge.bootstrap();
    applyBootstrap(data);
    if (data.session?.user) {
      applyUser(data.session.user);
      await enterApp(data.session);
      if (data.offline) {
        toast('Serveur d’authentification injoignable : session locale utilisée.', { type: 'info', title: 'Mode hors ligne' });
      }
    } else {
      setScreen('login');
      if (data.expired) toast('Ta session a expiré, reconnecte-toi.', { type: 'info' });
      setTimeout(() => $('#login-identifier')?.focus(), 250);
    }
    state.booted = true;
  } catch (error) {
    const status = $('#boot-status');
    if (status) status.textContent = error.message || 'Impossible de démarrer AzurRP.';
    toast(error.message || 'Erreur de démarrage.', { type: 'error' });
  }
}

/* ── Wiring ─────────────────────────────────────────────── */

function wireEvents() {
  $('#win-min')?.addEventListener('click', () => bridge.window.minimize());
  $('#win-max')?.addEventListener('click', () => bridge.window.toggleMaximize());
  $('#win-close')?.addEventListener('click', () => bridge.window.close());
  bridge.window.onMaximized((maximized) => {
    const use = $('#win-max use');
    if (use) use.setAttribute('href', maximized ? '#i-restore' : '#i-max');
  });

  $$('.auth-tab').forEach((tab) => tab.addEventListener('click', () => switchAuthTab(tab.dataset.authTab)));
  $('#login-form')?.addEventListener('submit', handleLogin);
  $('#register-form')?.addEventListener('submit', handleRegister);
  $$('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => togglePassword(button)));
  $('#register-password')?.addEventListener('input', (event) => updatePasswordMeter(event.target.value));
  $('#sidebar-logout')?.addEventListener('click', logout);

  $$('.nav-item').forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
  $$('[data-view-link]').forEach((element) => element.addEventListener('click', () => showView(element.dataset.viewLink)));

  $('#play-button')?.addEventListener('click', launchGame);
  $('#launch-hide')?.addEventListener('click', closeLaunchOverlay);
  $('#launch-close')?.addEventListener('click', () => {
    if (state.overlayMode === 'error') {
      closeLaunchOverlay();
      resetGameUi();
    } else {
      closeLaunchOverlay();
    }
  });
  $('#launch-console')?.addEventListener('click', () => openConsole(true));
  $('#launch-mini')?.addEventListener('click', () => openLaunchOverlay(state.overlayMode === 'error' ? 'error' : 'progress'));

  $('#console-button')?.addEventListener('click', () => openConsole(true));
  $('#console-close')?.addEventListener('click', () => openConsole(false));
  $('#console-clear')?.addEventListener('click', clearConsole);
  $('#console-copy')?.addEventListener('click', copyConsole);

  $('#copy-ip')?.addEventListener('click', () => copyText(serverAddress(), `Adresse copiée : ${serverAddress()}`));
  $('#server-copy')?.addEventListener('click', () => copyText(serverAddress(), `Adresse copiée : ${serverAddress()}`));

  $$('#sidebar-refresh, #server-refresh, #server-refresh-big').forEach((button) => {
    button.addEventListener('click', () => refreshServer(true));
  });

  $('#news-refresh')?.addEventListener('click', () => loadContent(true));

  $('#settings-form')?.addEventListener('submit', saveSettings);
  $('#settings-reset')?.addEventListener('click', resetSettings);
  $('#set-ram')?.addEventListener('input', updateRamLabel);
  $('#set-forge')?.addEventListener('change', (event) => {
    const build = $('#set-forge-build');
    if (build) build.disabled = !event.target.checked;
  });
  $('#game-browse')?.addEventListener('click', browseForGameDir);
  $('#java-browse')?.addEventListener('click', browseForJava);
  $('#java-detect')?.addEventListener('click', detectJava);
  $('#api-test')?.addEventListener('click', testApi);
  $('#game-open')?.addEventListener('click', async () => {
    try {
      await bridge.game.openFolder();
    } catch (error) {
      toast(error.message, { type: 'error' });
    }
  });
  $('#open-logs')?.addEventListener('click', async () => {
    try {
      await bridge.game.openLogs();
    } catch (error) {
      toast(error.message, { type: 'error' });
    }
  });

  $$('[data-external]').forEach((element) => {
    element.addEventListener('click', async () => {
      const key = element.dataset.external;
      const url = state.content?.links?.[key];
      if (!url) {
        toast('Ce lien n’est pas encore disponible.', { type: 'info' });
        return;
      }
      try {
        await bridge.app.openExternal(url);
      } catch (error) {
        toast(error.message, { type: 'error' });
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const drawer = $('#console-drawer');
      if (drawer?.classList.contains('open')) {
        openConsole(false);
      } else if (state.overlayMode && !$('#launch-overlay')?.classList.contains('hidden')) {
        closeLaunchOverlay();
      }
    }
    if (event.key === 'F5' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (state.session) loadContent(true);
    }
  });

  bridge.game.onEvent(handleGameEvent);
}

if (bridge) {
  wireEvents();
} else {
  const status = $('#boot-status');
  if (status) status.textContent = 'Le pont sécurisé du launcher est indisponible.';
}
boot();

// Rafraîchissement périodique discret du statut serveur.
setInterval(() => {
  if (state.session && state.booted && document.visibilityState === 'visible' && !state.serverBusy) {
    refreshServer(false);
  }
}, 60000);
