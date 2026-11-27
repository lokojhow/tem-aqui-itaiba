/* Tem Aqui Itaíba — camada online Supabase multicidade V2 */
(function () {
  'use strict';

  const APP_CITY = 'Itaíba';
  const APP_CITY_KEY = 'itaiba';
  const normalizeCity = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  const cityMatches = value => normalizeCity(value) === APP_CITY_KEY;

  const cfg = window.TEM_AQUI_SUPABASE || {};
  let onlineClient = null;
  let onlineSession = null;
  let onlineProfile = null;
  let onlineRoles = [];
  let onlineStore = null;
  let onlinePartnerRequest = null;
  let onlineCategories = [];
  let onlineCommunityPosts = [];
  let onlineSwapListings = [];
  let onlineCattleListings = [];
  let onlineReady = false;
  let pendingModalAfterAuth = null;
  let realtimeMessagesChannel = null;
  let realtimeNotificationsChannel = null;
  let visitorRefreshTimer = null;
  let onlineNotifications = [];
  let onlineHomeCampaignRows = [];
  let onlineFlashPromotionRows = [];
  const contactIndex = new Map();
  let adminDashboardPeriod = 30;
  let preferredAccountPanel = null;
  try { preferredAccountPanel = sessionStorage.getItem('temAquiPreferredAccountPanel') || null; } catch (_) {}
  const analyticsViewLabels = {
    home:'Início', community:'Comunidade', food:'Tem Aqui Food', swap:'Feira do Troca',
    cattle:'Feira do Gado', cart:'Carrinho', chat:'Chat',
    account:'Conta', admin:'Dashboard administrativo', app:'Aplicativo'
  };

  const localMediaHTML = mediaHTML;
  const localRenderCommunity = renderCommunity;
  const localRenderSwap = renderSwap;
  const localRenderCattle = renderCattle;
  const localRenderChats = renderChats;
  const localShowAccountPanel = showAccountPanel;
  const localOpenModal = openModal;
  const localDeleteOwnPost = deleteOwnPost;
  const localDeleteSwap = deleteSwap;
  const localDeleteCattle = deleteCattle;
  const localDeletePartnerProduct = deletePartnerProduct;
  const localSendMessage = sendMessage;
  const localNavigate = navigate;

  function normalizeError(error) {
    const msg = error?.message || String(error || 'Erro desconhecido');
    if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
    if (/user already registered/i.test(msg)) return 'Este e-mail já possui uma conta. Use a opção Entrar.';
    if (/password/i.test(msg) && /least/i.test(msg)) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (/reauthentication|recently signed in|reauth/i.test(msg)) return 'Por segurança, saia da conta, entre novamente e tente alterar a senha.';
    if (/row-level security|violates row-level/i.test(msg)) return 'Sua conta não tem permissão para realizar esta ação.';
    if (/failed to fetch|network/i.test(msg)) return 'Não foi possível conectar ao banco. Verifique a internet.';
    if (/image_urls.*schema cache|schema cache.*image_urls/i.test(msg)) return 'A galeria de fotos ainda não foi ativada no banco. Execute a correção da Etapa 13 no Supabase.';
    if (/category.*schema cache|schema cache.*category|column .*category.*does not exist/i.test(msg)) return 'As categorias da Feira do Troca ainda não foram ativadas. Execute a Etapa 18 no Supabase.';
    if (/permission|row-level security|violates row-level/i.test(msg) && /update|edit/i.test(msg)) return 'A edição administrativa ainda não foi liberada. Execute a Etapa 19 no Supabase.';
    if (/admin_partner_panel|admin_create_partner|admin_update_partner|partner_status|partner_payments|relation .*partner_payments.*does not exist|function .*admin_.*partner/i.test(msg)) return 'O Painel de Parceiros ainda não foi ativado no banco. Execute a Etapa 20 no Supabase.';
    return msg;
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.disabled = true;
      button.textContent = text || 'Aguarde...';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.oldText || button.textContent;
    }
  }

  function currentUserId() {
    return onlineSession?.user?.id || null;
  }

  function getOrCreateVisitorKey() {
    const storageKey = 'temAquiUniqueVisitorItaibaV1';
    try {
      let key = localStorage.getItem(storageKey);
      if (!key) {
        key = (window.crypto?.randomUUID?.() || ('visitor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
        localStorage.setItem(storageKey, key);
      }
      return key;
    } catch (_) {
      return 'session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
  }

  function updateVisitorCounter(value, unavailable = false) {
    const count = document.getElementById('appVisitorCount');
    const badge = document.getElementById('appVisitorBadge');
    if (count) count.textContent = unavailable ? '—' : Number(value || 0).toLocaleString('pt-BR');
    if (badge) badge.title = unavailable
      ? 'Ative o total acumulado de acessos executando a Etapa 29 no Supabase.'
      : 'Total acumulado de aberturas do aplicativo desde o primeiro acesso registrado. Cada nova sessão de aproximadamente 30 minutos aumenta o número.';
  }

  async function refreshVisitorCounter() {
    if (!onlineClient) return false;
    const { data, error } = await onlineClient.rpc('get_public_app_lifetime_accesses_city_v2', { p_city: APP_CITY });
    if (error) throw error;
    updateVisitorCounter(data, false);
    return true;
  }

  async function startVisitorCounter() {
    try {
      await refreshVisitorCounter();
      if (visitorRefreshTimer) clearInterval(visitorRefreshTimer);
      visitorRefreshTimer = setInterval(() => refreshVisitorCounter().catch(() => {}), 30000);
    } catch (error) {
      console.warn('Contador de visitantes indisponível:', error?.message || error);
      updateVisitorCounter(0, true);
    }
  }

  function isAdmin() {
    return onlineRoles.includes('administrador');
  }

  function isPartner() {
    return isAdmin() || onlineRoles.includes('parceiro');
  }

  function needsLogin(modalId) {
    if (onlineSession) return false;
    pendingModalAfterAuth = modalId || null;
    localOpenModal('authModal');
    toast('Entre ou crie uma conta para continuar.');
    return true;
  }

  function slugify(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }


  function analyticsDeviceId() {
    const key = 'temAquiAnalyticsDeviceIdItaiba';
    let value = null;
    try { value = localStorage.getItem(key); } catch (_) {}
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')) return value;
    try {
      value = crypto.randomUUID();
    } catch (_) {
      value = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
    }
    try { localStorage.setItem(key, value); } catch (_) {}
    return value;
  }

  function analyticsPlatform() {
    const ua = navigator.userAgent || '';
    if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
    if (/EdgA|EdgiOS|Edg\//i.test(ua)) return 'Microsoft Edge';
    if (/CriOS|Chrome/i.test(ua)) return 'Google Chrome';
    if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
    if (/Safari/i.test(ua)) return 'Safari';
    return 'Outro navegador';
  }

  async function trackAccess(eventType = 'app_open', viewName = null, options = {}) {
    if (!onlineClient) return;
    const allowed = ['app_open','page_view','login','signup','install'];
    if (!allowed.includes(eventType)) return;
    const deviceId = analyticsDeviceId();
    const safeView = String(viewName || '').slice(0, 40) || null;
    const throttleKey = `temAquiAnalyticsItaiba:${eventType}:${safeView || 'none'}`;
    const throttleMs = eventType === 'app_open' ? 30 * 60_000 : eventType === 'page_view' ? 60_000 : 5_000;
    if (!options.force) {
      try {
        const previous = Number(sessionStorage.getItem(throttleKey) || 0);
        if (Date.now() - previous < throttleMs) return;
        sessionStorage.setItem(throttleKey, String(Date.now()));
      } catch (_) {}
    }
    const payload = {
      event_type: eventType,
      user_id: options.userId || currentUserId() || null,
      device_id: deviceId,
      view_name: safeView,
      installed: isAppInstalled(),
      platform: analyticsPlatform(),
      city: APP_CITY
    };
    const { error } = await onlineClient.from('app_access_events').insert(payload);
    if (error && !/app_access_events|relation .* does not exist/i.test(error.message || '')) {
      console.warn('Não foi possível registrar a estatística de acesso:', error);
    }
  }

  function dashboardNumber(value) {
    return Number(value || 0).toLocaleString('pt-BR');
  }

  function dashboardDate(value) {
    if (!value) return '';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return `${day}/${month}`;
  }

  function dashboardViewLabel(value) {
    return analyticsViewLabels[value] || value || 'Outra área';
  }

  function renderAdminDashboard(data) {
    const c = document.getElementById('accountContent');
    if (!c) return;
    const daily = Array.isArray(data?.daily) ? data.daily : [];
    const topViews = Array.isArray(data?.top_views) ? data.top_views : [];
    const maxAccess = Math.max(1, ...daily.map(item => Number(item.accesses || 0)));
    const days = Number(data?.period_days || adminDashboardPeriod || 30);
    const metric = (label, value, detail = '') => `<div class="admin-metric"><small>${esc(label)}</small><b>${dashboardNumber(value)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</div>`;
    c.innerHTML = `
      <div class="section-head">
        <div><h2>Dashboard administrativo</h2><div class="section-sub">Contas, usuários, acessos e movimentação do Tem Aqui.</div></div>
        <button class="btn btn-soft" onclick="refreshAdminDashboard()">↻ Atualizar</button>
      </div>
      <div class="admin-dashboard-toolbar">
        <div class="field"><label>Período do relatório</label><select id="adminDashboardPeriod" onchange="changeAdminDashboardPeriod(this.value)">
          <option value="7" ${days===7?'selected':''}>Últimos 7 dias</option>
          <option value="30" ${days===30?'selected':''}>Últimos 30 dias</option>
          <option value="90" ${days===90?'selected':''}>Últimos 90 dias</option>
        </select></div>
        <div class="section-sub">Atualizado em ${new Date(data?.generated_at || Date.now()).toLocaleString('pt-BR')}</div>
      </div>
      <div class="admin-dashboard-grid">
        ${metric('Contas criadas', data?.accounts_total, 'Contas no sistema de autenticação')}
        ${metric('Perfis de usuários', data?.profiles_total, 'Perfis disponíveis no aplicativo')}
        ${metric('Novas contas no período', data?.new_accounts_period, `Últimos ${days} dias`)}
        ${metric('Acessos hoje', data?.accesses_today, 'Sessões de até 30 minutos')}
        ${metric(`Acessos em ${days} dias`, data?.accesses_period, 'Aberturas do aplicativo')}
        ${metric('Pessoas no período', data?.unique_visitors_period, 'Aparelhos ou contas diferentes')}
        ${metric('Usuários conectados', data?.logged_users_period, `Com login nos últimos ${days} dias`)}
        ${metric('Instalações identificadas', data?.installed_devices_total, 'Aparelhos abrindo como aplicativo')}
        ${metric('Parceiros cadastrados', data?.partners_total, 'Contas com função de parceiro')}
        ${metric('Lojas ativas', data?.stores_active, 'Aprovadas e visíveis')}
        ${metric('Produtos ativos', data?.products_active, 'Disponíveis para pesquisa')}
        ${metric('Pedidos no período', data?.orders_period, `Criados nos últimos ${days} dias`)}
      </div>
      <div class="admin-dashboard-columns">
        <div class="admin-card">
          <h3>Acessos por dia</h3>
          <div class="section-sub">Cada acesso representa uma abertura do aplicativo dentro de uma nova sessão.</div>
          <div class="admin-chart">${daily.map(item => `<div class="admin-chart-row"><span class="admin-chart-label">${dashboardDate(item.day)}</span><span class="admin-chart-track"><i class="admin-chart-bar" style="width:${Math.max(2, Math.round(Number(item.accesses||0)/maxAccess*100))}%"></i></span><b class="admin-chart-value">${dashboardNumber(item.accesses)}</b></div>`).join('') || '<div class="empty">Ainda não há acessos registrados neste período.</div>'}</div>
        </div>
        <div class="admin-card">
          <h3>Áreas mais acessadas</h3>
          <div class="section-sub">Páginas abertas pelos usuários no período.</div>
          <div class="admin-top-list">${topViews.map((item, index) => `<div class="admin-top-item"><span>${index+1}. ${esc(dashboardViewLabel(item.view_name))}</span><b>${dashboardNumber(item.accesses)}</b></div>`).join('') || '<div class="empty">Sem dados de navegação ainda.</div>'}</div>
        </div>
      </div>
      <div class="admin-report-table-wrap">
        <table class="mini-table admin-report-table"><thead><tr><th>Dia</th><th>Acessos</th><th>Pessoas diferentes</th><th>Usuários com login</th><th>Páginas abertas</th></tr></thead><tbody>
          ${daily.slice().reverse().map(item => `<tr><td>${dashboardDate(item.day)}</td><td><b>${dashboardNumber(item.accesses)}</b></td><td>${dashboardNumber(item.unique_visitors)}</td><td>${dashboardNumber(item.logged_users)}</td><td>${dashboardNumber(item.page_views)}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum dado registrado.</td></tr>'}
        </tbody></table>
      </div>
      <div class="admin-dashboard-note"><b>Como os números são calculados:</b> “Acessos” contam uma nova sessão quando o aplicativo é aberto depois de aproximadamente 30 minutos. “Pessoas” contam aparelhos ou contas diferentes. O relatório começa a acumular dados somente depois desta atualização e não recupera acessos anteriores.</div>`;
  }

  async function loadAdminDashboard(days = adminDashboardPeriod) {
    const c = document.getElementById('accountContent');
    if (!isAdmin()) {
      if (c) c.innerHTML = '<h2>Dashboard administrativo</h2><div class="empty">Esta área é exclusiva do administrador.</div>';
      return;
    }
    const safeDays = [7,30,90].includes(Number(days)) ? Number(days) : 30;
    adminDashboardPeriod = safeDays;
    if (c) c.innerHTML = '<div class="admin-loading"><b>Carregando relatório...</b><p>Consultando contas e acessos.</p></div>';
    const { data, error } = await onlineClient.rpc('admin_dashboard_summary_city', { period_days: safeDays, p_city: APP_CITY });
    if (error) {
      console.error(error);
      if (c) c.innerHTML = `<h2>Dashboard administrativo</h2><div class="empty">Não foi possível carregar o relatório. Execute primeiro o arquivo ETAPA-11-DASHBOARD-ADMINISTRATIVO.sql no Supabase.<br><br>${esc(normalizeError(error))}</div>`;
      return;
    }
    renderAdminDashboard(data || {});
  }

  window.changeAdminDashboardPeriod = function (value) {
    loadAdminDashboard(Number(value));
  };

  window.refreshAdminDashboard = function () {
    loadAdminDashboard(adminDashboardPeriod);
  };

  function userIdentifier() {
    return onlineSession?.user?.email || 'Minha conta';
  }

  function deliveryToApp(value) {
    return value === 'fixed_fee' ? 'paid' : (value || 'arrange');
  }

  function deliveryToDb(value) {
    return value === 'paid' ? 'fixed_fee' : (value || 'arrange');
  }

  function conditionToDb(value) {
    return ({'Novo':'new','Seminovo':'like_new','Usado':'used','Precisa de conserto':'needs_repair'})[value] || 'used';
  }

  function conditionToApp(value) {
    return ({new:'Novo',like_new:'Seminovo',used:'Usado',needs_repair:'Precisa de conserto'})[value] || 'Usado';
  }

  function dateLabel(value) {
    if (!value) return 'Recentemente';
    const d = new Date(value);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Agora';
    if (diff < 3_600_000) return `Há ${Math.max(1, Math.floor(diff / 60_000))} min`;
    if (diff < 86_400_000) return `Há ${Math.max(1, Math.floor(diff / 3_600_000))} h`;
    return d.toLocaleDateString('pt-BR');
  }

  function isHeicUpload(file) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    return /\.(heic|heif)$/.test(name) || /image\/(heic|heif|heic-sequence|heif-sequence)/.test(type);
  }

  async function convertHeicUpload(file) {
    if (!isHeicUpload(file)) return file;
    if (typeof window.heic2any !== 'function') {
      throw new Error('O conversor de fotos HEIC não foi carregado. Atualize o aplicativo e tente novamente.');
    }
    const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) throw new Error('Não foi possível converter essa foto HEIC.');
    const base = String(file.name || 'foto').replace(/\.(heic|heif)$/i, '');
    return new File([blob], `${base || 'foto'}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  }

  async function optimizeUpload(file) {
    if (!file) return null;
    if (file.type.startsWith('video/')) {
      if (file.size > 6 * 1024 * 1024) throw new Error('O vídeo precisa ter até 6 MB nesta primeira versão. Grave um vídeo mais curto.');
      return file;
    }
    if (!file.type.startsWith('image/') && !isHeicUpload(file)) throw new Error('Escolha uma imagem permitida.');
    try {
      file = await convertHeicUpload(file);
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scanMax = 1000;
      const scanScale = Math.min(1, scanMax / Math.max(bitmap.width, bitmap.height));
      const scan = document.createElement('canvas');
      scan.width = Math.max(1, Math.round(bitmap.width * scanScale));
      scan.height = Math.max(1, Math.round(bitmap.height * scanScale));
      const sctx = scan.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(bitmap, 0, 0, scan.width, scan.height);
      const data = sctx.getImageData(0, 0, scan.width, scan.height).data;
      let minX = scan.width, minY = scan.height, maxX = -1, maxY = -1;
      for (let y = 0; y < scan.height; y += 2) {
        for (let x = 0; x < scan.width; x += 2) {
          const i = (y * scan.width + x) * 4;
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          const nonWhite = a > 12 && (r < 242 || g < 242 || b < 242 || Math.max(r,g,b)-Math.min(r,g,b) > 12);
          if (nonWhite) { minX = Math.min(minX,x); minY = Math.min(minY,y); maxX = Math.max(maxX,x); maxY = Math.max(maxY,y); }
        }
      }
      let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
      if (maxX >= minX && maxY >= minY) {
        const margin = 0.04;
        const bx = minX / scanScale, by = minY / scanScale, bw = (maxX-minX+1)/scanScale, bh = (maxY-minY+1)/scanScale;
        if (bw * bh < bitmap.width * bitmap.height * 0.92) {
          sx = Math.max(0, bx - bw * margin); sy = Math.max(0, by - bh * margin);
          sw = Math.min(bitmap.width - sx, bw * (1 + margin*2)); sh = Math.min(bitmap.height - sy, bh * (1 + margin*2));
        }
      }
      const outW = 1200, outH = 900;
      const canvas = document.createElement('canvas'); canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      const cover = Math.max(outW/sw, outH/sh);
      const cw = sw*cover, ch = sh*cover;
      ctx.save(); ctx.filter = 'blur(28px)'; ctx.globalAlpha = .28;
      ctx.drawImage(bitmap,sx,sy,sw,sh,(outW-cw)/2,(outH-ch)/2,cw,ch); ctx.restore();
      ctx.fillStyle='rgba(255,255,255,.70)'; ctx.fillRect(0,0,outW,outH);
      const contain = Math.min((outW-48)/sw,(outH-48)/sh);
      const dw=sw*contain, dh=sh*contain;
      ctx.drawImage(bitmap,sx,sy,sw,sh,(outW-dw)/2,(outH-dh)/2,dw,dh);
      bitmap.close?.();
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/webp',.84));
      if (!blob) return file;
      return new File([blob], `${crypto.randomUUID()}.webp`, { type:'image/webp' });
    } catch (error) {
      if (isHeicUpload(file)) throw new Error('Não foi possível converter a foto HEIC. Escolha outra foto ou tente novamente.');
      if (file.size > 6 * 1024 * 1024) throw new Error('A imagem precisa ter até 6 MB.');
      console.warn('A imagem não pôde ser otimizada; será enviada no formato original.', error);
      return file;
    }
  }

  async function keepLocalCopy(file) {
    try {
      if (file && typeof db !== 'undefined' && db) return await putMedia(file);
    } catch (error) {
      console.warn('Não foi possível salvar a cópia local:', error);
    }
    return null;
  }

  function normalizeRemoteMediaList(list, primary) {
    let values = [];
    if (Array.isArray(list)) values = list;
    else if (typeof list === 'string' && list.trim()) { try { const parsed = JSON.parse(list); values = Array.isArray(parsed) ? parsed : [list]; } catch (_) { values = [list]; } }
    if (primary && !values.includes(primary)) values.unshift(primary);
    return [...new Set(values.filter(Boolean))].slice(0, 5);
  }

  async function uploadPublicMediaList(files) {
    const selected = [...(files || [])].slice(0, 5);
    const uploads = [];
    for (const file of selected) uploads.push(await uploadPublicMedia(file));
    return uploads;
  }

  async function uploadPublicMedia(file) {
    if (!file) return { url: null, localMediaId: null, mediaType: null };
    if (!onlineSession) throw new Error('Faça login para enviar arquivos.');
    const original = file;
    const prepared = await optimizeUpload(file);
    const ext = (prepared.name.split('.').pop() || (prepared.type.startsWith('video/') ? 'mp4' : 'webp')).toLowerCase();
    const path = `${currentUserId()}/${crypto.randomUUID()}.${ext}`;
    const localMediaId = await keepLocalCopy(prepared);
    const { error } = await onlineClient.storage.from('public-media').upload(path, prepared, {
      cacheControl: '3600',
      upsert: false,
      contentType: prepared.type
    });
    if (error) throw error;
    const { data } = onlineClient.storage.from('public-media').getPublicUrl(path);
    return {
      url: data.publicUrl,
      localMediaId,
      mediaType: prepared.type.startsWith('video/') ? 'video' : 'image'
    };
  }

  mediaHTML = async function (mediaId, fallback = '📦', title = 'Foto') {
    const list = normalizeRemoteMediaList(mediaId, null);
    if (!list.length) return `<span>${fallback}</span>`;
    const remote = list.every(x => typeof x === 'string' && /^https?:\/\//i.test(x));
    if (!remote) return localMediaHTML(list, fallback, title);
    const items = list.map(url => { const clean=url.split('?')[0].toLowerCase(); return { url, type:/\.(mp4|webm|mov|m4v)$/.test(clean)?'video':'image' }; });
    return galleryMarkup(items, title, fallback);
  };

  function contactReference(data = {}) {
    if (data.swapListingId) return `swap:${data.swapListingId}`;
    if (data.cattleListingId) return `cattle:${data.cattleListingId}`;
    if (data.productId) return `product:${data.productId}`;
    if (data.storeId) return `store:${data.storeId}`;
    return '';
  }

  function registerContact(seller, context, data) {
    if (!seller || !context || !data?.userId) return;
    const baseKey = `${seller}|||${context}`;
    const reference = contactReference(data);
    if (reference) contactIndex.set(`${baseKey}|||${reference}`, data);
    if (!contactIndex.has(baseKey)) contactIndex.set(baseKey, data);
  }

  function findContact(seller, context, referenceType = '', referenceId = '') {
    const baseKey = `${seller}|||${context}`;
    if (referenceType && referenceId) {
      const exact = contactIndex.get(`${baseKey}|||${referenceType}:${referenceId}`);
      if (exact) return exact;
    }
    return contactIndex.get(baseKey) || null;
  }

  function firstRemoteMedia(value) {
    const first = normalizeMediaItems(value)[0];
    return typeof first === 'string' && /^https?:\/\//i.test(first) ? first : '';
  }

  function conversationListing(c) {
    if (c.swap_listing_id) {
      const item = onlineSwapListings.find(x => String(x.id) === String(c.swap_listing_id));
      return {
        type: 'swap', id: c.swap_listing_id, source: 'Feira do Troca', icon: '📦',
        title: item?.name || c.title || 'Anúncio da Feira do Troca',
        price: Number(item?.price || 0), image: firstRemoteMedia(item?.mediaId), view: 'swap'
      };
    }
    if (c.cattle_listing_id) {
      const item = onlineCattleListings.find(x => String(x.id) === String(c.cattle_listing_id));
      return {
        type: 'cattle', id: c.cattle_listing_id, source: 'Feira do Gado', icon: '🐂',
        title: item ? `${item.type || 'Animal'} à venda` : (c.title || 'Animal à venda'),
        price: Number(item?.price || 0), image: firstRemoteMedia(item?.mediaId), view: 'cattle'
      };
    }
    if (c.product_id) {
      const allProducts = [...(state.products || []), ...(state.partnerProducts || [])];
      const item = allProducts.find(x => String(x.id) === String(c.product_id));
      return {
        type: 'product', id: c.product_id, source: item?.store || 'Produto local', icon: '🛒',
        title: item?.name || c.title || 'Produto', price: Number(item?.price || 0),
        image: firstRemoteMedia(item?.mediaId), view: 'home'
      };
    }
    return {
      type: 'general', id: c.id, source: 'Conversa', icon: '💬',
      title: c.title || 'Conversa', price: 0, image: '', view: 'chat'
    };
  }

  async function fetchProfiles(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!onlineSession || !unique.length) return new Map();
    const { data, error } = await onlineClient.from('profiles').select('id,nome,foto_url,cidade,whatsapp').in('id', unique);
    if (error) {
      console.warn(error);
      return new Map();
    }
    return new Map((data || []).map(p => [p.id, p]));
  }


  function campaignDateInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,16);
  }

  function campaignStatusLabel(value) {
    return ({pending:'Aguardando aprovação/pagamento',active:'Ativa',paused:'Pausada',rejected:'Rejeitada',expired:'Encerrada',draft:'Rascunho'})[value] || value || 'Pendente';
  }

  function campaignActionLabel(row) {
    if (row.action_type === 'view') return `Abrir área: ${row.action_value || 'início'}`;
    if (row.action_type === 'search') return `Pesquisar: ${row.action_value || ''}`;
    if (row.action_type === 'external') return 'Abrir link externo';
    return 'Somente informativo';
  }


  function flashPromotionAdminMarkup() {
    const rows = onlineFlashPromotionRows || [];
    const list = rows.map(row => `<article class="flash-admin-item">${row.top_bar_media_type==='video'&&row.top_bar_media_url?`<video src="${esc(row.top_bar_media_url)}" muted playsinline preload="metadata"></video>`:`<img src="${esc(row.top_bar_media_url || row.product_image_url || row.image_url || 'itaiba-feed-2.svg')}" alt="">`}<div><b>${esc(row.title)}</b><p>${esc(row.partner_name || 'Parceiro não informado')} • ${row.price ? money(Number(row.price)) : 'Preço não informado'}<br>Termina: ${row.ends_at ? new Date(row.ends_at).toLocaleString('pt-BR') : 'sem prazo'} • ${esc(campaignStatusLabel(row.status))}</p><div class="flash-admin-actions"><button class="btn btn-soft" onclick="editHomeFlashPromotion('${row.id}')">✏️ Editar</button>${row.status==='active'?`<button class="btn btn-soft" onclick="setHomeFlashPromotionStatus('${row.id}','paused')">Pausar</button>`:`<button class="btn btn-primary" onclick="setHomeFlashPromotionStatus('${row.id}','active')">Ativar</button>`}<button class="btn btn-danger" onclick="deleteHomeFlashPromotion('${row.id}')">Excluir</button></div></div></article>`).join('') || '<div class="empty">Nenhuma oferta relâmpago cadastrada.</div>';
    return `<section class="flash-admin-section"><div class="section-head"><div><h3>Oferta relâmpago e barra superior</h3><div class="section-sub">Edite a promoção com imagem, parceiro, preço e contagem regressiva. A mesma promoção alimenta a barra azul no topo.</div></div></div><div class="flash-admin-grid"><div class="flash-admin-form"><input id="flashEditId" type="hidden"><input id="flashExistingImage" type="hidden"><input id="flashExistingProductImage" type="hidden"><input id="flashExistingTopBarMedia" type="hidden"><input id="flashExistingTopBarMediaType" type="hidden"><div class="form"><div class="field full"><label>Texto da barra superior</label><input id="flashTopBarTitle" maxlength="110" placeholder="Ex.: Semana da economia em Itaíba"></div><div class="field"><label>Mídia da barra superior</label><select id="flashTopBarMediaType"><option value="none">Somente cor e texto</option><option value="image">Imagem</option><option value="video">Vídeo</option></select></div><div class="field"><label>Imagem ou vídeo da barra</label><input id="flashTopBarMedia" type="file" accept="image/*,video/mp4,video/webm"><small>Smartphone: proporção 5:1. Recomendado 1600 × 320 px. Vídeo MP4/WebM, curto e até 6 MB.</small></div><div class="field full"><label>Título da oferta</label><input id="flashTitle" maxlength="100" placeholder="Ex.: Kit de fraldas Pampers"></div><div class="field full"><label>Texto de apoio</label><textarea id="flashSubtitle" rows="3" maxlength="240"></textarea></div><div class="field"><label>Nome do parceiro</label><input id="flashPartnerName" maxlength="90" placeholder="Ex.: Farmácia São Sebastião"></div><div class="field"><label>Selo</label><input id="flashDiscountLabel" maxlength="35" value="OFERTA RELÂMPAGO"></div><div class="field full"><label>Imagem de fundo</label><input id="flashBackgroundImage" type="file" accept="image/*,.heic,.heif"><small>Use uma imagem horizontal de Itaíba ou uma arte da promoção.</small></div><div class="field full"><label>Imagem do produto</label><input id="flashProductImage" type="file" accept="image/*,.heic,.heif"><small>PNG sem fundo fica melhor, mas qualquer foto funciona.</small></div><div class="field"><label>Preço anterior</label><input id="flashOldPrice" type="number" min="0" step="0.01"></div><div class="field"><label>Preço promocional</label><input id="flashPrice" type="number" min="0" step="0.01"></div><div class="field"><label>Texto do botão</label><input id="flashButtonText" maxlength="35" value="Ver oferta"></div><div class="field"><label>Ao tocar</label><select id="flashActionType"><option value="none">Ver promoções</option><option value="view">Abrir área do aplicativo</option><option value="search">Pesquisar produto</option><option value="external">Abrir link externo</option></select></div><div class="field full"><label>Destino</label><input id="flashActionValue" placeholder="Ex.: home, farmacia, fralda ou https://..."></div><div class="field"><label>Começa em</label><input id="flashStartsAt" type="datetime-local"></div><div class="field"><label>Termina em</label><input id="flashEndsAt" type="datetime-local"></div><div class="field"><label>Status</label><select id="flashStatus"><option value="active">Ativa</option><option value="paused">Pausada</option><option value="draft">Rascunho</option></select></div><div class="field"><label>Ordem</label><input id="flashSortOrder" type="number" value="0"></div><button id="saveFlashPromotionButton" class="btn btn-primary field full" onclick="saveHomeFlashPromotion()">Salvar oferta e contador</button><button type="button" class="btn btn-soft field full" onclick="resetHomeFlashPromotionForm()">Limpar formulário</button></div></div><div class="flash-admin-list"><h3>Ofertas cadastradas</h3><div class="flash-admin-list-items">${list}</div></div></div></section>`;
  }

  window.resetHomeFlashPromotionForm = function(clear = true) {
    const defaults = {flashEditId:'',flashExistingImage:'',flashExistingProductImage:'',flashExistingTopBarMedia:'',flashExistingTopBarMediaType:'none',flashTopBarTitle:'Promoção da semana em Itaíba',flashTitle:'',flashSubtitle:'',flashPartnerName:'',flashDiscountLabel:'OFERTA RELÂMPAGO',flashOldPrice:'',flashPrice:'',flashButtonText:'Ver oferta',flashActionValue:'',flashSortOrder:'0'};
    Object.entries(defaults).forEach(([id,value])=>{const el=document.getElementById(id);if(el&&clear)el.value=value});
    const type=document.getElementById('flashActionType');if(type&&clear)type.value='none';const topMediaType=document.getElementById('flashTopBarMediaType');if(topMediaType&&clear)topMediaType.value='none';const status=document.getElementById('flashStatus');if(status&&clear)status.value='active';
    const starts=document.getElementById('flashStartsAt');if(starts&&clear)starts.value=campaignDateInput(new Date());const ends=document.getElementById('flashEndsAt');if(ends&&clear){const d=new Date();d.setDate(d.getDate()+7);ends.value=campaignDateInput(d)}
    ['flashTopBarMedia','flashBackgroundImage','flashProductImage'].forEach(id=>{const el=document.getElementById(id);if(el&&clear)el.value=''})
  };

  window.editHomeFlashPromotion = function(id) {
    const row=onlineFlashPromotionRows.find(item=>String(item.id)===String(id));if(!row)return;
    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value??''};
    set('flashEditId',row.id);set('flashExistingImage',row.image_url);set('flashExistingProductImage',row.product_image_url);set('flashExistingTopBarMedia',row.top_bar_media_url);set('flashExistingTopBarMediaType',row.top_bar_media_type||'none');set('flashTopBarMediaType',row.top_bar_media_type||'none');set('flashTopBarTitle',row.top_bar_title);set('flashTitle',row.title);set('flashSubtitle',row.subtitle);set('flashPartnerName',row.partner_name);set('flashDiscountLabel',row.discount_label||'OFERTA RELÂMPAGO');set('flashOldPrice',row.old_price);set('flashPrice',row.price);set('flashButtonText',row.button_text||'Ver oferta');set('flashActionType',row.action_type||'none');set('flashActionValue',row.action_value);set('flashStartsAt',campaignDateInput(row.starts_at));set('flashEndsAt',campaignDateInput(row.ends_at));set('flashStatus',row.status||'active');set('flashSortOrder',row.sort_order||0);document.querySelector('.flash-admin-form')?.scrollIntoView({behavior:'smooth'});
  };

  window.saveHomeFlashPromotion = async function() {
    if(!isAdmin())return toast('Somente o administrador pode editar esta promoção.');
    const button=document.getElementById('saveFlashPromotionButton'),id=document.getElementById('flashEditId')?.value||'',title=document.getElementById('flashTitle')?.value.trim();if(!title)return toast('Informe o título da oferta.');
    setBusy(button,true,'Salvando...');
    try{
      let imageUrl=document.getElementById('flashExistingImage')?.value||'',productImageUrl=document.getElementById('flashExistingProductImage')?.value||'',topBarMediaUrl=document.getElementById('flashExistingTopBarMedia')?.value||'',topBarMediaType=document.getElementById('flashTopBarMediaType')?.value||document.getElementById('flashExistingTopBarMediaType')?.value||'none';
      const topBarFile=document.getElementById('flashTopBarMedia')?.files?.[0],bgFile=document.getElementById('flashBackgroundImage')?.files?.[0],productFile=document.getElementById('flashProductImage')?.files?.[0];
      if(topBarFile){const upload=await uploadPublicMedia(topBarFile);topBarMediaUrl=upload.url||'';topBarMediaType=upload.mediaType||topBarMediaType}if(topBarMediaType==='none')topBarMediaUrl='';if(bgFile)imageUrl=(await uploadPublicMedia(bgFile)).url||'';if(productFile)productImageUrl=(await uploadPublicMedia(productFile)).url||'';
      const payload={city:APP_CITY,top_bar_title:document.getElementById('flashTopBarTitle')?.value.trim()||title,top_bar_media_type:topBarMediaType,top_bar_media_url:topBarMediaUrl||null,title,subtitle:document.getElementById('flashSubtitle')?.value.trim()||null,partner_name:document.getElementById('flashPartnerName')?.value.trim()||null,image_url:imageUrl||null,product_image_url:productImageUrl||null,old_price:Number(document.getElementById('flashOldPrice')?.value||0)||null,price:Number(document.getElementById('flashPrice')?.value||0)||null,discount_label:document.getElementById('flashDiscountLabel')?.value.trim()||null,button_text:document.getElementById('flashButtonText')?.value.trim()||'Ver oferta',action_type:document.getElementById('flashActionType')?.value||'none',action_value:document.getElementById('flashActionValue')?.value.trim()||null,starts_at:document.getElementById('flashStartsAt')?.value?new Date(document.getElementById('flashStartsAt').value).toISOString():new Date().toISOString(),ends_at:document.getElementById('flashEndsAt')?.value?new Date(document.getElementById('flashEndsAt').value).toISOString():null,status:document.getElementById('flashStatus')?.value||'active',sort_order:Number(document.getElementById('flashSortOrder')?.value||0)};
      const query=id?onlineClient.from('home_flash_promotions').update(payload).eq('id',id):onlineClient.from('home_flash_promotions').insert(payload);const {error}=await query;if(error)throw error;await loadPublicData();renderHomeAdsPanel();toast('Oferta, contador e barra superior atualizados.');
    }catch(error){toast(/home_flash_promotions|relation .* does not exist/i.test(error?.message||'')?'Execute primeiro a Etapa 27 no Supabase.':normalizeError(error))}finally{setBusy(button,false)}
  };

  window.setHomeFlashPromotionStatus = async function(id,status){if(!isAdmin())return;const {error}=await onlineClient.from('home_flash_promotions').update({status}).eq('id',id);if(error)return toast(normalizeError(error));await loadPublicData();renderHomeAdsPanel();toast(status==='active'?'Oferta ativada.':'Oferta pausada.')};
  window.deleteHomeFlashPromotion = async function(id){if(!isAdmin()||!confirm('Excluir esta oferta relâmpago?'))return;const {error}=await onlineClient.from('home_flash_promotions').delete().eq('id',id);if(error)return toast(normalizeError(error));await loadPublicData();renderHomeAdsPanel();toast('Oferta excluída.')};

  function renderHomeAdsPanel() {
    const c = document.getElementById('accountContent');
    if (!c) return;
    if (!onlineSession || (!isPartner() && !isAdmin())) {
      c.innerHTML = '<h2>Publicidade da tela inicial</h2><div class="empty">Esta área é destinada a parceiros e administradores.</div>';
      return;
    }
    const admin = isAdmin();
    const rows = admin ? onlineHomeCampaignRows : onlineHomeCampaignRows.filter(row => row.owner_id === currentUserId());
    const statusOptions = admin ? `<div class="field"><label>Status</label><select id="campaignStatus"><option value="active">Ativa</option><option value="pending">Pendente</option><option value="paused">Pausada</option><option value="rejected">Rejeitada</option></select></div><div class="field"><label>Pagamento</label><select id="campaignPaymentStatus"><option value="approved">Aprovado</option><option value="pending">Pendente</option><option value="rejected">Recusado</option><option value="refunded">Estornado</option></select></div><div class="field"><label>Valor da divulgação</label><input id="campaignAmount" type="number" min="0" step="0.01" placeholder="Ex.: 80,00"></div>` : '';
    c.innerHTML = (admin ? flashPromotionAdminMarkup() : '') + `<div class="section-head"><div><h2>Feed de banners da tela inicial</h2><div class="section-sub">Banners editáveis que aparecem no feed principal do aplicativo.</div></div></div><div class="campaign-info-box"><b>${admin?'Controle administrativo':'Solicitar destaque'}</b><br>${admin?'Você pode publicar quantas campanhas quiser, definir período, valor, ordem e acompanhar impressões e cliques.':'Envie a arte e as informações. A campanha ficará pendente até a confirmação do pagamento e a aprovação do administrador.'}</div><div class="campaign-admin-grid"><div class="campaign-form-card"><h3>${admin?'Criar ou editar campanha':'Solicitar anúncio patrocinado'}</h3><p class="section-sub">Use uma arte horizontal. O aplicativo se adapta ao celular e ao computador.</p><input id="campaignEditId" type="hidden"><input id="campaignExistingImage" type="hidden"><div class="form"><div class="field full"><label>Imagem da campanha</label><input id="campaignImage" type="file" accept="image/*,.heic,.heif"><small>Recomendado: 1600 × 700 px ou proporção semelhante.</small></div><div class="field full"><label>Título</label><input id="campaignTitle" maxlength="90" placeholder="Ex.: Promoção da semana"></div><div class="field full"><label>Texto de apoio</label><textarea id="campaignSubtitle" rows="3" maxlength="220" placeholder="Explique a promoção ou novidade."></textarea></div><div class="field"><label>Texto do botão</label><input id="campaignButtonText" maxlength="35" value="Ver oferta"></div><div class="field"><label>Ao tocar no anúncio</label><select id="campaignActionType"><option value="none">Não abrir nada</option><option value="view">Abrir uma área do aplicativo</option><option value="search">Pesquisar um produto</option><option value="external">Abrir um link externo</option></select></div><div class="field full"><label>Destino</label><input id="campaignActionValue" placeholder="Ex.: food, swap, picanha ou https://..."><small>Áreas permitidas: home, food, swap, cattle, community, cart, chat e account.</small></div><div class="field"><label>Início da exibição</label><input id="campaignStartsAt" type="datetime-local"></div><div class="field"><label>Fim da exibição</label><input id="campaignEndsAt" type="datetime-local"></div>${statusOptions}<button id="saveCampaignButton" class="btn btn-primary field full" onclick="saveHomeCampaignOnline()">${admin?'Publicar campanha':'Enviar solicitação'}</button><button type="button" class="btn btn-soft field full" onclick="resetHomeCampaignForm()">Limpar formulário</button></div>${!admin?'<div class="campaign-pricing-note"><b>Divulgação adicional ao plano:</b> o valor e o período serão combinados com o administrador. O anúncio só entra na tela principal após pagamento confirmado.</div>':''}</div><div class="campaign-list-card"><h3>${admin?'Campanhas cadastradas':'Minhas solicitações'}</h3><p class="section-sub">${rows.length} campanha(s) encontrada(s).</p><div class="campaign-list">${rows.map(row=>`<article class="campaign-list-item"><img class="campaign-list-thumb" src="${esc(row.image_url)}" alt=""><div class="campaign-list-main"><b>${esc(row.title)}</b><p>${esc(row.subtitle||'Sem texto de apoio')}<br>${esc(campaignActionLabel(row))}<br>${row.starts_at?new Date(row.starts_at).toLocaleDateString('pt-BR'):''}${row.ends_at?' até '+new Date(row.ends_at).toLocaleDateString('pt-BR'):''}</p><div class="campaign-status-row"><span class="campaign-status ${esc(row.status)}">${esc(campaignStatusLabel(row.status))}</span><span class="campaign-status ${row.payment_status==='approved'?'active':'pending'}">Pagamento: ${esc(row.payment_status||'pending')}</span>${admin?`<span class="campaign-status active">👁 ${Number(row.impressions||0)} • cliques ${Number(row.clicks||0)}</span>`:''}</div><div class="campaign-actions"><button class="btn btn-soft" onclick="editHomeCampaign('${row.id}')">✏️ Editar</button>${admin&&row.status!=='active'?`<button class="btn btn-primary" onclick="setHomeCampaignStatus('${row.id}','active')">Ativar</button>`:''}${admin&&row.status==='active'?`<button class="btn btn-soft" onclick="setHomeCampaignStatus('${row.id}','paused')">Pausar</button>`:''}<button class="btn btn-danger" onclick="deleteHomeCampaignOnline('${row.id}')">Excluir</button></div></div></article>`).join('')||'<div class="empty">Nenhuma campanha cadastrada.</div>'}</div></div></div>`;
    resetHomeCampaignForm(false);
    if (admin) resetHomeFlashPromotionForm(true);
  }

  window.resetHomeCampaignForm = function(clear = true) {
    const values = {campaignEditId:'',campaignExistingImage:'',campaignTitle:'',campaignSubtitle:'',campaignActionValue:'',campaignAmount:''};
    Object.entries(values).forEach(([id,value])=>{const el=document.getElementById(id);if(el&&clear)el.value=value});
    const image=document.getElementById('campaignImage'); if(image&&clear) image.value='';
    const button=document.getElementById('campaignButtonText'); if(button&&clear) button.value='Ver oferta';
    const type=document.getElementById('campaignActionType'); if(type&&clear) type.value='none';
    const start=document.getElementById('campaignStartsAt'); if(start&&clear) start.value=campaignDateInput(new Date());
    const end=document.getElementById('campaignEndsAt'); if(end&&clear){const d=new Date();d.setDate(d.getDate()+7);end.value=campaignDateInput(d)}
    const status=document.getElementById('campaignStatus'); if(status&&clear) status.value='active';
    const payment=document.getElementById('campaignPaymentStatus'); if(payment&&clear) payment.value='approved';
  };

  window.editHomeCampaign = function(id) {
    const row=onlineHomeCampaignRows.find(item=>String(item.id)===String(id)); if(!row)return;
    const set=(field,value)=>{const el=document.getElementById(field);if(el)el.value=value??''};
    set('campaignEditId',row.id);set('campaignExistingImage',row.image_url);set('campaignTitle',row.title);set('campaignSubtitle',row.subtitle);set('campaignButtonText',row.button_text||'Ver oferta');set('campaignActionType',row.action_type||'none');set('campaignActionValue',row.action_value||'');set('campaignStartsAt',campaignDateInput(row.starts_at));set('campaignEndsAt',campaignDateInput(row.ends_at));set('campaignAmount',row.amount_paid||0);set('campaignStatus',row.status||'pending');set('campaignPaymentStatus',row.payment_status||'pending');document.querySelector('.campaign-form-card')?.scrollIntoView({behavior:'smooth'});
  };

  window.saveHomeCampaignOnline = async function() {
    if (!onlineSession) return toast('Entre na conta para continuar.');
    const button=document.getElementById('saveCampaignButton'); const id=document.getElementById('campaignEditId')?.value||'';
    const title=document.getElementById('campaignTitle')?.value.trim(); const subtitle=document.getElementById('campaignSubtitle')?.value.trim();
    if(!title)return toast('Informe o título da campanha.');
    setBusy(button,true,'Salvando...');
    try{
      let imageUrl=document.getElementById('campaignExistingImage')?.value||''; const file=document.getElementById('campaignImage')?.files?.[0];
      if(file){const upload=await uploadPublicMedia(file);imageUrl=upload.url||''}
      if(!imageUrl)throw new Error('Escolha a imagem da campanha.');
      const existingRow=id?onlineHomeCampaignRows.find(row=>String(row.id)===String(id)):null;
      const payload={city:APP_CITY,owner_id:existingRow?.owner_id||currentUserId(),store_id:existingRow?.store_id??onlineStore?.id??null,title,subtitle:subtitle||null,image_url:imageUrl,button_text:document.getElementById('campaignButtonText')?.value.trim()||null,action_type:document.getElementById('campaignActionType')?.value||'none',action_value:document.getElementById('campaignActionValue')?.value.trim()||null,starts_at:document.getElementById('campaignStartsAt')?.value?new Date(document.getElementById('campaignStartsAt').value).toISOString():new Date().toISOString(),ends_at:document.getElementById('campaignEndsAt')?.value?new Date(document.getElementById('campaignEndsAt').value).toISOString():null};
      if(isAdmin()){payload.status=document.getElementById('campaignStatus')?.value||'active';payload.payment_status=document.getElementById('campaignPaymentStatus')?.value||'approved';payload.amount_paid=Number(document.getElementById('campaignAmount')?.value||0)}else{payload.status='pending';payload.payment_status='pending';payload.amount_paid=0}
      let query=id?onlineClient.from('home_campaigns').update(payload).eq('id',id):onlineClient.from('home_campaigns').insert(payload); const {error}=await query;if(error)throw error;
      await loadPublicData();renderHomeAdsPanel();toast(isAdmin()?'Campanha salva na tela inicial.':'Solicitação enviada para aprovação.');
    }catch(error){toast(/home_campaigns|relation .* does not exist/i.test(error?.message||'')?'Execute primeiro a Etapa 14 no Supabase.':normalizeError(error))}finally{setBusy(button,false)}
  };

  window.setHomeCampaignStatus = async function(id,status){if(!isAdmin())return;const payload={status,payment_status:status==='active'?'approved':undefined};Object.keys(payload).forEach(k=>payload[k]===undefined&&delete payload[k]);const {error}=await onlineClient.from('home_campaigns').update(payload).eq('id',id);if(error)return toast(normalizeError(error));await loadPublicData();renderHomeAdsPanel();toast(status==='active'?'Campanha ativada.':'Campanha pausada.')};
  window.deleteHomeCampaignOnline = async function(id){if(!confirm('Excluir esta campanha?'))return;const {error}=await onlineClient.from('home_campaigns').delete().eq('id',id);if(error)return toast(normalizeError(error));await loadPublicData();renderHomeAdsPanel();toast('Campanha excluída.')};

  async function loadCurrentUser() {
    if (!onlineSession) {
      onlineProfile = null;
      onlineRoles = [];
      onlineStore = null;
      onlinePartnerRequest = null;
      return;
    }
    const uid = currentUserId();
    const [{ data: profile }, { data: roles }, { data: stores }] = await Promise.all([
      onlineClient.from('profiles').select('*').eq('id', uid).maybeSingle(),
      onlineClient.from('user_roles').select('role').eq('user_id', uid),
      onlineClient.from('stores').select('*').eq('owner_id', uid).eq('city', APP_CITY).order('created_at', { ascending: true }).limit(1)
    ]);
    const metadata = onlineSession.user.user_metadata || {};
    onlineProfile = profile || { id: uid, nome: metadata.nome || onlineSession.user.email?.split('@')[0] || 'Meu perfil', whatsapp: metadata.whatsapp || '' };
    if (profile && !profile.whatsapp && metadata.whatsapp) {
      const { error: syncError } = await onlineClient.from('profiles').update({ whatsapp: metadata.whatsapp }).eq('id', uid);
      if (!syncError) onlineProfile.whatsapp = metadata.whatsapp;
    }
    onlineRoles = (roles || []).map(r => r.role);
    onlineStore = stores?.[0] || null;
    if (onlineStore) {
      state.partnerDelivery = {
        type: deliveryToApp(onlineStore.delivery_type),
        fee: Number(onlineStore.delivery_fee || 0),
        area: onlineStore.delivery_area || '',
        estimate: onlineStore.delivery_time || ''
      };
    }
    const requestResult = await onlineClient.from('partner_requests').select('*').eq('user_id', uid).eq('city', APP_CITY).maybeSingle();
    onlinePartnerRequest = requestResult.error ? null : requestResult.data;
  }

  async function fetchAllProducts(pageSize = 1000) {
    const all = [];
    let from = 0;
    while (true) {
      const { data, error } = await onlineClient
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) return { data: all, error };
      const batch = data || [];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return { data: all, error: null };
  }

  async function loadPublicData() {
    contactIndex.clear();
    const [catRes, storeRes, productRes, postRes, swapRes, cattleRes, campaignRes, flashRes] = await Promise.all([
      onlineClient.from('categories').select('*').eq('active', true).order('sort_order'),
      onlineClient.from('stores').select('*').is('deleted_at', null).order('featured', { ascending: false }).order('created_at', { ascending: false }),
      fetchAllProducts(),
      onlineClient.from('community_posts').select('*').order('created_at', { ascending: false }).limit(100),
      onlineClient.from('swap_listings').select('*').order('created_at', { ascending: false }).limit(100),
      onlineClient.from('cattle_listings').select('*').order('created_at', { ascending: false }).limit(100),
      onlineClient.from('home_campaigns').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
      onlineClient.from('home_flash_promotions').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    ]);

    [catRes, storeRes, productRes, postRes, swapRes, cattleRes, campaignRes, flashRes].forEach(result => {
      if (result.error) console.warn(result.error);
    });

    onlineCategories = catRes.data || [];
    const stores = (storeRes.data || []).filter(row => !row.deleted_at && cityMatches(row.city));
    const cityStoreIds = new Set(stores.map(row => String(row.id)));
    const products = (productRes.data || []).filter(row => cityStoreIds.has(String(row.store_id)));
    postRes.data = (postRes.data || []).filter(row => cityMatches(row.city) || (row.store_id && cityStoreIds.has(String(row.store_id))));
    swapRes.data = (swapRes.data || []).filter(row => cityMatches(row.city));
    cattleRes.data = (cattleRes.data || []).filter(row => cityMatches(row.city));
    campaignRes.data = (campaignRes.data || []).filter(row => cityMatches(row.city) || (row.store_id && cityStoreIds.has(String(row.store_id))));
    flashRes.data = (flashRes.data || []).filter(row => cityMatches(row.city));
    const storeMap = new Map(stores.map(s => [s.id, s]));
    const categoryMap = new Map(onlineCategories.map(c => [c.id, c]));
    const uid = currentUserId();
    onlineHomeCampaignRows = campaignRes.data || [];
    const now = Date.now();
    const publicCampaigns = onlineHomeCampaignRows.filter(row => row.status === 'active' && (!row.starts_at || new Date(row.starts_at).getTime() <= now) && (!row.ends_at || new Date(row.ends_at).getTime() >= now)).map(row => ({id:row.id,title:row.title,subtitle:row.subtitle,imageUrl:row.image_url,buttonText:row.button_text,actionType:row.action_type,actionValue:row.action_value,sponsor:row.sponsor_name || storeMap.get(row.store_id)?.name || 'Parceiro em destaque'}));
    window.setHomeCampaigns?.(publicCampaigns);
    onlineFlashPromotionRows = flashRes.data || [];
    const publicFlash = onlineFlashPromotionRows.find(row => row.status === 'active' && (!row.starts_at || new Date(row.starts_at).getTime() <= now) && (!row.ends_at || new Date(row.ends_at).getTime() >= now));
    window.setHomeFlashPromotion?.(publicFlash ? {id:publicFlash.id,topBarTitle:publicFlash.top_bar_title,topBarMediaType:publicFlash.top_bar_media_type||'none',topBarMediaUrl:publicFlash.top_bar_media_url||'',title:publicFlash.title,subtitle:publicFlash.subtitle,partnerName:publicFlash.partner_name,imageUrl:publicFlash.image_url,productImageUrl:publicFlash.product_image_url,oldPrice:publicFlash.old_price,price:publicFlash.price,discountLabel:publicFlash.discount_label,buttonText:publicFlash.button_text,actionType:publicFlash.action_type,actionValue:publicFlash.action_value,startsAt:publicFlash.starts_at,endsAt:publicFlash.ends_at,status:publicFlash.status} : null);

    state.stores = stores.map(s => {
      registerContact(s.name, 'Atendimento da loja', { userId: s.owner_id, storeId: s.id });
      return {
        id: s.id,
        ownerId: s.owner_id,
        name: s.name,
        icon: '🏪',
        rating: s.featured ? 'Destaque' : 'Novo',
        address: [s.address, s.neighborhood, s.city].filter(Boolean).join(', '),
        whatsapp: s.whatsapp,
        foodEnabled: !!s.food_enabled,
        foodType: s.food_type || '',
        foodMinimumOrder: Number(s.food_minimum_order || 0),
        foodAcceptingOrders: s.food_accepting_orders !== false,
        foodEstimatedMinutes: Number(s.food_estimated_minutes || 0),
        foodOpen: s.food_open !== false
      };
    });

    const mappedProducts = products.map(p => {
      const s = storeMap.get(p.store_id) || {};
      const c = categoryMap.get(p.category_id) || {};
      registerContact(s.name || 'Comércio local', p.name, {
        userId: s.owner_id,
        storeId: p.store_id,
        productId: p.id
      });
      return {
        id: p.id,
        remote: true,
        owner: s.owner_id === uid,
        ownerId: s.owner_id,
        storeId: p.store_id,
        name: p.name,
        description: p.description,
        available: p.available !== false,
        category: c.name || 'Outros',
        store: s.name || 'Comércio local',
        contact: s.whatsapp || s.phone || '',
        price: Number(p.promotional_price ?? p.price),
        oldPrice: Number(p.price),
        stock: p.stock_quantity,
        variationType: p.variation_type || 'none',
        variants: normalizeProductVariants(p.variants),
        icon: '📦',
        sponsored: !!p.sponsored,
        popular: Number(p.views || 0),
        deliveryType: deliveryToApp(p.delivery_type || s.delivery_type),
        deliveryFee: Number(p.delivery_fee ?? s.delivery_fee ?? 0),
        deliveryArea: s.delivery_area || '',
        deliveryEstimate: s.food_delivery_estimate || s.delivery_time || '',
        foodSection: p.food_section || null,
        preparationMinutes: Number(p.preparation_minutes || 0) || null,
        serves: p.serves || null,
        mediaId: normalizeRemoteMediaList(p.image_urls, p.image_url),
        createdAt: new Date(p.created_at).getTime()
      };
    });
    state.partnerProducts = uid ? mappedProducts.filter(p => p.owner) : [];
    state.products = mappedProducts.length ? mappedProducts.filter(p => !p.owner) : clone(defaultState.products);

    const authorIds = [
      ...(postRes.data || []).map(x => x.author_id),
      ...(swapRes.data || []).map(x => x.seller_id),
      ...(cattleRes.data || []).map(x => x.seller_id)
    ];
    const profiles = await fetchProfiles(authorIds);

    onlineCommunityPosts = (postRes.data || []).map(p => {
      const profile = profiles.get(p.author_id);
      const store = storeMap.get(p.store_id);
      const partnerPost = p.post_type === 'partner_product' || p.post_type === 'partner_video';
      const author = store?.name || profile?.nome || 'Morador de Itaíba';
      registerContact(author, store?.name || 'Publicação da Comunidade', {
        userId: p.author_id,
        storeId: p.store_id,
        productId: p.product_id
      });
      return {
        id: p.id,
        remote: true,
        owner: p.author_id === uid,
        authorId: p.author_id,
        type: partnerPost ? 'partner' : 'review',
        author,
        commerce: store?.name || 'Comunidade Tem Aqui',
        text: p.body || '',
        rating: Number(p.rating || 0),
        mediaId: p.media_url,
        mediaType: p.media_type,
        icon: partnerPost ? '🎥' : '🛍️',
        date: dateLabel(p.created_at),
        createdAt: new Date(p.created_at).getTime()
      };
    });
    state.ownPosts = onlineCommunityPosts.filter(p => p.owner);

    onlineSwapListings = (swapRes.data || []).map(a => {
      const profile = profiles.get(a.seller_id);
      const seller = profile?.nome || 'Vendedor local';
      registerContact(seller, a.title, { userId: a.seller_id, swapListingId: a.id });
      return {
        id: a.id,
        remote: true,
        owner: a.seller_id === uid,
        sellerId: a.seller_id,
        name: a.title,
        category: a.category || 'Outros',
        icon: swapCategoryIcon(a.category || 'Outros'),
        condition: conditionToApp(a.item_condition),
        price: Number(a.price),
        description: a.description || '',
        contact: a.contact,
        seller,
        mediaId: normalizeRemoteMediaList(a.image_urls, a.image_url),
        createdAt: new Date(a.created_at).getTime()
      };
    });
    state.ownSwapAds = onlineSwapListings.filter(a => a.owner);

    onlineCattleListings = (cattleRes.data || []).map(a => {
      const profile = profiles.get(a.seller_id);
      const seller = profile?.nome || 'Vendedor local';
      const match = /^\[([^\]]+)\]\s*/.exec(a.description || '');
      const type = match?.[1] || 'Animal';
      const note = (a.description || '').replace(/^\[[^\]]+\]\s*/, '');
      registerContact(seller, `${type} à venda`, { userId: a.seller_id, cattleListingId: a.id });
      return {
        id: a.id,
        remote: true,
        owner: a.seller_id === uid,
        sellerId: a.seller_id,
        type,
        price: Number(a.price),
        contact: a.contact,
        seller,
        note,
        mediaId: normalizeRemoteMediaList(a.image_urls, a.image_url),
        createdAt: new Date(a.created_at).getTime()
      };
    });
    state.ownCattleAds = onlineCattleListings.filter(a => a.owner);
    saveState();
    onlineReady = true;
    renderAll();
  }

  async function loadChats() {
    if (!onlineSession) {
      state.chats = [];
      activeChatId = null;
      return;
    }
    const uid = currentUserId();
    const { data: memberships, error: membershipError } = await onlineClient
      .from('conversation_members').select('conversation_id').eq('user_id', uid);
    if (membershipError) throw membershipError;
    const ids = (memberships || []).map(m => m.conversation_id);
    if (!ids.length) {
      state.chats = [];
      activeChatId = null;
      return;
    }
    const [{ data: convs }, { data: members }, { data: messages }] = await Promise.all([
      onlineClient.from('conversations').select('*').in('id', ids).order('last_message_at', { ascending: false }),
      onlineClient.from('conversation_members').select('*').in('conversation_id', ids),
      onlineClient.from('messages').select('*').in('conversation_id', ids).is('deleted_at', null).order('created_at', { ascending: true })
    ]);
    const memberIds = (members || []).map(m => m.user_id);
    const profiles = await fetchProfiles(memberIds);
    state.chats = (convs || []).map(c => {
      const otherMember = (members || []).find(m => m.conversation_id === c.id && m.user_id !== uid);
      const other = profiles.get(otherMember?.user_id);
      const listing = conversationListing(c);
      return {
        id: c.id,
        remote: true,
        otherUserId: otherMember?.user_id,
        seller: other?.nome || 'Usuário do Tem Aqui',
        context: listing.title,
        avatar: listing.icon,
        listingType: listing.type,
        listingId: listing.id,
        listingSource: listing.source,
        listingTitle: listing.title,
        listingPrice: listing.price,
        listingImage: listing.image,
        listingView: listing.view,
        swapListingId: c.swap_listing_id || null,
        cattleListingId: c.cattle_listing_id || null,
        productId: c.product_id || null,
        storeId: c.store_id || null,
        messages: (messages || []).filter(m => m.conversation_id === c.id).map(m => ({
          id: m.id,
          from: m.sender_id === uid ? 'me' : 'them',
          text: m.body || (m.media_url ? 'Arquivo enviado' : ''),
          mediaUrl: m.media_url,
          time: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        }))
      };
    });
    if (activeChatId && !state.chats.some(c => c.id === activeChatId)) activeChatId = null;
    if (!activeChatId && state.chats.length) activeChatId = state.chats[0].id;
    saveState();
    if (currentView === 'chat') renderChats();
  }

  async function loadNotifications() {
    if (!onlineSession) { onlineNotifications=[]; updateMessageBadges(0); return; }
    const { data, error } = await onlineClient.from('notifications').select('*').eq('user_id', currentUserId()).order('created_at', { ascending:false }).limit(100);
    if (error) { console.warn('Notificações:', error); return; }
    onlineNotifications = data || [];
    updateMessageBadges(onlineNotifications.filter(n => !n.read_at).length);
  }

  async function markNotificationsRead() {
    if (!onlineSession) return;
    const unread = onlineNotifications.filter(n => !n.read_at);
    if (!unread.length) { updateMessageBadges(0); return; }
    const { error } = await onlineClient.from('notifications').update({ read_at:new Date().toISOString() }).eq('user_id', currentUserId()).is('read_at', null);
    if (!error) { onlineNotifications = onlineNotifications.map(n => ({...n,read_at:n.read_at||new Date().toISOString()})); updateMessageBadges(0); }
  }

  async function refreshOnline() {
    await loadCurrentUser();
    updateAuthUI();
    if (!onlineSession) return;
    await loadPublicData();
    await loadChats();
    await loadNotifications();
  }

  function updateAuthUI() {
    const accountButton = document.querySelector('button[title="Conta"]');
    if (accountButton) {
      accountButton.textContent = onlineSession ? '✓' : '👤';
      accountButton.title = onlineSession ? `Conta: ${onlineProfile?.nome || userIdentifier()}` : 'Entrar ou criar conta';
    }
    const adminButton = document.getElementById('adminDashboardButton');
    if (adminButton) adminButton.style.display = onlineSession && isAdmin() ? '' : 'none';
    const partnersButton = document.getElementById('adminPartnersButton');
    if (partnersButton) partnersButton.style.display = onlineSession && isAdmin() ? '' : 'none';
    const moderationButton = document.getElementById('adminModerationButton');
    if (moderationButton) moderationButton.style.display = onlineSession && isAdmin() ? '' : 'none';
    const homeAdsButton = document.getElementById('homeAdsButton');
    if (homeAdsButton) homeAdsButton.style.display = onlineSession && (isAdmin() || isPartner()) ? '' : 'none';
    window.temAquiPermissions = {
      isAdmin: !!(onlineSession && isAdmin()),
      isPartner: !!(onlineSession && isPartner()),
      userId: currentUserId(),
      storeId: onlineStore?.id || null,
      storeName: onlineStore?.name || null
    };
    window.dispatchEvent(new CustomEvent('tem-aqui-permissions-updated', { detail: window.temAquiPermissions }));
    const notice = document.querySelector('.notice-inner span');
    if (notice) {
      notice.innerHTML = onlineSession
        ? `<b>Conectado ao banco online:</b> ${esc(onlineProfile?.nome || userIdentifier())}. Produtos, anúncios e conversas podem ser sincronizados entre aparelhos.`
        : '<b>Aplicativo conectado ao Supabase:</b> entre ou crie uma conta para publicar, anunciar e conversar.';
    }
  }

  window.showAuthTab = function (tab) {
    document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b.dataset.authTab === tab));
    document.getElementById('authLoginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('authSignupForm').classList.toggle('hidden', tab !== 'signup');
  };

  window.submitLogin = async function () {
    const button = document.getElementById('loginSubmit');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return toast('Informe o e-mail e a senha.');
    setBusy(button, true, 'Entrando...');
    try {
      const { data, error } = await onlineClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await trackAccess('login', 'account', { userId: data?.user?.id || null, force: true });
      closeModal('authModal');
      toast('Login realizado com sucesso.');
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(button, false);
    }
  };

  window.submitSignup = async function () {
    const button = document.getElementById('signupSubmit');
    const nome = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const whatsapp = document.getElementById('signupWhatsapp').value.trim();
    const password = document.getElementById('signupPassword').value;
    if (!nome || !email || !password) return toast('Preencha nome, e-mail e senha.');
    if (password.length < 8) return toast('Use uma senha com pelo menos 8 caracteres.');

    setBusy(button, true, 'Criando conta...');
    try {
      const { data, error } = await onlineClient.auth.signUp({
        email,
        password,
        options: { data: { nome, whatsapp } }
      });
      if (error) throw error;
      if (!data.session) {
        toast('Conta criada. Verifique o e-mail, caso a confirmação esteja ativada.');
        return;
      }
      if (whatsapp && data.user?.id) {
        const { error: profileError } = await onlineClient.from('profiles').update({ whatsapp }).eq('id', data.user.id);
        if (profileError) console.warn('WhatsApp será sincronizado depois:', profileError);
      }
      await trackAccess('signup', 'account', { userId: data.user?.id || null, force: true });
      closeModal('authModal');
      toast('Conta criada e conectada.');
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(button, false);
    }
  };

  window.saveProfileWhatsapp = async function () {
    if (!onlineSession) return toast('Entre na conta para salvar seu WhatsApp.');
    const button = document.getElementById('saveWhatsappButton');
    const raw = document.getElementById('profileWhatsapp')?.value.trim() || '';
    const digits = raw.replace(/\D/g, '');
    if (digits && ![10, 11, 12, 13].includes(digits.length)) {
      return toast('Informe um WhatsApp válido com DDD.');
    }
    setBusy(button, true, 'Salvando...');
    try {
      const { error: profileError } = await onlineClient.from('profiles').update({ whatsapp: raw }).eq('id', currentUserId());
      if (profileError) throw profileError;
      const { error: metadataError } = await onlineClient.auth.updateUser({ data: { whatsapp: raw } });
      if (metadataError) throw metadataError;
      onlineProfile = { ...(onlineProfile || {}), whatsapp: raw };
      toast('WhatsApp atualizado com sucesso.');
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(button, false);
    }
  };

  window.changePasswordOnline = async function () {
    if (!onlineSession) return toast('Entre na conta para alterar a senha.');
    const button = document.getElementById('changePasswordButton');
    const password = document.getElementById('newAccountPassword')?.value || '';
    const confirmation = document.getElementById('confirmAccountPassword')?.value || '';
    if (password.length < 8) return toast('A nova senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirmation) return toast('As duas senhas não são iguais.');
    setBusy(button, true, 'Alterando...');
    try {
      const { error } = await onlineClient.auth.updateUser({ password });
      if (error) throw error;
      document.getElementById('newAccountPassword').value = '';
      document.getElementById('confirmAccountPassword').value = '';
      toast('Senha alterada com sucesso.');
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(button, false);
    }
  };

  window.logoutOnline = async function () {
    await onlineClient.auth.signOut();
    toast('Você saiu da conta.');
    navigate('home');
  };

  window.copyMyUserId = async function () {
    if (!onlineSession) return;
    await navigator.clipboard?.writeText(currentUserId());
    toast('Seu código de usuário foi copiado.');
  };

  window.requestPartnership = async function () {
    if (needsLogin()) return;
    const name = document.getElementById('requestStoreName')?.value.trim();
    const whatsapp = document.getElementById('requestWhatsapp')?.value.trim();
    if (!name || !whatsapp) return toast('Informe o nome do comércio e o WhatsApp.');
    const payload = {
      user_id: currentUserId(),
      store_name: name,
      responsible_name: document.getElementById('requestResponsible')?.value.trim() || onlineProfile?.nome || null,
      email: onlineSession?.user?.email || null,
      whatsapp,
      category: document.getElementById('requestCategory')?.value || 'Outros',
      address: document.getElementById('requestAddress')?.value.trim() || null,
      monthly_fee: 125,
      due_day: 10,
      city: APP_CITY,
      status: 'pending'
    };
    const { error } = await onlineClient.from('partner_requests').upsert(payload, { onConflict: 'user_id,city' });
    if (error) return toast(normalizeError(error));
    await loadCurrentUser();
    showAccountPanel('partner', document.querySelector('[data-account-panel="partner"]'));
    toast('Solicitação de parceria enviada.');
  };

  window.createStoreOnline = async function () {
    if (!isPartner()) return toast('Sua conta ainda não foi ativada como parceiro.');
    const name = document.getElementById('newStoreName')?.value.trim();
    const whatsapp = document.getElementById('newStoreWhatsapp')?.value.trim();
    if (!name || !whatsapp) return toast('Informe o nome da loja e o WhatsApp.');
    const payload = {
      owner_id: currentUserId(),
      name,
      slug: `${slugify(name)}-${currentUserId().slice(0, 6)}`,
      description: document.getElementById('newStoreDescription')?.value.trim() || null,
      whatsapp,
      phone: whatsapp,
      address: document.getElementById('newStoreAddress')?.value.trim() || null,
      neighborhood: document.getElementById('newStoreNeighborhood')?.value.trim() || null,
      city: APP_CITY,
      delivery_type: 'arrange',
      active: true,
      approved: false,
      featured: false
    };
    const { error } = await onlineClient.from('stores').insert(payload);
    if (error) return toast(normalizeError(error));
    await refreshOnline();
    navigate('account');
    toast('Loja cadastrada. Agora aguarde a aprovação do administrador.');
  };

  function listingPreviewMarkup(items, label) {
    return (items || []).filter(Boolean).slice(0, 5).map((url, index) => `<div class="multi-preview-item edit-existing-media"><img src="${esc(url)}" alt="${esc(label)} ${index + 1}"><span>${index + 1}</span></div>`).join('');
  }

  function listingReturnTarget(kind) {
    return currentView === 'account' && preferredAccountPanel === 'moderation' ? 'moderation' : kind;
  }

  function returnAfterListingSave(kind, target) {
    if (target === 'moderation') {
      rememberAccountPanel('moderation');
      navigate('account');
      setTimeout(renderAdminModerationPanel, 0);
      return;
    }
    navigate(kind);
  }

  function resetSwapListingModal() {
    ['swapEditId','swapExistingMedia','swapEditReturn'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    resetForm(['swapMedia','swapName','swapPrice','swapDescription','swapContact'], ['swapPreview']);
    document.getElementById('swapCategory').value = 'Outros';
    document.getElementById('swapCondition').value = 'Usado';
    document.getElementById('swapModalTitle').textContent = 'Vender na Feira do Troca';
    document.getElementById('swapSubmitButton').textContent = 'Publicar anúncio';
    document.getElementById('swapSubmitButton').dataset.oldText = '';
    document.getElementById('swapCurrentMediaNote').textContent = '';
    const warning = document.getElementById('swapAdminEditWarning');
    warning.style.display = 'none'; warning.textContent = '';
  }

  function resetCattleListingModal() {
    ['cattleEditId','cattleExistingMedia','cattleEditReturn'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    resetForm(['cattleMedia','cattlePrice','cattleContact','cattleNote'], ['cattlePreview']);
    document.getElementById('cattleType').value = 'Bovino';
    document.getElementById('cattleSeller').value = onlineProfile?.nome || 'Meu perfil';
    document.getElementById('cattleModalTitle').textContent = 'Anunciar na Feira do Gado';
    document.getElementById('cattleSubmitButton').textContent = 'Publicar anúncio';
    document.getElementById('cattleSubmitButton').dataset.oldText = '';
    document.getElementById('cattleCurrentMediaNote').textContent = '';
    const warning = document.getElementById('cattleAdminEditWarning');
    warning.style.display = 'none'; warning.textContent = '';
  }

  window.openNewSwapListingModal = function () {
    if (needsLogin('swapModal')) return;
    resetSwapListingModal();
    localOpenModal('swapModal');
  };

  window.openNewCattleListingModal = function () {
    if (needsLogin('cattleModal')) return;
    resetCattleListingModal();
    localOpenModal('cattleModal');
  };

  window.closeSwapListingModal = function () {
    closeModal('swapModal');
    resetSwapListingModal();
  };

  window.closeCattleListingModal = function () {
    closeModal('cattleModal');
    resetCattleListingModal();
  };

  window.openEditSwapListing = function (id) {
    const item = onlineSwapListings.find(x => String(x.id) === String(id));
    if (!item) return toast('Anúncio não encontrado.');
    if (!item.owner && !isAdmin()) return toast('Você não tem permissão para editar este anúncio.');
    resetSwapListingModal();
    document.getElementById('swapEditId').value = item.id;
    document.getElementById('swapExistingMedia').value = JSON.stringify(item.mediaId || []);
    document.getElementById('swapEditReturn').value = listingReturnTarget('swap');
    document.getElementById('swapName').value = item.name || '';
    document.getElementById('swapCategory').value = item.category || 'Outros';
    document.getElementById('swapCondition').value = item.condition || 'Usado';
    document.getElementById('swapPrice').value = Number(item.price || 0);
    document.getElementById('swapDescription').value = item.description || '';
    document.getElementById('swapContact').value = item.contact || '';
    document.getElementById('swapModalTitle').textContent = item.owner ? 'Editar meu anúncio' : 'Editar anúncio de usuário';
    document.getElementById('swapSubmitButton').textContent = 'Salvar alterações';
    document.getElementById('swapPreview').innerHTML = listingPreviewMarkup(item.mediaId, item.name || 'Anúncio');
    document.getElementById('swapCurrentMediaNote').textContent = 'Fotos atuais carregadas. Só escolha novas imagens quando quiser substituir toda a galeria.';
    const warning = document.getElementById('swapAdminEditWarning');
    if (isAdmin() && !item.owner) { warning.style.display = ''; warning.textContent = `🛡️ Você está editando o anúncio publicado por ${item.seller || 'outro usuário'}.`; }
    localOpenModal('swapModal');
  };

  window.openEditCattleListing = function (id) {
    const item = onlineCattleListings.find(x => String(x.id) === String(id));
    if (!item) return toast('Anúncio não encontrado.');
    if (!item.owner && !isAdmin()) return toast('Você não tem permissão para editar este anúncio.');
    resetCattleListingModal();
    document.getElementById('cattleEditId').value = item.id;
    document.getElementById('cattleExistingMedia').value = JSON.stringify(item.mediaId || []);
    document.getElementById('cattleEditReturn').value = listingReturnTarget('cattle');
    document.getElementById('cattlePrice').value = Number(item.price || 0);
    document.getElementById('cattleContact').value = item.contact || '';
    document.getElementById('cattleType').value = ['Bovino','Ovino','Caprino','Outro'].includes(item.type) ? item.type : 'Outro';
    document.getElementById('cattleSeller').value = item.seller || 'Vendedor local';
    document.getElementById('cattleNote').value = item.note || '';
    document.getElementById('cattleModalTitle').textContent = item.owner ? 'Editar meu anúncio de animal' : 'Editar anúncio de usuário';
    document.getElementById('cattleSubmitButton').textContent = 'Salvar alterações';
    document.getElementById('cattlePreview').innerHTML = listingPreviewMarkup(item.mediaId, item.type || 'Animal');
    document.getElementById('cattleCurrentMediaNote').textContent = 'Fotos atuais carregadas. Só escolha novas imagens quando quiser substituir toda a galeria.';
    const warning = document.getElementById('cattleAdminEditWarning');
    if (isAdmin() && !item.owner) { warning.style.display = ''; warning.textContent = `🛡️ Você está editando o anúncio publicado por ${item.seller || 'outro usuário'}.`; }
    localOpenModal('cattleModal');
  };

  openModal = function (id) {
    if (id === 'swapModal') return window.openNewSwapListingModal();
    if (id === 'cattleModal') return window.openNewCattleListingModal();
    if (id === 'communityModal' && needsLogin(id)) return;
    if (id === 'partnerProductModal') {
      if (needsLogin(id)) return;
      const targetStore = currentProductStore();
      if (!targetStore || !canManageCurrentProductStore()) {
        navigate('account');
        toast(adminManagedStore ? 'Acesso administrativo à loja não disponível.' : 'A loja precisa estar aprovada para cadastrar ou editar produtos.');
        return;
      }
      document.getElementById('partnerStoreName').value = targetStore.name || targetStore.store_name || 'Loja parceira';
    }
    localOpenModal(id);
  };

  publishCommunityPost = async function () {
    if (needsLogin('communityModal')) return;
    const file = document.getElementById('postMedia').files[0];
    const text = document.getElementById('postText').value.trim();
    if (!file && !text) return toast('Adicione uma foto, um vídeo ou um texto.');
    const chosenType = document.getElementById('postType').value;
    if (chosenType === 'partner' && (!isPartner() || !onlineStore)) return toast('Somente parceiros com loja cadastrada podem fazer publicação comercial.');
    try {
      const upload = await uploadPublicMedia(file);
      const postType = chosenType === 'partner'
        ? (upload.mediaType === 'video' ? 'partner_video' : 'partner_product')
        : 'feedback';
      const { error } = await onlineClient.from('community_posts').insert({
        author_id: currentUserId(),
        store_id: chosenType === 'partner' ? onlineStore.id : null,
        post_type: postType,
        body: text || null,
        media_url: upload.url,
        media_type: upload.mediaType,
        rating: chosenType === 'review' ? Number(document.getElementById('postRating').value || 0) || null : null,
        city: APP_CITY,
        status: 'published'
      });
      if (error) throw error;
      closeModal('communityModal');
      resetForm(['postMedia', 'postText', 'postCommerce'], ['postPreview']);
      await loadPublicData();
      navigate('community');
      toast('Publicação enviada para a Comunidade.');
    } catch (error) {
      toast(normalizeError(error));
    }
  };

  publishSwapAd = async function () {
    if (needsLogin('swapModal')) return;
    const editId = document.getElementById('swapEditId').value;
    const existing = editId ? onlineSwapListings.find(x => String(x.id) === String(editId)) : null;
    if (editId && (!existing || (!existing.owner && !isAdmin()))) return toast('Você não tem permissão para editar este anúncio.');
    const files = [...document.getElementById('swapMedia').files].slice(0, 5);
    const title = document.getElementById('swapName').value.trim();
    const price = Number(document.getElementById('swapPrice').value);
    const contact = document.getElementById('swapContact').value.trim();
    let existingImages = [];
    try { existingImages = JSON.parse(document.getElementById('swapExistingMedia').value || '[]'); } catch (_) {}
    if ((!files.length && !existingImages.length) || !title || !price || !contact) return toast('Preencha ao menos uma foto, nome, preço e contato.');
    const button = document.getElementById('swapSubmitButton');
    setBusy(button, true, editId ? 'Salvando...' : 'Publicando...');
    try {
      const imageUrls = files.length ? (await uploadPublicMediaList(files)).map(x => x.url) : existingImages;
      const description = document.getElementById('swapDescription').value.trim();
      const payload = {
        title,
        category: document.getElementById('swapCategory').value || 'Outros',
        description: description || null,
        image_url: imageUrls[0],
        image_urls: imageUrls,
        price,
        item_condition: conditionToDb(document.getElementById('swapCondition').value),
        accepts_trade: /troca/i.test(description),
        contact,
        city: APP_CITY,
        status: 'active'
      };
      let query;
      if (editId) query = onlineClient.from('swap_listings').update(payload).eq('id', editId).select('id');
      else query = onlineClient.from('swap_listings').insert({ ...payload, seller_id: currentUserId() }).select('id');
      const { data, error } = await query;
      if (error) throw error;
      if (editId && !data?.length) throw new Error('Edição não autorizada. Execute a Etapa 19 no Supabase.');
      const returnTarget = document.getElementById('swapEditReturn').value || 'swap';
      window.closeSwapListingModal();
      await loadPublicData();
      returnAfterListingSave('swap', returnTarget);
      toast(editId ? 'Anúncio atualizado com sucesso.' : 'Anúncio publicado na Feira do Troca.');
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(button, false);
    }
  };

  publishCattleAd = async function () {
    if (needsLogin('cattleModal')) return;
    const editId = document.getElementById('cattleEditId').value;
    const existing = editId ? onlineCattleListings.find(x => String(x.id) === String(editId)) : null;
    if (editId && (!existing || (!existing.owner && !isAdmin()))) return toast('Você não tem permissão para editar este anúncio.');
    const files = [...document.getElementById('cattleMedia').files].slice(0, 5);
    const price = Number(document.getElementById('cattlePrice').value);
    const contact = document.getElementById('cattleContact').value.trim();
    let existingImages = [];
    try { existingImages = JSON.parse(document.getElementById('cattleExistingMedia').value || '[]'); } catch (_) {}
    if ((!files.length && !existingImages.length) || !price || !contact) return toast('Na Feira do Gado, informe ao menos uma foto, preço e contato.');
    const button = document.getElementById('cattleSubmitButton');
    setBusy(button, true, editId ? 'Salvando...' : 'Publicando...');
    try {
      const imageUrls = files.length ? (await uploadPublicMediaList(files)).map(x => x.url) : existingImages;
      const type = document.getElementById('cattleType').value || 'Animal';
      const note = document.getElementById('cattleNote').value.trim();
      const payload = {
        image_url: imageUrls[0],
        image_urls: imageUrls,
        price,
        contact,
        description: `[${type}] ${note}`.trim(),
        city: APP_CITY,
        status: 'active'
      };
      let query;
      if (editId) query = onlineClient.from('cattle_listings').update(payload).eq('id', editId).select('id');
      else query = onlineClient.from('cattle_listings').insert({ ...payload, seller_id: currentUserId() }).select('id');
      const { data, error } = await query;
      if (error) throw error;
      if (editId && !data?.length) throw new Error('Edição não autorizada. Execute a Etapa 19 no Supabase.');
      const returnTarget = document.getElementById('cattleEditReturn').value || 'cattle';
      window.closeCattleListingModal();
      await loadPublicData();
      returnAfterListingSave('cattle', returnTarget);
      toast(editId ? 'Anúncio de animal atualizado com sucesso.' : 'Animal publicado na Feira do Gado.');
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(button, false);
    }
  };

  function rememberAccountPanel(panel) {
    preferredAccountPanel = panel || 'partner';
    try { sessionStorage.setItem('temAquiPreferredAccountPanel', preferredAccountPanel); } catch (_) {}
  }

  function returnToProductsPanelAfterSave() {
    rememberAccountPanel('products');
    const apply = () => {
      currentView = 'account';
      document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
      document.getElementById('view-account')?.classList.add('active');
      document.querySelectorAll('[data-nav],[data-bottom]').forEach(button => {
        button.classList.toggle('active', button.dataset.nav === 'account' || button.dataset.bottom === 'account');
      });
      const productsButton = document.querySelector('[data-account-panel="products"]');
      showAccountPanel('products', productsButton);
    };
    apply();
    requestAnimationFrame(() => { apply(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    setTimeout(apply, 180);
    setTimeout(apply, 550);
  }

  savePartnerProduct = async function () {
    if (needsLogin('partnerProductModal')) return;
    if (!canManageCurrentProductStore()) return toast(adminManagedStore ? 'Acesso administrativo à loja não disponível.' : 'A loja precisa estar aprovada para cadastrar ou editar produtos.');
    const targetStore = currentProductStore();
    const editId = document.getElementById('partnerProductEditId').value;
    const existing = managedProductList().find(p => String(p.id) === String(editId));
    const name = document.getElementById('partnerProductName').value.trim();
    const currentPrice = Number(document.getElementById('partnerProductPrice').value);
    const oldPrice = Number(document.getElementById('partnerProductOldPrice').value || 0);
    if (!name || !currentPrice) return toast('Informe o nome e o preço.');
    const categoryName = document.getElementById('partnerProductCategory').value;
    const category = onlineCategories.find(c => c.name === categoryName || c.name.startsWith(categoryName) || categoryName.startsWith(c.name));
    const selectedDelivery = document.getElementById('partnerProductDelivery').value;
    const deliveryType = selectedDelivery === 'default' ? null : deliveryToDb(selectedDelivery);
    const deliveryFee = selectedDelivery === 'paid'
      ? Number(document.getElementById('partnerProductDeliveryFee').value || 0)
      : null;
    if (selectedDelivery === 'paid' && deliveryFee <= 0) return toast('Informe o valor cobrado pelo frete.');
    const saveButton = document.getElementById('partnerProductSubmitBtn');
    setBusy(saveButton, true, editId ? 'Salvando...' : 'Cadastrando...');
    try {
      const files = [...document.getElementById('partnerProductMedia').files].slice(0, 5);
      let imageUrls = normalizeRemoteMediaList(existing?.mediaId, null);
      if (!imageUrls.length) {
        try { imageUrls = normalizeRemoteMediaList(JSON.parse(document.getElementById('partnerProductExistingMedia').value || '[]'), null); }
        catch (_) { imageUrls = normalizeRemoteMediaList(document.getElementById('partnerProductExistingMedia').value, null); }
      }
      if (files.length) {
        const uploads = await uploadPublicMediaList(files);
        imageUrls = uploads.map(x => x.url);
      }
      const imageUrl = imageUrls[0] || null;
      const hasPromotion = oldPrice > currentPrice;
      const payload = {
        category_id: category?.id || null,
        name,
        description: document.getElementById('partnerProductDescription').value.trim() || null,
        price: hasPromotion ? oldPrice : currentPrice,
        promotional_price: hasPromotion ? currentPrice : null,
        image_url: imageUrl,
        image_urls: imageUrls,
        variation_type: document.getElementById('partnerProductVariationType').value || 'none',
        variants: collectProductVariants(),
        stock_quantity: Number(document.getElementById('partnerProductStock').value || 0),
        available: document.getElementById('partnerProductAvailable').value === 'true',
        food_section: categoryName === 'Food / Delivery' ? document.getElementById('partnerFoodSection').value : null,
        preparation_minutes: categoryName === 'Food / Delivery' ? Number(document.getElementById('partnerFoodPrepMinutes').value || 0) || null : null,
        serves: categoryName === 'Food / Delivery' ? document.getElementById('partnerFoodServes').value.trim() || null : null,
        delivery_type: deliveryType,
        delivery_fee: deliveryFee
      };
      let result;
      if (editId) {
        result = await onlineClient.from('products').update(payload).eq('id', editId).eq('store_id', targetStore.id);
      } else {
        result = await onlineClient.from('products').insert({
          ...payload,
          store_id: targetStore.id,
          sponsored: false
        });
      }
      if (result.error) throw result.error;
      closeProductModal();
      if (adminManagedStore) {
        rememberAccountPanel('adminStore');
        await refreshAdminManagedStoreAfterProductChange();
        toast(editId ? 'Produto atualizado. Você continua na loja administrada.' : 'Produto cadastrado. Você continua na loja administrada.');
      } else {
        rememberAccountPanel('products');
        await loadPublicData();
        renderHome();
        returnToProductsPanelAfterSave();
        toast(editId ? 'Produto atualizado. Você continua em Meus produtos.' : 'Produto cadastrado. Você continua em Meus produtos.');
      }
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(saveButton, false);
    }
  };
  publishPartnerProduct = savePartnerProduct;

  deletePartnerProduct = async function (id) {
    const product = managedProductList().find(p => String(p.id) === String(id));
    if (!product) return toast('Produto não encontrado.');
    if (!product.remote) return localDeletePartnerProduct(id);
    if (!canManageCurrentProductStore()) return toast(adminManagedStore ? 'Acesso administrativo à loja não disponível.' : 'A loja precisa estar aprovada para alterar produtos.');
    if (!confirm(`Apagar o produto “${product.name}”? Esta ação não poderá ser desfeita.`)) return;
    try {
      const { error } = await onlineClient
        .from('products')
        .delete()
        .eq('id', id)
        .eq('store_id', currentProductStore().id);
      if (error) throw error;
      state.favorites = (state.favorites || []).filter(item => String(item) !== String(id));
      if (Array.isArray(state.cart)) state.cart = state.cart.filter(item => String(item.productId) !== String(id));
      saveState();
      closeProductModal();
      if (adminManagedStore) {
        rememberAccountPanel('adminStore');
        await refreshAdminManagedStoreAfterProductChange();
        toast('Produto apagado. Você continua na loja administrada.');
      } else {
        rememberAccountPanel('products');
        await loadPublicData();
        renderHome();
        returnToProductsPanelAfterSave();
        toast('Produto apagado. Você continua em Meus produtos.');
      }
    } catch (error) {
      toast(normalizeError(error));
    }
  };

  savePartnerDelivery = async function () {
    if (!onlineStore) return toast('Cadastre uma loja antes de configurar a entrega.');
    const type = document.getElementById('deliveryDefaultType').value;
    const fee = type === 'paid' ? Number(document.getElementById('deliveryDefaultFee').value || 0) : 0;
    if (type === 'paid' && fee <= 0) return toast('Informe o valor cobrado pelo frete.');
    const payload = {
      delivery_type: deliveryToDb(type),
      delivery_fee: fee || null,
      delivery_area: document.getElementById('deliveryDefaultArea').value.trim() || null,
      delivery_time: document.getElementById('deliveryDefaultEstimate').value.trim() || null
    };
    const { error } = await onlineClient.from('stores').update(payload).eq('id', onlineStore.id);
    if (error) return toast(normalizeError(error));
    await loadCurrentUser();
    renderHome();
    toggleDeliveryConfigFields();
    toast('Configuração de entrega salva online.');
  };

  deleteOwnPost = async function (id) {
    const item = onlineCommunityPosts.find(x => x.id === id);
    if (!item?.remote) return localDeleteOwnPost(id);
    if (!confirm('Apagar esta publicação?')) return;
    const { error } = await onlineClient.from('community_posts').delete().eq('id', id);
    if (error) return toast(normalizeError(error));
    await loadPublicData();
    renderCommunity();
  };

  deleteSwap = async function (id) {
    const item = onlineSwapListings.find(x => x.id === id);
    if (!item?.remote) return localDeleteSwap(id);
    if (!onlineSession) return toast('Entre na conta para apagar anúncios.');
    if (!item.owner && !isAdmin()) return toast('Você não tem permissão para apagar este anúncio.');
    const adminAction = isAdmin() && !item.owner;
    const question = adminAction
      ? `Apagar o anúncio “${item.name || 'Sem título'}” de ${item.seller || 'outro usuário'}?`
      : 'Apagar este anúncio?';
    if (!confirm(question)) return;
    const { data, error } = await onlineClient.from('swap_listings').delete().eq('id', id).select('id');
    if (error) return toast(normalizeError(error));
    if (!data?.length) return toast('O anúncio não foi apagado. Execute a ETAPA 17 no Supabase para liberar a moderação administrativa.');
    await loadPublicData();
    if (currentView === 'account' && preferredAccountPanel === 'moderation') renderAdminModerationPanel();
    else renderSwap();
    toast(adminAction ? 'Anúncio removido pela administração.' : 'Seu anúncio foi apagado.');
  };

  deleteCattle = async function (id) {
    const item = onlineCattleListings.find(x => x.id === id);
    if (!item?.remote) return localDeleteCattle(id);
    if (!onlineSession) return toast('Entre na conta para apagar anúncios.');
    if (!item.owner && !isAdmin()) return toast('Você não tem permissão para apagar este anúncio.');
    const adminAction = isAdmin() && !item.owner;
    const question = adminAction
      ? `Apagar o anúncio de ${item.type || 'animal'} publicado por ${item.seller || 'outro usuário'}?`
      : 'Apagar este anúncio?';
    if (!confirm(question)) return;
    const { data, error } = await onlineClient.from('cattle_listings').delete().eq('id', id).select('id');
    if (error) return toast(normalizeError(error));
    if (!data?.length) return toast('O anúncio não foi apagado. Execute a ETAPA 17 no Supabase para liberar a moderação administrativa.');
    await loadPublicData();
    if (currentView === 'account' && preferredAccountPanel === 'moderation') renderAdminModerationPanel();
    else renderCattle();
    toast(adminAction ? 'Anúncio removido pela administração.' : 'Seu anúncio foi apagado.');
  };

  renderCommunity = async function () {
    if (!onlineReady) return localRenderCommunity();
    clearUrls();
    let posts = onlineCommunityPosts.length ? [...onlineCommunityPosts] : [...demoPosts];
    if (feedFilter === 'mine') posts = onlineSession ? onlineCommunityPosts.filter(p => p.owner) : [];
    if (feedFilter === 'review') posts = posts.filter(p => p.type === 'review');
    if (feedFilter === 'partner') posts = posts.filter(p => p.type === 'partner');
    posts = sortCollection(posts, feedSort);
    const html = [];
    for (const p of posts) {
      const media = await mediaHTML(p.mediaId, p.icon || (p.type === 'partner' ? '🎥' : '🛍️'));
      html.push(`<article class="post"><div class="post-head"><div class="avatar">${p.type === 'partner' ? '🏪' : '👤'}</div><div><b>${esc(p.author)} ${p.type === 'partner' ? '<span class="verified">● Parceiro</span>' : ''}</b><small>${esc(p.commerce)} • ${esc(p.date)}</small></div></div><div class="post-media">${p.owner ? '<span class="owner-tag">Minha publicação</span>' : ''}${media}</div><div class="post-body"><div class="post-text">${esc(p.text || 'Publicação sem descrição.')}</div>${p.rating ? `<div class="rating">${'★'.repeat(p.rating)}${'☆'.repeat(5 - p.rating)}</div>` : ''}<div class="post-actions"><button onclick="toast('Curtida registrada.')">♡ Curtir</button><button onclick="openChat('${escAttr(p.author)}','${escAttr(p.commerce)}','${p.type === 'partner' ? '🏪' : '👤'}')">💬 Comentar</button><button onclick="shareText('${escAttr(p.commerce)}')">↗ Compartilhar</button>${p.owner ? `<button onclick="deleteOwnPost('${p.id}')">🗑 Apagar</button>` : ''}</div></div></article>`);
    }
    document.getElementById('communityFeed').innerHTML = html.join('') || '<div class="empty">Nenhuma publicação nesta categoria.</div>';
  };

  renderSwap = async function () {
    if (!onlineReady) return localRenderSwap();
    clearUrls();
    let ads = onlineSwapListings.length ? [...onlineSwapListings] : [...demoSwap];
    if (swapFilter === 'mine') ads = onlineSession ? onlineSwapListings.filter(a => a.owner) : [];
    else if (swapFilter !== 'all') ads = ads.filter(a => a.condition === swapFilter);
    if (swapCategoryFilter !== 'all') ads = ads.filter(a => (a.category || 'Outros') === swapCategoryFilter);
    ads = sortCollection(ads, swapSort);
    const html = [];
    for (const a of ads) {
      const category = a.category || 'Outros';
      const media = await mediaHTML(a.mediaId, a.icon || swapCategoryIcon(category), a.name || 'Anúncio');
      html.push(`<article class="listing"><span class="condition">${esc(a.condition)}</span><div class="listing-media">${media}</div><div class="listing-body"><div class="listing-category-label">${swapCategoryIcon(category)} ${esc(category)}</div><div class="listing-price">${money(a.price)}</div><div class="listing-title">${esc(a.name)}</div><div class="listing-meta">${esc(a.description || 'Sem descrição.')}<br>Vendedor: ${esc(a.seller || 'Usuário local')}<br><small>${a.createdAt ? 'Anúncio recente' : 'Anúncio local'}</small></div><div class="actions"><button class="btn btn-blue" onclick="openChat('${escAttr(a.seller || 'Vendedor')}','${escAttr(a.name)}','${swapCategoryIcon(category)}','swap','${a.id}')">Conversar</button><button class="btn btn-wa square" onclick="contactWhatsApp('${escAttr(a.contact)}','Olá! Vi o anúncio de ${escAttr(a.name)} no Tem Aqui.')">☎</button>${(a.owner || isAdmin()) ? `<button class="btn btn-soft square" title="${isAdmin() && !a.owner ? 'Editar como administrador' : 'Editar meu anúncio'}" onclick="openEditSwapListing('${a.id}')">✏️</button><button class="btn btn-danger square" title="${isAdmin() && !a.owner ? 'Apagar como administrador' : 'Apagar meu anúncio'}" onclick="deleteSwap('${a.id}')">🗑</button>` : ''}</div></div></article>`);
    }
    document.getElementById('swapGrid').innerHTML = html.join('') || '<div class="empty">Nenhum anúncio encontrado nesta categoria.</div>';
  };

  renderCattle = async function () {
    if (!onlineReady) return localRenderCattle();
    clearUrls();
    let ads = onlineCattleListings.length ? [...onlineCattleListings] : [...demoCattle];
    if (cattleFilter === 'mine') ads = onlineSession ? onlineCattleListings.filter(a => a.owner) : [];
    else if (cattleFilter !== 'all') ads = ads.filter(a => a.type === cattleFilter);
    ads = sortCollection(ads, cattleSort);
    const html = [];
    for (const a of ads) {
      const media = await mediaHTML(a.mediaId, a.icon || '🐂', 'Animal da Feira do Gado');
      html.push(`<article class="listing cattle"><span class="condition">${esc(a.type || 'Animal')}</span><div class="listing-media">${media}</div><div class="listing-body"><div class="listing-price">${money(a.price)}</div><div class="listing-title">Animal à venda</div><div class="listing-meta">${esc(a.note || 'Entre em contato para mais informações.')}<br>Vendedor: ${esc(a.seller || 'Usuário local')}<br><small>${a.createdAt ? 'Anúncio recente' : 'Anúncio local'}</small></div><div class="contact-tabs"><button class="btn btn-blue" onclick="openChat('${escAttr(a.seller || 'Vendedor')}','${escAttr((a.type || 'Animal') + ' à venda')}','🐂','cattle','${a.id}')">💬 Chat</button><button class="btn btn-wa" onclick="contactWhatsApp('${escAttr(a.contact)}','Olá! Vi seu animal na Feira do Gado do Tem Aqui.')">WhatsApp</button><button class="btn btn-soft" onclick="callPhone('${escAttr(a.contact)}')">Ligar</button></div>${(a.owner || isAdmin()) ? `<div class="listing-management-actions"><button class="btn btn-soft" onclick="openEditCattleListing('${a.id}')">${isAdmin() && !a.owner ? '🛡️ Editar' : '✏️ Editar'}</button><button class="btn btn-danger" onclick="deleteCattle('${a.id}')">${isAdmin() && !a.owner ? '🛡️ Apagar' : '🗑️ Apagar'}</button></div>` : ''}</div></article>`);
    }
    document.getElementById('cattleGrid').innerHTML = html.join('') || '<div class="empty">Nenhum animal anunciado nesta categoria.</div>';
  };

  openChat = async function (seller, context, avatar = '💬', referenceType = '', referenceId = '') {
    if (needsLogin()) return;
    const target = findContact(seller, context, referenceType, referenceId);
    if (!target?.userId) {
      toast('Este conteúdo demonstrativo ainda não possui um vendedor conectado.');
      return;
    }
    if (target.userId === currentUserId()) {
      toast('Este anúncio pertence à sua própria conta.');
      return;
    }
    const existing = state.chats.find(c => {
      if (!c.remote || c.otherUserId !== target.userId) return false;
      if (target.swapListingId) return String(c.swapListingId || c.listingId) === String(target.swapListingId);
      if (target.cattleListingId) return String(c.cattleListingId || c.listingId) === String(target.cattleListingId);
      if (target.productId) return String(c.productId || c.listingId) === String(target.productId);
      if (target.storeId) return String(c.storeId || '') === String(target.storeId) && c.context === context;
      return c.context === context;
    });
    if (existing) {
      activeChatId = existing.id;
      navigate('chat');
      return;
    }
    const conversationId = crypto.randomUUID();
    const { error: convError } = await onlineClient.from('conversations').insert({
      id: conversationId,
      created_by: currentUserId(),
      store_id: target.storeId || null,
      product_id: target.productId || null,
      swap_listing_id: target.swapListingId || null,
      cattle_listing_id: target.cattleListingId || null,
      title: context,
      status: 'active'
    });
    if (convError) return toast(normalizeError(convError));
    const { error: memberError } = await onlineClient.from('conversation_members').insert([
      { conversation_id: conversationId, user_id: currentUserId() },
      { conversation_id: conversationId, user_id: target.userId }
    ]);
    if (memberError) return toast(normalizeError(memberError));
    await loadChats();
    activeChatId = conversationId;
    navigate('chat');
    renderChats();
  };

  renderChats = function () {
    const list = document.getElementById('threadList');
    if (!list) return;
    if (!activeChatId && state.chats.length) activeChatId = state.chats[0].id;
    list.innerHTML = state.chats.map(c => {
      const last = c.messages[c.messages.length - 1];
      const thumb = c.listingImage
        ? `<img class="thread-ad-thumb" src="${esc(c.listingImage)}" alt="${esc(c.listingTitle || 'Anúncio')}">`
        : `<div class="thread-ad-thumb thread-ad-fallback">${c.avatar || '💬'}</div>`;
      const price = Number(c.listingPrice || 0) > 0 ? `<strong>${money(c.listingPrice)}</strong>` : '';
      return `<button type="button" class="thread ad-thread ${c.id === activeChatId ? 'active' : ''}" onclick="selectChat('${c.id}')">${thumb}<span class="thread-main"><span class="thread-source">${esc(c.listingSource || 'Conversa')}</span><b class="thread-ad-title">${esc(c.listingTitle || c.context || 'Conversa')}</b><span class="thread-ad-price">${price}</span><p><span>${esc(c.seller)}</span> · ${esc(last?.text || 'Toque para conversar sobre este anúncio')}</p></span></button>`;
    }).join('') || '<div class="empty" style="margin:12px">Nenhuma conversa. Abra um anúncio e toque em Conversar.</div>';

    const chat = state.chats.find(c => c.id === activeChatId);
    const panel = document.getElementById('chatPanel');
    if (!chat) {
      panel.innerHTML = '<div class="no-chat"><div><div style="font-size:58px">💬</div><h3>Escolha uma conversa</h3><p>Cada caixa corresponde a um anúncio diferente.</p></div></div>';
      return;
    }
    const contextThumb = chat.listingImage
      ? `<img src="${esc(chat.listingImage)}" alt="${esc(chat.listingTitle || 'Anúncio')}">`
      : `<span>${chat.avatar || '💬'}</span>`;
    const contextPrice = Number(chat.listingPrice || 0) > 0 ? `<b>${money(chat.listingPrice)}</b>` : '';
    const viewButton = chat.listingView && chat.listingView !== 'chat'
      ? `<button type="button" class="chat-context-open" onclick="navigate('${escAttr(chat.listingView)}')">Ver anúncio</button>` : '';
    panel.innerHTML = `<div class="chat-listing-context"><div class="chat-context-thumb">${contextThumb}</div><div class="chat-context-main"><small>${esc(chat.listingSource || 'Conversa sobre anúncio')}</small><strong>${esc(chat.listingTitle || chat.context || 'Conversa')}</strong>${contextPrice}</div>${viewButton}</div><div class="chat-top"><div class="thread-avatar">👤</div><div><h3>${esc(chat.seller)}</h3><small>Conversa relacionada somente a este anúncio</small></div></div><div id="messageList" class="messages">${chat.messages.map(m => `<div class="bubble ${m.from === 'me' ? 'me' : ''}">${esc(m.text)}<small>${esc(m.time)}</small></div>`).join('') || '<div class="chat-empty-message">Envie a primeira mensagem sobre este anúncio.</div>'}</div><div class="quick-replies"><button onclick="sendQuick('Ainda está disponível?')">Ainda está disponível?</button><button onclick="sendQuick('O preço é negociável?')">O preço é negociável?</button><button onclick="sendQuick('Aceita troca?')">Aceita troca?</button><button onclick="sendQuick('Onde posso ver?')">Onde posso ver?</button></div><div class="composer"><input id="chatInput" placeholder="Mensagem sobre ${escAttr(chat.listingTitle || 'o anúncio')}" onkeydown="if(event.key==='Enter')sendMessage()"><button class="btn btn-primary" onclick="sendMessage()">Enviar</button></div>`;
    setTimeout(() => { const m = document.getElementById('messageList'); if (m) m.scrollTop = m.scrollHeight; }, 0);
  };

  sendMessage = async function () {
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;
    const chat = state.chats.find(c => c.id === activeChatId);
    if (!chat?.remote) return localSendMessage();
    if (!onlineSession) return toast('Faça login para enviar mensagens.');
    input.disabled = true;
    const { error } = await onlineClient.from('messages').insert({
      conversation_id: chat.id,
      sender_id: currentUserId(),
      message_type: 'text',
      body: text
    });
    input.disabled = false;
    if (error) return toast(normalizeError(error));
    input.value = '';
    await loadChats();
    renderChats();
  };


  function renderFoodSettingsPanel() {
    const c = document.getElementById('accountContent');
    if (!onlineStore) {
      c.innerHTML = '<h2>Configurar Tem Aqui Food</h2><div class="empty">Cadastre sua loja antes de ativar a área Food.</div>';
      return;
    }
    c.innerHTML = `<div class="section-head"><div><h2>Configurar Tem Aqui Food</h2><div class="section-sub">Sua loja poderá aparecer na aba exclusiva de comidas e delivery.</div></div></div><div class="delivery-config"><div class="field"><label>Exibir minha loja no Food?</label><select id="foodStoreEnabled"><option value="true" ${onlineStore.food_enabled?'selected':''}>Sim, ativar</option><option value="false" ${!onlineStore.food_enabled?'selected':''}>Não</option></select></div><div class="field"><label>Tipo de estabelecimento</label><select id="foodStoreType"><option ${onlineStore.food_type==='Lanchonete'?'selected':''}>Lanchonete</option><option ${onlineStore.food_type==='Pizzaria'?'selected':''}>Pizzaria</option><option ${onlineStore.food_type==='Hamburgueria'?'selected':''}>Hamburgueria</option><option ${onlineStore.food_type==='Sorveteria'?'selected':''}>Sorveteria</option><option ${onlineStore.food_type==='Açaí'?'selected':''}>Açaí</option><option ${onlineStore.food_type==='Restaurante'?'selected':''}>Restaurante</option><option ${onlineStore.food_type==='Marmitaria'?'selected':''}>Marmitaria</option><option ${onlineStore.food_type==='Outro'?'selected':''}>Outro</option></select></div><div class="field"><label>Pedido mínimo</label><input id="foodMinimumOrder" type="number" step="0.01" min="0" value="${Number(onlineStore.food_minimum_order||0)}"></div><div class="field"><label>Tempo médio de entrega (minutos)</label><input id="foodEstimatedMinutes" type="number" min="0" value="${Number(onlineStore.food_estimated_minutes||0)}"></div><div class="field"><label>Está aceitando pedidos?</label><select id="foodAcceptingOrders"><option value="true" ${onlineStore.food_accepting_orders!==false?'selected':''}>Sim</option><option value="false" ${onlineStore.food_accepting_orders===false?'selected':''}>Não</option></select></div><div class="field"><label>Status da loja agora</label><select id="foodOpen"><option value="true" ${onlineStore.food_open!==false?'selected':''}>Aberta</option><option value="false" ${onlineStore.food_open===false?'selected':''}>Fechada</option></select></div><div class="field full"><label>Prazo exibido ao cliente</label><input id="foodDeliveryEstimate" value="${esc(onlineStore.food_delivery_estimate||onlineStore.delivery_time||'')}" placeholder="Ex.: 30 a 50 minutos"></div><div class="food-settings-note">Depois, abra Meus produtos e cadastre o cardápio escolhendo a categoria <b>Food / Delivery</b>. Cada item poderá informar tipo, tempo de preparo e quantas pessoas serve.</div><button id="saveFoodSettingsButton" class="btn btn-primary field full" onclick="saveFoodSettingsOnline()">Salvar configuração Food</button></div>`;
  }

  window.saveFoodSettingsOnline = async function () {
    if (!onlineStore) return toast('Cadastre sua loja primeiro.');
    const button = document.getElementById('saveFoodSettingsButton');
    setBusy(button, true, 'Salvando...');
    try {
      const payload = {
        food_enabled: document.getElementById('foodStoreEnabled').value === 'true',
        food_type: document.getElementById('foodStoreType').value,
        food_minimum_order: Number(document.getElementById('foodMinimumOrder').value || 0),
        food_estimated_minutes: Number(document.getElementById('foodEstimatedMinutes').value || 0),
        food_accepting_orders: document.getElementById('foodAcceptingOrders').value === 'true',
        food_open: document.getElementById('foodOpen').value === 'true',
        food_delivery_estimate: document.getElementById('foodDeliveryEstimate').value.trim() || null
      };
      const { data, error } = await onlineClient.from('stores').update(payload).eq('id', onlineStore.id).select('*').single();
      if (error) throw error;
      onlineStore = data;
      await loadPublicData();
      renderFoodSettingsPanel();
      toast('Configuração Food salva.');
    } catch (error) {
      toast(/food_enabled|column .* does not exist/i.test(error?.message||'') ? 'Execute primeiro o arquivo ETAPA-12-TEM-AQUI-FOOD.sql no Supabase.' : normalizeError(error));
    } finally { setBusy(button, false); }
  };

  function renderAdminModerationPanel() {
    const c = document.getElementById('accountContent');
    if (!c) return;
    if (!isAdmin()) {
      c.innerHTML = '<h2>Moderação de anúncios</h2><div class="empty">Esta área é exclusiva da conta administradora.</div>';
      return;
    }

    const normalizeKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const duplicateCounts = new Map();
    onlineSwapListings.forEach(a => {
      const key = `swap|${a.sellerId || ''}|${normalizeKey(a.name)}`;
      duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
    });
    onlineCattleListings.forEach(a => {
      const key = `cattle|${a.sellerId || ''}|${normalizeKey(a.type)}|${Number(a.price || 0).toFixed(2)}`;
      duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
    });

    const rows = [
      ...onlineSwapListings.map(a => ({
        id: a.id, kind: 'swap', badge: `⇄ Feira do Troca • ${a.category || 'Outros'}`, title: a.name || 'Anúncio sem título',
        seller: a.seller || 'Usuário local', price: a.price, createdAt: a.createdAt,
        mediaId: a.mediaId, duplicateKey: `swap|${a.sellerId || ''}|${normalizeKey(a.name)}`
      })),
      ...onlineCattleListings.map(a => ({
        id: a.id, kind: 'cattle', badge: '🐂 Feira do Gado', title: `${a.type || 'Animal'} à venda`,
        seller: a.seller || 'Usuário local', price: a.price, createdAt: a.createdAt,
        mediaId: a.mediaId, duplicateKey: `cattle|${a.sellerId || ''}|${normalizeKey(a.type)}|${Number(a.price || 0).toFixed(2)}`
      }))
    ].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    const duplicated = rows.filter(row => (duplicateCounts.get(row.duplicateKey) || 0) > 1).length;
    const cards = rows.map(row => {
      const media = Array.isArray(row.mediaId) ? row.mediaId : (row.mediaId ? [row.mediaId] : []);
      const firstImage = media[0] || '';
      const duplicateTag = (duplicateCounts.get(row.duplicateKey) || 0) > 1
        ? '<span class="status warn">⚠ Possível repetido</span>' : '';
      const date = row.createdAt ? new Date(row.createdAt).toLocaleDateString('pt-BR') : 'Data não informada';
      const action = row.kind === 'swap' ? `deleteSwap('${row.id}')` : `deleteCattle('${row.id}')`;
      return `<article class="product-manage-card"><div class="product-manage-top"><div class="product-manage-thumb">${firstImage ? `<img src="${esc(firstImage)}" alt="${esc(row.title)}" loading="lazy">` : (row.kind === 'swap' ? '📦' : '🐂')}</div><div class="product-manage-info"><h3>${esc(row.title)}</h3><p>${esc(row.badge)} • ${esc(row.seller)}</p></div></div><div class="product-manage-prices"><strong>${money(row.price)}</strong>${duplicateTag}</div><div class="product-manage-meta"><span>Publicado em ${esc(date)}</span><span>ID: ${esc(String(row.id).slice(0, 8))}</span></div><div class="product-manage-actions moderation-actions"><button type="button" class="btn btn-primary" onclick="${row.kind === 'swap' ? `openEditSwapListing('${row.id}')` : `openEditCattleListing('${row.id}')`}">✏️ Editar anúncio</button><button type="button" class="btn btn-soft" onclick="navigate('${row.kind === 'swap' ? 'swap' : 'cattle'}')">Ver na feira</button><button type="button" class="btn btn-danger" onclick="${action}">🗑️ Apagar anúncio</button></div></article>`;
    }).join('');

    c.innerHTML = `<div class="section-head"><div><h2>Moderação de anúncios</h2><div class="section-sub">Edite ou apague anúncios repetidos, incompletos ou inadequados de qualquer usuário nas duas feiras.</div></div><button class="btn btn-soft" onclick="renderAdminModerationPanel()">↻ Atualizar</button></div><div class="stats"><div class="stat"><small>Feira do Troca</small><b>${onlineSwapListings.length}</b></div><div class="stat"><small>Feira do Gado</small><b>${onlineCattleListings.length}</b></div><div class="stat"><small>Total de anúncios</small><b>${rows.length}</b></div><div class="stat"><small>Possíveis repetidos</small><b>${duplicated}</b></div></div><div class="products-manage-help">Os itens marcados como “Possível repetido” têm o mesmo vendedor e informações muito semelhantes. Confira antes de apagar.</div><div class="products-manage-list">${cards || '<div class="empty">Nenhum anúncio publicado nas feiras.</div>'}</div>`;
  }

  window.renderAdminModerationPanel = renderAdminModerationPanel;


  // -------------------------------------------------------------------------
  // PAINEL ADMINISTRATIVO DE PARCEIROS — VERSÃO 29
  // -------------------------------------------------------------------------

  let adminPartnerData = { partners: [], requests: [], payments: [] };
  let adminPartnerTab = 'partners';
  let adminPartnerSearch = '';
  let adminPartnerStatusFilter = '';
  let adminPartnerPaymentFilter = '';
  let adminManagedStore = null;

  function ownStoreApproved() {
    if (!onlineStore) return false;
    if (onlineStore.partner_status) return onlineStore.partner_status === 'approved';
    return onlineStore.approved !== false;
  }

  function currentProductStore() {
    return adminManagedStore || onlineStore;
  }

  function canManageCurrentProductStore() {
    if (adminManagedStore) return isAdmin();
    return isPartner() && ownStoreApproved();
  }

  function managedProductList() {
    const store = currentProductStore();
    if (!store) return [];
    return [...(state.partnerProducts || []), ...(state.products || [])]
      .filter((product, index, array) => String(product.storeId || '') === String(store.id) && array.findIndex(x => String(x.id) === String(product.id)) === index);
  }

  function partnerStatusLabel(value) {
    return ({ pending:'Pendente', approved:'Aprovado', blocked:'Bloqueado', cancelled:'Cancelado' })[value] || value || 'Pendente';
  }

  function paymentStatusLabel(value) {
    return ({ paid:'Pago', pending:'Pendente', overdue:'Atrasado', free:'Cortesia', cancelled:'Cancelado' })[value] || value || 'Pendente';
  }

  function partnerDate(value) {
    if (!value) return '—';
    const date = new Date(String(value).slice(0,10) + 'T12:00:00');
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
  }

  function partnerBadge(value, type = 'partner') {
    const label = type === 'payment' ? paymentStatusLabel(value) : partnerStatusLabel(value);
    return `<span class="admin-partner-badge ${esc(value || 'pending')}">${esc(label)}</span>`;
  }

  function ensureAdminPartnerModals() {
    if (!document.getElementById('adminPartnerModal')) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div id="adminPartnerModal" class="modal-backdrop">
          <div class="modal">
            <div class="modal-head"><h3 id="adminPartnerModalTitle">Cadastrar parceiro</h3><button class="close" onclick="closeModal('adminPartnerModal')">✕</button></div>
            <input id="adminPartnerStoreId" type="hidden">
            <div class="form">
              <div id="adminPartnerEmailField" class="field full"><label>E-mail da conta *</label><input id="adminPartnerEmail" type="email" placeholder="E-mail usado pelo parceiro para entrar"></div>
              <div class="field"><label>Nome da loja *</label><input id="adminPartnerStoreName"></div>
              <div class="field"><label>Responsável</label><input id="adminPartnerResponsible"></div>
              <div class="field"><label>WhatsApp</label><input id="adminPartnerWhatsapp" inputmode="tel"></div>
              <div class="field"><label>Categoria / segmento</label><select id="adminPartnerCategory"><option>Mercado</option><option>Food / Delivery</option><option>Moda e Calçados</option><option>Perfumaria e Beleza</option><option>Farmácia</option><option>Eletrônicos</option><option>Frigoríficos e Açougues</option><option>Casa e Decoração</option><option>Automotivo</option><option>Agro e Rural</option><option>Materiais de Construção</option><option>Serviços</option><option>Outros</option></select></div>
              <div class="field full"><label>Endereço</label><input id="adminPartnerAddress"></div>
              <div class="field"><label>Mensalidade</label><input id="adminPartnerFee" type="number" min="0" step="0.01" value="125"></div>
              <div class="field"><label>Dia do vencimento</label><input id="adminPartnerDueDay" type="number" min="1" max="28" value="10"></div>
              <div class="field admin-partner-edit-only"><label>Status do parceiro</label><select id="adminPartnerStatus"><option value="pending">Pendente</option><option value="approved">Aprovado</option><option value="blocked">Bloqueado</option><option value="cancelled">Cancelado</option></select></div>
              <div class="field admin-partner-edit-only"><label>Situação do pagamento</label><select id="adminPartnerPaymentStatus"><option value="pending">Pendente</option><option value="paid">Pago</option><option value="overdue">Atrasado</option><option value="free">Cortesia</option><option value="cancelled">Cancelado</option></select></div>
              <div class="field admin-partner-edit-only"><label>Próximo vencimento</label><input id="adminPartnerNextDue" type="date"></div>
              <div class="field full"><label>Observações da cobrança</label><textarea id="adminPartnerBillingNotes" rows="3"></textarea></div>
              <div class="admin-partner-form-note">No cadastro manual, a conta com esse e-mail precisa existir no aplicativo. O administrador nunca precisa saber a senha do parceiro.</div>
              <button id="adminPartnerSaveButton" class="btn btn-primary field full" onclick="saveAdminPartnerForm()">Salvar parceiro</button>
            </div>
          </div>
        </div>
        <div id="adminPartnerPaymentModal" class="modal-backdrop">
          <div class="modal">
            <div class="modal-head"><h3>Registrar pagamento</h3><button class="close" onclick="closeModal('adminPartnerPaymentModal')">✕</button></div>
            <input id="adminPaymentStoreId" type="hidden">
            <div class="form">
              <div class="field full"><label>Parceiro</label><input id="adminPaymentStoreName" disabled></div>
              <div class="field"><label>Valor recebido</label><input id="adminPaymentAmount" type="number" min="0" step="0.01"></div>
              <div class="field"><label>Data do pagamento</label><input id="adminPaymentDate" type="date"></div>
              <div class="field full"><label>Observação</label><textarea id="adminPaymentNote" rows="3" placeholder="Ex.: pagamento via Pix"></textarea></div>
              <button id="adminPaymentSaveButton" class="btn btn-primary field full" onclick="saveAdminPartnerPayment()">Confirmar pagamento</button>
            </div>
          </div>
        </div>`;
      document.body.append(...wrapper.children);
    }
  }

  async function fetchAdminPartnerData() {
    const { data, error } = await onlineClient.rpc('admin_partner_panel_city', { p_city: APP_CITY });
    if (error) throw error;
    const cityPartners = (Array.isArray(data?.partners) ? data.partners : []).filter(row => cityMatches(row.city));
    const cityPartnerIds = new Set(cityPartners.map(row => String(row.id)));
    adminPartnerData = {
      partners: cityPartners,
      requests: (Array.isArray(data?.requests) ? data.requests : []).filter(row => cityMatches(row.city)),
      payments: (Array.isArray(data?.payments) ? data.payments : []).filter(row => cityPartnerIds.has(String(row.store_id)))
    };
    if (adminManagedStore) {
      adminManagedStore = adminPartnerData.partners.find(row => String(row.id) === String(adminManagedStore.id)) || adminManagedStore;
    }
    return adminPartnerData;
  }

  async function loadAdminPartnersPanel() {
    const c = document.getElementById('accountContent');
    if (!isAdmin()) {
      c.innerHTML = '<h2>Gestão de parceiros</h2><div class="empty">Esta área é exclusiva da conta administradora.</div>';
      return;
    }
    c.innerHTML = '<div class="admin-loading">Carregando parceiros, solicitações e cobranças...</div>';
    try {
      await fetchAdminPartnerData();
      renderAdminPartnersPanel();
    } catch (error) {
      c.innerHTML = `<div class="section-head"><div><h2>Gestão de parceiros</h2><div class="section-sub">Não foi possível abrir o painel.</div></div></div><div class="empty">${esc(normalizeError(error))}<br><br>Execute o arquivo ETAPA-ITAIBA-V2-ATIVAR-E-SEPARAR.sql no Supabase.</div>`;
    }
  }

  window.loadAdminPartnersPanel = loadAdminPartnersPanel;

  function adminPartnerStats() {
    const partners = adminPartnerData.partners || [];
    const approved = partners.filter(row => row.partner_status === 'approved');
    const overdue = partners.filter(row => row.payment_status === 'overdue');
    return {
      total: partners.length,
      active: approved.length,
      pending: (adminPartnerData.requests || []).length + partners.filter(row => row.partner_status === 'pending').length,
      overdue: overdue.length,
      revenue: approved.reduce((sum,row) => sum + Number(row.monthly_fee || 0),0)
    };
  }

  function filteredAdminPartners() {
    const q = adminPartnerSearch.trim().toLowerCase();
    return (adminPartnerData.partners || []).filter(row => {
      const text = [row.store_name,row.responsible_name,row.email,row.whatsapp,row.category,row.address].join(' ').toLowerCase();
      return (!q || text.includes(q)) && (!adminPartnerStatusFilter || row.partner_status === adminPartnerStatusFilter) && (!adminPartnerPaymentFilter || row.payment_status === adminPartnerPaymentFilter);
    });
  }

  function adminPartnerToolbar() {
    return `<div class="admin-partner-toolbar"><input id="adminPartnerSearch" value="${esc(adminPartnerSearch)}" placeholder="Buscar por loja, responsável, e-mail ou segmento" oninput="filterAdminPartnerPanel()"><select id="adminPartnerStatusFilter" onchange="filterAdminPartnerPanel()"><option value="">Todos os status</option><option value="pending" ${adminPartnerStatusFilter==='pending'?'selected':''}>Pendentes</option><option value="approved" ${adminPartnerStatusFilter==='approved'?'selected':''}>Aprovados</option><option value="blocked" ${adminPartnerStatusFilter==='blocked'?'selected':''}>Bloqueados</option><option value="cancelled" ${adminPartnerStatusFilter==='cancelled'?'selected':''}>Cancelados</option></select><select id="adminPartnerPaymentFilter" onchange="filterAdminPartnerPanel()"><option value="">Todos os pagamentos</option><option value="paid" ${adminPartnerPaymentFilter==='paid'?'selected':''}>Pagos</option><option value="pending" ${adminPartnerPaymentFilter==='pending'?'selected':''}>Pendentes</option><option value="overdue" ${adminPartnerPaymentFilter==='overdue'?'selected':''}>Atrasados</option><option value="free" ${adminPartnerPaymentFilter==='free'?'selected':''}>Cortesia</option></select></div>`;
  }

  function adminPartnersTable(rows, finance = false) {
    if (!rows.length) return '<div class="admin-partner-empty">Nenhum parceiro encontrado com os filtros informados.</div>';
    return `<div class="admin-partner-table-wrap"><table class="admin-partner-table"><thead><tr><th>Parceiro</th><th>Segmento</th><th>Mensalidade</th><th>Status</th><th>Pagamento</th><th>Vencimento</th><th>Produtos</th><th>Ações</th></tr></thead><tbody>${rows.map(row => `<tr><td><div class="admin-partner-store"><b>${esc(row.store_name)}</b><small>${esc(row.responsible_name || 'Responsável não informado')} • ${esc(row.whatsapp || row.email || 'Sem contato')}</small></div></td><td>${esc(row.category || 'Outros')}</td><td><b>${money(Number(row.monthly_fee || 0))}</b></td><td>${partnerBadge(row.partner_status)}</td><td>${partnerBadge(row.payment_status,'payment')}</td><td>${partnerDate(row.next_due_date)}</td><td>${Number(row.products_count || 0)}</td><td><div class="admin-partner-row-actions"><button class="btn btn-primary" onclick="enterAdminPartnerStore('${row.id}')">Gerenciar loja</button>${finance ? `<button class="btn btn-primary" onclick="openAdminPartnerPayment('${row.id}')">Registrar pagamento</button>` : `<button class="btn btn-soft" onclick="openAdminPartnerForm('${row.id}')">Editar</button><button class="btn ${row.partner_status==='blocked'?'btn-primary':'btn-danger'}" onclick="quickAdminPartnerStatus('${row.id}','${row.partner_status==='blocked'?'approved':'blocked'}')">${row.partner_status==='blocked'?'Desbloquear':'Bloquear'}</button><button class="btn btn-danger" onclick="deleteAdminPartner('${row.id}')">Excluir</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderAdminPartnersPanel() {
    const c = document.getElementById('accountContent');
    const stats = adminPartnerStats();
    const tabs = `<div class="admin-partner-tabs"><button class="admin-partner-tab ${adminPartnerTab==='partners'?'active':''}" onclick="setAdminPartnerTab('partners')">Parceiros (${adminPartnerData.partners.length})</button><button class="admin-partner-tab ${adminPartnerTab==='requests'?'active':''}" onclick="setAdminPartnerTab('requests')">Solicitações (${adminPartnerData.requests.length})</button><button class="admin-partner-tab ${adminPartnerTab==='finance'?'active':''}" onclick="setAdminPartnerTab('finance')">Financeiro</button></div>`;
    let body = '';
    if (adminPartnerTab === 'requests') {
      body = adminPartnerData.requests.length ? `<div class="admin-partner-request-list">${adminPartnerData.requests.map(row => `<article class="admin-partner-request"><div><b>${esc(row.store_name)}</b><p>Responsável: ${esc(row.responsible_name || 'Não informado')}<br>${esc(row.category || 'Outros')} • ${esc(row.whatsapp || 'Sem WhatsApp')}<br>${esc(row.email || '')} ${row.address ? '• ' + esc(row.address) : ''}<br>Solicitado em ${partnerDate(row.created_at)}.</p></div><div class="admin-partner-row-actions"><button class="btn btn-danger" onclick="rejectAdminPartnerRequest('${row.id}')">Recusar</button><button class="btn btn-primary" onclick="approveAdminPartnerRequest('${row.id}')">Aprovar por ${money(Number(row.monthly_fee || 125))}</button></div></article>`).join('')}</div>` : '<div class="admin-partner-empty">Nenhuma solicitação aguardando aprovação.</div>';
    } else if (adminPartnerTab === 'finance') {
      body = adminPartnerToolbar() + adminPartnersTable(filteredAdminPartners(), true);
    } else {
      body = adminPartnerToolbar() + adminPartnersTable(filteredAdminPartners(), false);
    }
    c.innerHTML = `<div class="admin-partner-head"><div><h2>Gestão de parceiros</h2><div class="section-sub">Aprove contas, controle mensalidades e entre nas lojas sem usar a senha do parceiro.</div></div><div class="admin-partner-actions"><button class="btn btn-soft" onclick="loadAdminPartnersPanel()">↻ Atualizar</button><button class="btn btn-primary" onclick="openAdminPartnerForm()">＋ Cadastrar parceiro</button></div></div><div class="admin-partner-metrics"><div class="admin-partner-metric"><small>Total de parceiros</small><b>${stats.total}</b></div><div class="admin-partner-metric"><small>Parceiros ativos</small><b>${stats.active}</b></div><div class="admin-partner-metric"><small>Pendentes</small><b>${stats.pending}</b></div><div class="admin-partner-metric"><small>Mensalidades atrasadas</small><b>${stats.overdue}</b></div><div class="admin-partner-metric"><small>Receita mensal prevista</small><b>${money(stats.revenue)}</b></div></div>${tabs}${body}`;
  }

  window.setAdminPartnerTab = function (tab) {
    adminPartnerTab = tab;
    renderAdminPartnersPanel();
  };

  window.filterAdminPartnerPanel = function () {
    adminPartnerSearch = document.getElementById('adminPartnerSearch')?.value || '';
    adminPartnerStatusFilter = document.getElementById('adminPartnerStatusFilter')?.value || '';
    adminPartnerPaymentFilter = document.getElementById('adminPartnerPaymentFilter')?.value || '';
    renderAdminPartnersPanel();
    const input = document.getElementById('adminPartnerSearch');
    if (input) { input.focus(); input.setSelectionRange(input.value.length,input.value.length); }
  };

  window.openAdminPartnerForm = function (storeId = '') {
    ensureAdminPartnerModals();
    const row = storeId ? adminPartnerData.partners.find(item => String(item.id) === String(storeId)) : null;
    document.getElementById('adminPartnerModalTitle').textContent = row ? 'Editar parceiro' : 'Cadastrar parceiro';
    document.getElementById('adminPartnerStoreId').value = row?.id || '';
    document.getElementById('adminPartnerEmail').value = row?.email || '';
    document.getElementById('adminPartnerEmailField').querySelector('label').textContent = row ? 'E-mail de contato' : 'E-mail da conta *';
    document.getElementById('adminPartnerStoreName').value = row?.store_name || '';
    document.getElementById('adminPartnerResponsible').value = row?.responsible_name || '';
    document.getElementById('adminPartnerWhatsapp').value = row?.whatsapp || '';
    const category = document.getElementById('adminPartnerCategory');
    if (row?.category && ![...category.options].some(option => option.value === row.category)) category.add(new Option(row.category,row.category));
    category.value = row?.category || 'Outros';
    document.getElementById('adminPartnerAddress').value = row?.address || '';
    document.getElementById('adminPartnerFee').value = Number(row?.monthly_fee ?? 125);
    document.getElementById('adminPartnerDueDay').value = Number(row?.due_day ?? 10);
    document.getElementById('adminPartnerStatus').value = row?.partner_status || 'approved';
    document.getElementById('adminPartnerPaymentStatus').value = row?.payment_status || 'pending';
    document.getElementById('adminPartnerNextDue').value = row?.next_due_date ? String(row.next_due_date).slice(0,10) : '';
    document.getElementById('adminPartnerBillingNotes').value = row?.billing_notes || '';
    document.querySelectorAll('#adminPartnerModal .admin-partner-edit-only').forEach(el => el.style.display = row ? '' : 'none');
    document.getElementById('adminPartnerSaveButton').textContent = row ? 'Salvar alterações' : 'Cadastrar parceiro';
    openModal('adminPartnerModal');
  };

  window.saveAdminPartnerForm = async function () {
    const button = document.getElementById('adminPartnerSaveButton');
    const storeId = document.getElementById('adminPartnerStoreId').value;
    const storeName = document.getElementById('adminPartnerStoreName').value.trim();
    const email = document.getElementById('adminPartnerEmail').value.trim();
    if (!storeName || (!storeId && !email)) return toast('Informe o nome da loja e o e-mail da conta.');
    setBusy(button,true,'Salvando...');
    try {
      let result;
      if (storeId) {
        result = await onlineClient.rpc('admin_update_partner', {
          p_store_id: storeId,
          p_store_name: storeName,
          p_responsible_name: document.getElementById('adminPartnerResponsible').value.trim() || null,
          p_whatsapp: document.getElementById('adminPartnerWhatsapp').value.trim() || null,
          p_contact_email: email || null,
          p_category: document.getElementById('adminPartnerCategory').value,
          p_address: document.getElementById('adminPartnerAddress').value.trim() || null,
          p_partner_status: document.getElementById('adminPartnerStatus').value,
          p_monthly_fee: Number(document.getElementById('adminPartnerFee').value || 0),
          p_due_day: Number(document.getElementById('adminPartnerDueDay').value || 10),
          p_next_due_date: document.getElementById('adminPartnerNextDue').value || null,
          p_payment_status: document.getElementById('adminPartnerPaymentStatus').value,
          p_billing_notes: document.getElementById('adminPartnerBillingNotes').value.trim() || null
        });
      } else {
        result = await onlineClient.rpc('admin_create_partner_city', {
          p_city: APP_CITY,
          p_email: email,
          p_store_name: storeName,
          p_responsible_name: document.getElementById('adminPartnerResponsible').value.trim() || null,
          p_whatsapp: document.getElementById('adminPartnerWhatsapp').value.trim() || null,
          p_category: document.getElementById('adminPartnerCategory').value,
          p_address: document.getElementById('adminPartnerAddress').value.trim() || null,
          p_monthly_fee: Number(document.getElementById('adminPartnerFee').value || 125),
          p_due_day: Number(document.getElementById('adminPartnerDueDay').value || 10),
          p_billing_notes: document.getElementById('adminPartnerBillingNotes').value.trim() || null
        });
      }
      if (result.error) throw result.error;
      closeModal('adminPartnerModal');
      await fetchAdminPartnerData();
      await loadPublicData();
      renderHome();
      renderAdminPartnersPanel();
      toast(storeId ? 'Parceiro atualizado. Você continua no painel.' : 'Parceiro cadastrado e loja vinculada à conta.');
    } catch (error) {
      toast(normalizeError(error));
    } finally {
      setBusy(button,false);
    }
  };

  window.quickAdminPartnerStatus = async function (storeId, status) {
    const row = adminPartnerData.partners.find(item => String(item.id) === String(storeId));
    if (!row) return;
    const message = status === 'blocked' ? `Bloquear a loja ${row.store_name}?` : `Desbloquear a loja ${row.store_name}?`;
    if (!confirm(message)) return;
    try {
      const { error } = await onlineClient.rpc('admin_set_partner_status',{ p_store_id:storeId,p_partner_status:status });
      if (error) throw error;
      await fetchAdminPartnerData();
      await loadPublicData();
      renderHome();
      renderAdminPartnersPanel();
      toast(status === 'blocked' ? 'Parceiro bloqueado.' : 'Parceiro desbloqueado.');
    } catch (error) { toast(normalizeError(error)); }
  };

  window.deleteAdminPartner = async function (storeId) {
    if (!isAdmin()) return;
    const row = adminPartnerData.partners.find(item => String(item.id) === String(storeId));
    if (!row) return;
    const accepted = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
      overlay.innerHTML = '<div role="alertdialog" aria-modal="true" aria-labelledby="partnerDeleteTitle" style="background:#fff;color:#17324d;border-radius:18px;padding:24px;width:100%;max-width:380px;box-shadow:0 16px 48px #0003"><h3 id="partnerDeleteTitle" style="margin:0 0 12px;color:#0D47A1">Excluir parceiro?</h3><p style="margin:0 0 10px">Deseja excluir este parceiro?</p><strong data-store></strong><p style="font-size:14px;margin:12px 0 20px">A loja será removida e o responsável continuará com sua conta de cliente.</p><div style="display:flex;gap:12px"><button type="button" data-no class="btn btn-soft" style="flex:1">Não</button><button type="button" data-yes class="btn btn-danger" style="flex:1;background:#b91c1c;color:white">Sim, excluir</button></div></div>';
      overlay.querySelector('[data-store]').textContent = row.store_name;
      const finish = value => { overlay.remove(); resolve(value); };
      overlay.querySelector('[data-no]').onclick = () => finish(false);
      overlay.querySelector('[data-yes]').onclick = () => finish(true);
      document.body.appendChild(overlay);
      overlay.querySelector('[data-no]').focus();
    });
    if (!accepted) return;
    const name = row.store_name;
    try {
      const { data, error } = await onlineClient.rpc('admin_delete_store_v72', {p_store_id:storeId,p_confirmation_name:name});
      if (error) throw error;
      if (data !== true) throw new Error('Exclusão não confirmada pelo servidor.');
      await fetchAdminPartnerData();
      await loadPublicData();
      renderHome();
      renderAdminPartnersPanel();
      toast('Parceiro excluído.');
    } catch (error) { toast(normalizeError(error)); }
  };

  window.approveAdminPartnerRequest = async function (requestId) {
    const row = adminPartnerData.requests.find(item => String(item.id) === String(requestId));
    if (!row) return;
    if (!confirm(`Aprovar ${row.store_name} com mensalidade de ${money(Number(row.monthly_fee || 125))}?`)) return;
    try {
      const { error } = await onlineClient.rpc('admin_approve_partner_request_city',{
        p_city:APP_CITY,
        p_request_id:requestId,
        p_monthly_fee:Number(row.monthly_fee || 125),
        p_due_day:Number(row.due_day || 10),
        p_admin_note:null
      });
      if (error) throw error;
      await fetchAdminPartnerData();
      await loadPublicData();
      renderHome();
      renderAdminPartnersPanel();
      toast('Solicitação aprovada e loja criada.');
    } catch (error) { toast(normalizeError(error)); }
  };

  window.rejectAdminPartnerRequest = async function (requestId) {
    if (!confirm('Recusar esta solicitação de parceria?')) return;
    const note = prompt('Observação opcional para a recusa:') || null;
    try {
      const { error } = await onlineClient.rpc('admin_reject_partner_request',{ p_request_id:requestId,p_admin_note:note });
      if (error) throw error;
      await fetchAdminPartnerData();
      renderAdminPartnersPanel();
      toast('Solicitação recusada.');
    } catch (error) { toast(normalizeError(error)); }
  };

  window.openAdminPartnerPayment = function (storeId) {
    ensureAdminPartnerModals();
    const row = adminPartnerData.partners.find(item => String(item.id) === String(storeId));
    if (!row) return toast('Parceiro não encontrado.');
    document.getElementById('adminPaymentStoreId').value = row.id;
    document.getElementById('adminPaymentStoreName').value = row.store_name;
    document.getElementById('adminPaymentAmount').value = Number(row.monthly_fee || 0);
    document.getElementById('adminPaymentDate').value = new Date().toISOString().slice(0,10);
    document.getElementById('adminPaymentNote').value = '';
    openModal('adminPartnerPaymentModal');
  };

  window.saveAdminPartnerPayment = async function () {
    const button = document.getElementById('adminPaymentSaveButton');
    const storeId = document.getElementById('adminPaymentStoreId').value;
    setBusy(button,true,'Registrando...');
    try {
      const { error } = await onlineClient.rpc('admin_register_partner_payment',{
        p_store_id:storeId,
        p_amount:Number(document.getElementById('adminPaymentAmount').value || 0),
        p_paid_date:document.getElementById('adminPaymentDate').value || new Date().toISOString().slice(0,10),
        p_note:document.getElementById('adminPaymentNote').value.trim() || null
      });
      if (error) throw error;
      closeModal('adminPartnerPaymentModal');
      await fetchAdminPartnerData();
      renderAdminPartnersPanel();
      toast('Pagamento registrado e vencimento renovado.');
    } catch (error) { toast(normalizeError(error)); }
    finally { setBusy(button,false); }
  };

  window.enterAdminPartnerStore = function (storeId) {
    const row = adminPartnerData.partners.find(item => String(item.id) === String(storeId));
    if (!row) return toast('Parceiro não encontrado.');
    adminManagedStore = row;
    rememberAccountPanel('adminStore');
    showAccountPanel('adminStore',document.getElementById('adminPartnersButton'));
    window.scrollTo({top:0,behavior:'smooth'});
  };

  window.leaveAdminPartnerStore = async function () {
    adminManagedStore = null;
    rememberAccountPanel('adminPartners');
    showAccountPanel('adminPartners',document.getElementById('adminPartnersButton'));
  };

  function renderAdminManagedStorePanel() {
    const c = document.getElementById('accountContent');
    if (!adminManagedStore) {
      loadAdminPartnersPanel();
      return;
    }
    const products = managedProductList();
    adminManagedStore.products_count = products.length;
    const cards = products.map(product => {
      const dl = deliveryLabel(product);
      const media = normalizeRemoteMediaList(product.mediaId,null);
      const firstImage = media[0] || '';
      return `<article class="product-manage-card"><div class="product-manage-top"><div class="product-manage-thumb">${firstImage?`<img src="${esc(firstImage)}" alt="${esc(product.name)}" loading="lazy">`:(product.icon||'📦')}</div><div class="product-manage-info"><h3>${esc(product.name)}</h3><p>${esc(adminManagedStore.store_name)} • ${esc(product.category)}</p></div></div><div class="product-manage-prices"><strong>${money(product.price)}</strong>${Number(product.oldPrice||0)>Number(product.price||0)?`<del>${money(product.oldPrice)}</del>`:''}</div><div class="product-manage-meta"><span>${product.available===false?'Esgotado':'Disponível'}</span><span>Estoque: ${Number(product.stock||0)}</span>${productVariantSummary(product)?`<span>Opções: ${esc(productVariantSummary(product))}</span>`:''}<span>${dl.icon} ${dl.text}</span></div><div class="product-manage-actions"><button class="btn btn-soft" onclick="openEditProduct('${product.id}')">✏️ Editar</button><button class="btn btn-danger" onclick="deletePartnerProduct('${product.id}')">🗑️ Apagar</button></div></article>`;
    }).join('');
    c.innerHTML = `<div class="admin-managed-banner"><div><h2>Administrando: ${esc(adminManagedStore.store_name)}</h2><p>Todos os produtos cadastrados aqui permanecem vinculados a esta loja. A senha do parceiro não é utilizada.</p></div><button class="btn btn-soft" onclick="leaveAdminPartnerStore()">← Voltar aos parceiros</button></div><div class="admin-partner-metrics"><div class="admin-partner-metric"><small>Produtos</small><b>${products.length}</b></div><div class="admin-partner-metric"><small>Status da parceria</small><b style="font-size:16px">${esc(partnerStatusLabel(adminManagedStore.partner_status))}</b></div><div class="admin-partner-metric"><small>Mensalidade</small><b style="font-size:18px">${money(Number(adminManagedStore.monthly_fee||0))}</b></div><div class="admin-partner-metric"><small>Próximo vencimento</small><b style="font-size:16px">${partnerDate(adminManagedStore.next_due_date)}</b></div><div class="admin-partner-metric"><small>Pagamento</small><b style="font-size:16px">${esc(paymentStatusLabel(adminManagedStore.payment_status))}</b></div></div><div class="admin-managed-products-head"><div><h3>Produtos da loja</h3><div class="section-sub">Cadastre, edite preços, estoque, descrições e fotos sem sair desta área.</div></div><div class="admin-partner-actions"><button class="btn btn-soft" onclick="openAdminPartnerForm('${adminManagedStore.id}')">Editar parceiro</button>${isFarmaciaSaoSebastiaoStore(adminManagedStore)?'<button id="adminPharmacyImportButton" class="btn btn-primary" onclick="importFarmaciaSaoSebastiaoProducts()">📦 Importar produtos da farmácia</button>':''}${isBoiBomStore(adminManagedStore)?'<button id="adminBoiBomTangImportButton" class="btn btn-primary" onclick="importBoiBomTangProducts()">🥤 Adicionar 9 sabores Tang</button>':''}<button class="btn btn-primary" onclick="openNewProductModal()">＋ Cadastrar produto</button></div></div><div class="products-manage-help">Depois de salvar ou apagar um produto, você continuará nesta mesma loja.</div><div class="products-manage-list">${cards || '<div class="empty">Nenhum produto cadastrado nesta loja.</div>'}</div>`;
  }


  function normalizePharmacyImportText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function isFarmaciaSaoSebastiaoStore(store = adminManagedStore) {
    const name = normalizePharmacyImportText(store?.store_name || store?.name || '');
    return name.includes('farmacia sao sebastiao') || name === 'sao sebastiao' || name.includes('sao sebastiao farmacia');
  }

  function isBoiBomStore(store = adminManagedStore) {
    const name = normalizePharmacyImportText(store?.store_name || store?.name || '');
    return name.includes('frigorifico boi bom') || name.includes('boi bom') || name.includes('frigorifico boibom') || name.includes('boibom');
  }


  function farmaciaImportTargetStore() {
    if (isAdmin() && adminManagedStore && isFarmaciaSaoSebastiaoStore(adminManagedStore)) {
      return { id: adminManagedStore.id, name: adminManagedStore.store_name || 'Farmácia São Sebastião', mode: 'admin' };
    }
    if (isPartner() && onlineStore && ownStoreApproved() && isFarmaciaSaoSebastiaoStore(onlineStore)) {
      return { id: onlineStore.id, name: onlineStore.name || 'Farmácia São Sebastião', mode: 'partner' };
    }
    return null;
  }

  function pharmacyImportSlug(value) {
    return normalizePharmacyImportText(value).replace(/\s+/g, '-').slice(0, 70) || 'produto';
  }

  async function pharmacyImportImage(dataUrl, productName, imageIndex) {
    if (!dataUrl) throw new Error('Uma das fotos preparadas não foi encontrada.');
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('Não foi possível preparar uma das fotos.');
    const blob = await response.blob();
    const path = `${currentUserId()}/farmacia-sao-sebastiao/${pharmacyImportSlug(productName)}-${imageIndex + 1}.webp`;
    const { error } = await onlineClient.storage.from('public-media').upload(path, blob, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'image/webp'
    });
    if (error) throw error;
    return onlineClient.storage.from('public-media').getPublicUrl(path).data.publicUrl;
  }

  window.importFarmaciaSaoSebastiaoProducts = async function () {
    const targetStore = farmaciaImportTargetStore();
    if (!targetStore) return toast('Abra a Farmácia São Sebastião com uma conta autorizada.');
    const bundle = window.FARMACIA_SAO_SEBASTIAO_IMPORT;
    if (!bundle?.products?.length) {
      alert('O arquivo farmacia-sao-sebastiao-produtos.js não foi carregado. Envie esse arquivo novamente para a pasta principal do GitHub.');
      return;
    }
    const total = bundle.products.length;
    if (!confirm(`Importar ${total} produtos para a Farmácia São Sebastião?\n\nOs produtos serão criados primeiro. Depois o sistema tentará anexar as fotos.`)) return;

    const button = document.getElementById('adminPharmacyImportButton') || document.getElementById('partnerPharmacyImportButton');
    const originalText = button?.textContent || '📦 Adicionar produtos da farmácia';
    if (button) { button.disabled = true; button.textContent = `Preparando ${total} produtos...`; }

    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    let photosOk = 0;
    let photosFailed = 0;
    const failures = [];
    try {
      const storeId = targetStore.id;
      const [existingResult, categoryResult] = await Promise.all([
        onlineClient.from('products').select('id,name').eq('store_id', storeId),
        onlineClient.from('categories').select('id,name,slug').eq('active', true)
      ]);
      if (existingResult.error) throw existingResult.error;
      if (categoryResult.error) console.warn('Não foi possível carregar categorias:', categoryResult.error);

      const existing = new Map((existingResult.data || []).map(item => [normalizePharmacyImportText(item.name), item.id]));
      const categories = categoryResult.data || [];
      const pharmacyCategory = categories.find(item => normalizePharmacyImportText(item.name) === 'farmacia' || normalizePharmacyImportText(item.slug) === 'farmacia')
        || categories.find(item => normalizePharmacyImportText(item.name).includes('perfumaria'))
        || null;

      for (let index = 0; index < bundle.products.length; index++) {
        const product = bundle.products[index];
        if (button) button.textContent = `Criando ${index + 1} de ${total}...`;
        const normalizedName = normalizePharmacyImportText(product.name);
        if (existing.has(normalizedName)) { skipped++; continue; }

        try {
          const isDiaper = product.variation_type === 'diapers';
          const labels = ['RN','RN+','P','M','G','GG','XG','XXG','XXXG'];
          const variants = isDiaper ? labels.map(label => ({ label, stock: 100, active: true })) : [];
          const payload = {
            store_id: storeId,
            category_id: pharmacyCategory?.id || null,
            name: product.name,
            description: isDiaper
              ? 'Fralda cadastrada com todos os tamanhos marcados inicialmente e 100 unidades em cada tamanho. Desmarque os tamanhos indisponíveis, ajuste o preço e depois marque como disponível.'
              : 'Produto cadastrado com estoque inicial de 100 unidades. Ajuste o preço e depois marque como disponível.',
            price: 0.01,
            promotional_price: null,
            image_url: null,
            image_urls: [],
            stock_quantity: isDiaper ? variants.reduce((sum, item) => sum + item.stock, 0) : 100,
            available: false,
            sponsored: false,
            variation_type: isDiaper ? 'diapers' : 'none',
            variants,
            food_section: null,
            preparation_minutes: null,
            serves: null,
            delivery_type: null,
            delivery_fee: null
          };

          const insertResult = await onlineClient.from('products').insert(payload).select('id').single();
          if (insertResult.error) throw insertResult.error;
          const productId = insertResult.data?.id;
          existing.set(normalizedName, productId);
          inserted++;

          // A foto é uma segunda etapa. Se falhar, o produto continua cadastrado.
          if (productId && bundle.images && Array.isArray(product.images) && product.images.length) {
            try {
              if (button) button.textContent = `Fotos ${index + 1} de ${total}...`;
              const imageUrls = [];
              for (let imageIndex = 0; imageIndex < product.images.length; imageIndex++) {
                const dataUrl = bundle.images[product.images[imageIndex]];
                if (!dataUrl) continue;
                imageUrls.push(await pharmacyImportImage(dataUrl, product.name, imageIndex));
              }
              if (imageUrls.length) {
                const updateResult = await onlineClient.from('products').update({
                  image_url: imageUrls[0],
                  image_urls: imageUrls
                }).eq('id', productId).eq('store_id', storeId);
                if (updateResult.error) throw updateResult.error;
                photosOk++;
              }
            } catch (photoError) {
              photosFailed++;
              console.error('Produto criado, mas a foto falhou:', product.name, photoError);
            }
          }
        } catch (error) {
          failed++;
          failures.push(`${product.name}: ${normalizeError(error)}`);
          console.error('Falha ao criar produto', product.name, error);
        }
      }

      if (targetStore.mode === 'admin') {
        await refreshAdminManagedStoreAfterProductChange();
      } else {
        await loadPublicData();
        returnToProductsPanelAfterSave();
      }
      const summary = `Importação concluída. Produtos criados: ${inserted}. Já existentes: ${skipped}. Falhas: ${failed}. Fotos anexadas: ${photosOk}. Fotos que falharam: ${photosFailed}.`;
      toast(summary);
      alert(summary + (failures.length ? `\n\nPrimeiras falhas:\n${failures.slice(0, 5).join('\n')}` : '\n\nOs produtos foram criados. Ajuste os preços e marque-os como disponíveis.'));
    } catch (error) {
      console.error(error);
      const message = normalizeError(error);
      toast(message);
      alert('Não foi possível iniciar a importação.\n\n' + message + '\n\nConfirme se as ETAPAS 20 e 22 foram executadas no Supabase.');
    } finally {
      const freshButton = document.getElementById('adminPharmacyImportButton') || document.getElementById('partnerPharmacyImportButton');
      if (freshButton) { freshButton.disabled = false; freshButton.textContent = originalText; }
    }
  };

  function boiBomTangImportTargetStore() {
    if (isAdmin() && adminManagedStore && isBoiBomStore(adminManagedStore)) {
      return { id: adminManagedStore.id, name: adminManagedStore.store_name || 'Frigorífico Boi Bom', mode: 'admin' };
    }
    if (isPartner() && onlineStore && ownStoreApproved() && isBoiBomStore(onlineStore)) {
      return { id: onlineStore.id, name: onlineStore.name || 'Frigorífico Boi Bom', mode: 'partner' };
    }
    return null;
  }

  async function boiBomTangImportImage(dataUrl, productName) {
    if (!dataUrl) throw new Error('A foto preparada não foi encontrada.');
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('Não foi possível preparar a foto.');
    const blob = await response.blob();
    const path = `${currentUserId()}/frigorifico-boi-bom/tang-${pharmacyImportSlug(productName)}.webp`;
    const { error } = await onlineClient.storage.from('public-media').upload(path, blob, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'image/webp'
    });
    if (error) throw error;
    return onlineClient.storage.from('public-media').getPublicUrl(path).data.publicUrl;
  }

  window.importBoiBomTangProducts = async function () {
    const targetStore = boiBomTangImportTargetStore();
    if (!targetStore) return toast('Abra o Frigorífico Boi Bom com uma conta autorizada.');
    const bundle = window.BOI_BOM_TANG_IMPORT;
    if (!bundle?.products?.length) {
      alert('O arquivo boi-bom-tang-produtos.js não foi carregado. Envie esse arquivo novamente para a pasta principal do GitHub.');
      return;
    }
    const total = bundle.products.length;
    if (!confirm(`Adicionar ${total} sabores Tang ao Frigorífico Boi Bom?\n\nPreço: R$ 1,49 por unidade\nEstoque: 100 unidades de cada sabor`)) return;

    const button = document.getElementById('adminBoiBomTangImportButton') || document.getElementById('partnerBoiBomTangImportButton');
    const originalText = button?.textContent || '🥤 Adicionar 9 sabores Tang';
    if (button) { button.disabled = true; button.textContent = `Preparando ${total} produtos...`; }

    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    let photosOk = 0;
    let photosFailed = 0;
    const failures = [];
    try {
      const storeId = targetStore.id;
      const [existingResult, categoryResult] = await Promise.all([
        onlineClient.from('products').select('id,name').eq('store_id', storeId),
        onlineClient.from('categories').select('id,name,slug').eq('active', true)
      ]);
      if (existingResult.error) throw existingResult.error;
      if (categoryResult.error) console.warn('Não foi possível carregar categorias:', categoryResult.error);

      const existing = new Map((existingResult.data || []).map(item => [normalizePharmacyImportText(item.name), item.id]));
      const categories = categoryResult.data || [];
      const marketCategory = categories.find(item => ['supermercado','mercado'].includes(normalizePharmacyImportText(item.slug)))
        || categories.find(item => ['supermercado','mercado'].includes(normalizePharmacyImportText(item.name)))
        || categories.find(item => normalizePharmacyImportText(item.name).includes('alimentos'))
        || null;

      for (let index = 0; index < bundle.products.length; index++) {
        const product = bundle.products[index];
        if (button) button.textContent = `Criando ${index + 1} de ${total}...`;
        const normalizedName = normalizePharmacyImportText(product.name);
        if (existing.has(normalizedName)) { skipped++; continue; }

        try {
          const payload = {
            store_id: storeId,
            category_id: marketCategory?.id || null,
            name: product.name,
            description: 'Refresco em pó Tang, envelope de 18 g. Preço por unidade. Estoque inicial cadastrado com 100 unidades.',
            price: 1.49,
            promotional_price: null,
            image_url: null,
            image_urls: [],
            stock_quantity: 100,
            available: true,
            sponsored: false,
            variation_type: 'none',
            variants: [],
            food_section: null,
            preparation_minutes: null,
            serves: null,
            delivery_type: null,
            delivery_fee: null
          };

          const insertResult = await onlineClient.from('products').insert(payload).select('id').single();
          if (insertResult.error) throw insertResult.error;
          const productId = insertResult.data?.id;
          existing.set(normalizedName, productId);
          inserted++;

          if (productId && bundle.images && product.image) {
            try {
              if (button) button.textContent = `Foto ${index + 1} de ${total}...`;
              const dataUrl = bundle.images[product.image];
              const imageUrl = await boiBomTangImportImage(dataUrl, product.name);
              const updateResult = await onlineClient.from('products').update({
                image_url: imageUrl,
                image_urls: [imageUrl]
              }).eq('id', productId).eq('store_id', storeId);
              if (updateResult.error) throw updateResult.error;
              photosOk++;
            } catch (photoError) {
              photosFailed++;
              console.error('Produto criado, mas a foto falhou:', product.name, photoError);
            }
          }
        } catch (error) {
          failed++;
          failures.push(`${product.name}: ${normalizeError(error)}`);
          console.error('Falha ao criar produto', product.name, error);
        }
      }

      if (targetStore.mode === 'admin') {
        await refreshAdminManagedStoreAfterProductChange();
      } else {
        await loadPublicData();
        returnToProductsPanelAfterSave();
      }
      const summary = `Importação concluída. Produtos criados: ${inserted}. Já existentes: ${skipped}. Falhas: ${failed}. Fotos anexadas: ${photosOk}. Fotos que falharam: ${photosFailed}.`;
      toast(summary);
      alert(summary + (failures.length ? `\n\nPrimeiras falhas:\n${failures.slice(0, 5).join('\n')}` : '\n\nOs sabores Tang estão disponíveis por R$ 1,49, com 100 unidades de cada.'));
    } catch (error) {
      console.error(error);
      const message = normalizeError(error);
      toast(message);
      alert('Não foi possível iniciar a importação.\n\n' + message);
    } finally {
      const freshButton = document.getElementById('adminBoiBomTangImportButton') || document.getElementById('partnerBoiBomTangImportButton');
      if (freshButton) { freshButton.disabled = false; freshButton.textContent = originalText; }
    }
  };

  async function refreshAdminManagedStoreAfterProductChange() {
    await loadPublicData();
    renderHome();
    try { await fetchAdminPartnerData(); } catch (_) {}
    renderAdminManagedStorePanel();
  }

  openEditProduct = async function (id) {
    const product = managedProductList().find(item => String(item.id) === String(id));
    if (!product) return toast('Produto não encontrado.');
    resetProductModal();
    document.getElementById('partnerProductEditId').value = product.id;
    document.getElementById('partnerProductExistingMedia').value = JSON.stringify(normalizeMediaItems(product.mediaId));
    document.getElementById('partnerProductModalTitle').textContent = adminManagedStore ? `Editar produto de ${adminManagedStore.store_name}` : 'Editar produto';
    document.getElementById('partnerProductSubmitBtn').textContent = 'Salvar alterações';
    const deleteButton = document.getElementById('partnerProductDeleteBtn');
    if (deleteButton) deleteButton.style.display = 'inline-flex';
    document.getElementById('partnerProductName').value = product.name || '';
    document.getElementById('partnerProductDescription').value = product.description || '';
    const select = document.getElementById('partnerProductCategory');
    let option = [...select.options].find(item => item.value === product.category || String(product.category).startsWith(item.value));
    if (!option && product.category) { option = new Option(product.category,product.category); select.add(option); }
    if (option) select.value = option.value;
    document.getElementById('partnerFoodSection').value = product.foodSection || 'Lanches';
    document.getElementById('partnerFoodPrepMinutes').value = product.preparationMinutes || '';
    document.getElementById('partnerFoodServes').value = product.serves || '';
    document.getElementById('partnerProductAvailable').value = product.available === false ? 'false' : 'true';
    document.getElementById('partnerProductPrice').value = Number(product.price || 0);
    document.getElementById('partnerProductOldPrice').value = Number(product.oldPrice||0) > Number(product.price||0) ? Number(product.oldPrice) : '';
    document.getElementById('partnerProductStock').value = product.stock ?? 1;
    document.getElementById('partnerProductVariationType').value = productVariantType(product);
    toggleProductVariationFields(normalizeProductVariants(product.variants));
    document.getElementById('partnerStoreName').value = currentProductStore()?.name || currentProductStore()?.store_name || product.store || 'Minha loja';
    const dtype = ['free','paid','pickup','arrange'].includes(product.deliveryType) ? product.deliveryType : 'default';
    document.getElementById('partnerProductDelivery').value = dtype;
    document.getElementById('partnerProductDeliveryFee').value = Number(product.deliveryFee || 0) || '';
    document.getElementById('partnerProductDeliveryArea').value = product.deliveryArea || '';
    if (product.mediaId) {
      document.getElementById('partnerProductPreview').innerHTML = await mediaHTML(product.mediaId,'📦',product.name || 'Produto');
      document.getElementById('partnerProductCurrentMediaNote').textContent = 'Galeria atual carregada. Escolha novas fotos somente para substituir todas.';
    }
    togglePartnerProductDelivery();
    toggleFoodProductFields();
    openModal('partnerProductModal');
  };

  showAccountPanel = function (panel, btn) {
    rememberAccountPanel(panel);
    if (!onlineReady) return localShowAccountPanel(panel, btn);
    document.querySelectorAll('.account-menu button').forEach(b => b.classList.remove('active'));
    if (panel === 'foodSettings') { if (btn) btn.classList.add('active'); renderFoodSettingsPanel(); return; }
    if (btn) btn.classList.add('active');
    const c = document.getElementById('accountContent');
    if (!onlineSession) {
      c.innerHTML = `<h2>Entrar no Tem Aqui</h2><p class="section-sub">Crie uma conta gratuita para anunciar, publicar feedback e conversar com vendedores.</p><div class="quick-actions"><button onclick="openModal('authModal');showAuthTab('login')">Entrar</button><button onclick="openModal('authModal');showAuthTab('signup')">Criar conta</button></div><div class="local-storage"><b>Seus dados locais continuam no aparelho</b><p class="section-sub">Rascunhos e cópias próprias podem continuar armazenados localmente, enquanto a versão pública é sincronizada no Supabase.</p></div>`;
      return;
    }
    if (panel === 'admin') {
      if (!isAdmin()) {
        c.innerHTML = '<h2>Dashboard administrativo</h2><div class="empty">Esta área é exclusiva da conta administradora.</div>';
        return;
      }
      loadAdminDashboard(adminDashboardPeriod);
      return;
    }
    if (panel === 'adminPartners') {
      if (!isAdmin()) {
        c.innerHTML = '<h2>Gestão de parceiros</h2><div class="empty">Esta área é exclusiva da conta administradora.</div>';
        return;
      }
      adminManagedStore = null;
      loadAdminPartnersPanel();
      return;
    }
    if (panel === 'adminStore') {
      if (!isAdmin()) {
        c.innerHTML = '<h2>Gerenciar loja</h2><div class="empty">Esta área é exclusiva da conta administradora.</div>';
        return;
      }
      if (!adminManagedStore) {
        rememberAccountPanel('adminPartners');
        loadAdminPartnersPanel();
        return;
      }
      renderAdminManagedStorePanel();
      return;
    }
    if (panel === 'moderation') {
      renderAdminModerationPanel();
      return;
    }
    if (panel === 'homeAds') {
      renderHomeAdsPanel();
      return;
    }
    if (panel === 'partner') {
      const name = onlineProfile?.nome || userIdentifier();
      if (!isPartner()) {
        const status = onlinePartnerRequest?.status || null;
        c.innerHTML = `<div class="section-head"><div><h2>Minha conta</h2><div class="section-sub">Conectado como ${esc(name)}</div></div><button class="btn btn-soft" onclick="logoutOnline()">Sair</button></div><div class="stats"><div class="stat"><small>Publicações</small><b>${state.ownPosts.length}</b></div><div class="stat"><small>Feira do Troca</small><b>${state.ownSwapAds.length}</b></div><div class="stat"><small>Feira do Gado</small><b>${state.ownCattleAds.length}</b></div><div class="stat"><small>Tipo de conta</small><b style="font-size:16px">Cliente</b></div></div><div class="local-storage"><b>Quero ser parceiro</b>${status ? `<p class="section-sub">Sua solicitação está com o status: <strong>${esc(({pending:'Aguardando aprovação',approved:'Aprovada',rejected:'Recusada'})[status]||status)}</strong>.</p>` : `<p class="section-sub">Preencha os dados do comércio. O plano padrão é de <b>R$ 125,00 por mês</b>.</p><div class="delivery-config"><div class="field"><label>Nome do comércio</label><input id="requestStoreName"></div><div class="field"><label>Nome do responsável</label><input id="requestResponsible" value="${esc(name)}"></div><div class="field"><label>WhatsApp</label><input id="requestWhatsapp"></div><div class="field"><label>Categoria / segmento</label><select id="requestCategory"><option>Mercado</option><option>Food / Delivery</option><option>Moda e Calçados</option><option>Perfumaria e Beleza</option><option>Farmácia</option><option>Eletrônicos</option><option>Frigoríficos e Açougues</option><option>Casa e Decoração</option><option>Automotivo</option><option>Agro e Rural</option><option>Materiais de Construção</option><option>Serviços</option><option>Outros</option></select></div><div class="field full"><label>Endereço</label><input id="requestAddress"></div><div class="form-note field full">Ao enviar, a solicitação ficará pendente até a aprovação do administrador.</div><button class="btn btn-primary field full" onclick="requestPartnership()">Enviar solicitação</button></div>`}<button class="btn btn-soft" onclick="copyMyUserId()">Copiar meu código de usuário</button></div>`;
        return;
      }
      if (!onlineStore) {
        c.innerHTML = `<div class="section-head"><div><h2>Cadastrar meu comércio</h2><div class="section-sub">Sua conta já foi ativada como parceiro.</div></div><button class="btn btn-soft" onclick="logoutOnline()">Sair</button></div><div class="delivery-config"><div class="field"><label>Nome do comércio</label><input id="newStoreName"></div><div class="field"><label>WhatsApp</label><input id="newStoreWhatsapp"></div><div class="field full"><label>Descrição</label><textarea id="newStoreDescription" rows="3"></textarea></div><div class="field"><label>Endereço</label><input id="newStoreAddress"></div><div class="field"><label>Bairro</label><input id="newStoreNeighborhood"></div><button class="btn btn-primary field full" onclick="createStoreOnline()">Cadastrar comércio</button></div>`;
        return;
      }
      const dl = deliveryLabel({ deliveryType: 'default' });
      const ownPartnerStatus = onlineStore.partner_status || (onlineStore.approved ? 'approved' : 'pending');
      c.innerHTML = `<div class="section-head"><div><h2>Painel do Parceiro</h2><div class="section-sub">${esc(onlineStore.name)} • ${esc(partnerStatusLabel(ownPartnerStatus))}</div></div><button class="btn btn-soft" onclick="logoutOnline()">Sair</button></div><div class="stats"><div class="stat"><small>Produtos</small><b>${state.partnerProducts.length}</b><span class="status ${ownPartnerStatus === 'approved' ? 'ok' : 'warn'}">${esc(partnerStatusLabel(ownPartnerStatus))}</span></div><div class="stat"><small>Publicações</small><b>${state.ownPosts.length}</b></div><div class="stat"><small>Anúncios</small><b>${state.ownSwapAds.length + state.ownCattleAds.length}</b></div><div class="stat"><small>Entrega padrão</small><b style="font-size:16px">${dl.icon} ${dl.text}</b></div></div><div class="quick-actions"><button onclick="openNewProductModal()">▦ Cadastrar produto</button>${isFarmaciaSaoSebastiaoStore(onlineStore)?'<button id="partnerPharmacyImportButton" onclick="importFarmaciaSaoSebastiaoProducts()">📦 Adicionar 49 produtos</button>':''}${isBoiBomStore(onlineStore)?'<button id="partnerBoiBomTangImportButton" onclick="importBoiBomTangProducts()">🥤 Adicionar 9 sabores Tang</button>':''}<button onclick="showAccountPanel('delivery',document.querySelector('[data-account-panel=\"delivery\"]'))">🚚 Configurar entrega</button><button onclick="showAccountPanel('foodSettings',document.querySelector('[data-account-panel=\"foodSettings\"]'))">🍔 Configurar Food</button><button onclick="openAppTools()">↗ Compartilhar aplicativo</button><button onclick="openModal('communityModal')">🎥 Publicar conteúdo</button><button onclick="openModal('cattleModal')">🐂 Feira do Gado</button></div>`;
    } else if (panel === 'profile') {
      const email = onlineSession?.user?.email || '';
      const whatsapp = onlineProfile?.whatsapp || onlineSession?.user?.user_metadata?.whatsapp || '';
      c.innerHTML = `<div class="section-head"><div><h2>Perfil e segurança</h2><div class="section-sub">Atualize seu contato e sua senha sem sair do aplicativo.</div></div><button class="btn btn-soft" onclick="logoutOnline()">Sair</button></div><div class="profile-security-grid"><div class="profile-security-card"><h3>WhatsApp de contato</h3><p>Esse número poderá ser usado em anúncios, pedidos e contato com clientes. O login continua sendo feito pelo e-mail.</p><div class="field"><label>E-mail da conta</label><input value="${esc(email)}" disabled></div><div class="field"><label>WhatsApp com DDD</label><input id="profileWhatsapp" type="tel" inputmode="tel" autocomplete="tel" value="${esc(whatsapp)}" placeholder="(87) 99999-9999"></div><button id="saveWhatsappButton" class="btn btn-primary" onclick="saveProfileWhatsapp()">Salvar WhatsApp</button></div><div class="profile-security-card"><h3>Alterar senha</h3><p>Use pelo menos 8 caracteres. Não compartilhe sua senha com outras pessoas.</p><div class="field"><label>Nova senha</label><input id="newAccountPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Nova senha"></div><div class="field"><label>Confirmar nova senha</label><input id="confirmAccountPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Digite novamente"></div><button id="changePasswordButton" class="btn btn-blue" onclick="changePasswordOnline()">Alterar senha</button></div></div>`;
    } else if (panel === 'products') {
      if (!isPartner() || !onlineStore || !ownStoreApproved()) {
        const status = onlineStore?.partner_status ? partnerStatusLabel(onlineStore.partner_status) : 'Aguardando aprovação';
        c.innerHTML = `<h2>Meus produtos</h2><div class="empty">Esta área está indisponível. Situação da loja: <b>${esc(status)}</b>.</div>`;
        return;
      }
      c.innerHTML = `<div class="section-head"><div><h2>Meus produtos</h2><div class="section-sub">Edite, troque fotos ou apague produtos sem sair desta área.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${isFarmaciaSaoSebastiaoStore(onlineStore)?'<button id="partnerPharmacyImportButton" class="btn btn-primary" onclick="importFarmaciaSaoSebastiaoProducts()">📦 Adicionar 49 produtos</button>':''}${isBoiBomStore(onlineStore)?'<button id="partnerBoiBomTangImportButton" class="btn btn-primary" onclick="importBoiBomTangProducts()">🥤 Adicionar 9 sabores Tang</button>':''}<button class="btn btn-primary" onclick="openNewProductModal()">+ Cadastrar</button></div></div><div class="products-manage-help">Ao salvar uma alteração, esta tela continuará aberta para você editar o próximo produto.</div><div class="products-manage-list">${state.partnerProducts.map(p => { const dl = deliveryLabel(p); const media = normalizeRemoteMediaList(p.mediaId, null); const firstImage = media[0] || ''; return `<article class="product-manage-card"><div class="product-manage-top"><div class="product-manage-thumb">${firstImage ? `<img src="${esc(firstImage)}" alt="${esc(p.name)}" loading="lazy">` : (p.icon || '📦')}</div><div class="product-manage-info"><h3>${esc(p.name)}</h3><p>${esc(p.store)} • ${esc(p.category)}</p></div></div><div class="product-manage-prices"><strong>${money(p.price)}</strong>${Number(p.oldPrice||0)>Number(p.price||0)?`<del>${money(p.oldPrice)}</del>`:''}</div><div class="product-manage-meta"><span>${p.available===false?'Esgotado':'Disponível'}</span><span>Estoque: ${Number(p.stock||0)}</span>${productVariantSummary(p)?`<span>Opções: ${esc(productVariantSummary(p))}</span>`:''}<span>${dl.icon} ${dl.text}</span></div><div class="product-manage-actions"><button type="button" class="btn btn-soft" onclick="openEditProduct('${p.id}')">✏️ Editar</button><button type="button" class="btn btn-danger" onclick="deletePartnerProduct('${p.id}')">🗑️ Apagar</button></div></article>`; }).join('') || '<div class="empty">Nenhum produto cadastrado.</div>'}</div>`;
    } else if (panel === 'delivery') {
      if (!onlineStore) {
        c.innerHTML = '<h2>Entrega e frete</h2><div class="empty">Cadastre uma loja antes de configurar a entrega.</div>';
        return;
      }
      const d = state.partnerDelivery || defaultState.partnerDelivery;
      c.innerHTML = `<h2>Entrega e frete</h2><p class="section-sub">Esta configuração será usada como padrão da loja.</p><div class="delivery-config"><div class="field"><label>Como funciona a entrega?</label><select id="deliveryDefaultType" onchange="toggleDeliveryConfigFields()"><option value="free" ${d.type === 'free' ? 'selected' : ''}>Entrega gratuita</option><option value="paid" ${d.type === 'paid' ? 'selected' : ''}>Entrega com frete</option><option value="pickup" ${d.type === 'pickup' ? 'selected' : ''}>Somente retirada</option><option value="arrange" ${d.type === 'arrange' ? 'selected' : ''}>Entrega a combinar</option></select></div><div class="field ${d.type === 'paid' ? '' : 'hidden-field'}" id="deliveryDefaultFeeField"><label>Valor padrão do frete</label><input id="deliveryDefaultFee" type="number" step="0.01" min="0" value="${Number(d.fee || 0)}"></div><div class="field"><label>Área atendida</label><input id="deliveryDefaultArea" value="${esc(d.area || '')}"></div><div class="field"><label>Prazo estimado</label><input id="deliveryDefaultEstimate" value="${esc(d.estimate || '')}"></div><div class="delivery-preview"><b>Como aparecerá para o cliente</b><div id="deliveryPreviewText" class="delivery-help"></div></div><button class="btn btn-primary field full" onclick="savePartnerDelivery()">Salvar online</button></div>`;
      toggleDeliveryConfigFields();
    } else if (panel === 'posts') {
      c.innerHTML = `<h2>Minhas publicações</h2><p class="section-sub">${state.ownPosts.length} publicação(ões), ${state.ownSwapAds.length} anúncio(s) na Feira do Troca e ${state.ownCattleAds.length} anúncio(s) na Feira do Gado.</p><div class="quick-actions"><button onclick="navigate('community')">Ver Comunidade</button><button onclick="navigate('swap')">Ver Troca</button><button onclick="navigate('cattle')">Ver Gado</button><button onclick="openModal('communityModal')">Criar publicação</button></div>`;
    } else if (panel === 'storage' || panel === 'backup') {
      localShowAccountPanel(panel, btn);
    }
  };

  navigate = function (view) {
    localNavigate(view);
    if (onlineReady) trackAccess('page_view', view);
    if (view === 'account' && onlineSession) {
      const desired = preferredAccountPanel || (isAdmin() ? 'admin' : 'partner');
      setTimeout(() => {
        const button = document.querySelector(`[data-account-panel="${desired}"]`);
        if (button) showAccountPanel(desired, button);
      }, 0);
    }
  };

  function subscribeToMessages() {
    if (realtimeMessagesChannel) onlineClient.removeChannel(realtimeMessagesChannel);
    if (realtimeNotificationsChannel) onlineClient.removeChannel(realtimeNotificationsChannel);
    if (!onlineSession) return;
    realtimeMessagesChannel = onlineClient
      .channel(`messages-${currentUserId()}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, async payload => {
        await loadChats();
        if (currentView === 'chat') renderChats();
      })
      .subscribe();
    realtimeNotificationsChannel = onlineClient
      .channel(`notifications-${currentUserId()}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:`user_id=eq.${currentUserId()}` }, async payload => {
        await loadNotifications();
        if (currentView !== 'chat') showMessageAlert(payload.new?.title || 'Nova mensagem', payload.new?.body || 'Alguém enviou uma mensagem no seu anúncio.');
      })
      .subscribe();
  }

  async function initOnline() {
    if (!cfg.url || !cfg.publishableKey) {
      console.warn('Configuração Supabase ausente.');
      return;
    }
    if (!window.supabase?.createClient) {
      toast('A biblioteca do banco online não carregou. Verifique a internet.');
      return;
    }
    onlineClient = window.temAquiAccessClient || window.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    if (!window.TEM_AQUI_ACCESS_GRANTED) {
      await new Promise(resolve => window.addEventListener('tem-aqui-access-granted', resolve, { once: true }));
    }
    const { data } = await onlineClient.auth.getSession();
    onlineSession = data.session;
    await refreshOnline();
    await trackAccess('app_open', currentView || 'home');
    await startVisitorCounter();
    await trackAccess('page_view', currentView || 'home');
    subscribeToMessages();
    onlineClient.auth.onAuthStateChange(async (_event, session) => {
      onlineSession = session;
      if (!session) {
        await loadCurrentUser();
        updateAuthUI();
        subscribeToMessages();
        return;
      }
      if (!window.TEM_AQUI_ACCESS_GRANTED) return;
      await refreshOnline();
      subscribeToMessages();
      if (session && pendingModalAfterAuth) {
        const next = pendingModalAfterAuth;
        pendingModalAfterAuth = null;
        setTimeout(() => openModal(next), 150);
      }
    });
  }

  async function recordCampaignEvent(campaignId, eventName) {
    if (!onlineClient || !campaignId || !['impression','click'].includes(eventName)) return;
    try { await onlineClient.rpc('record_home_campaign_event', { campaign_uuid:campaignId, event_name:eventName }); } catch (_) {}
  }

  window.temAquiOnline = {
    get client() { return onlineClient; },
    get session() { return onlineSession; },
    refresh: refreshOnline,
    markNotificationsRead,
    trackAccess,
    recordCampaignEvent
  };

  window.addEventListener('load', () => {
    setTimeout(() => initOnline().catch(error => {
      console.error(error);
      toast(normalizeError(error));
    }), 50);
  });
})();
