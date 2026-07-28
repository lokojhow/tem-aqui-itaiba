/* Tem Aqui — V60 cadastro obrigatório e bloqueio de visitantes */
(() => {
  'use strict';
  const cfg = window.TEM_AQUI_SUPABASE || {};
  const key = cfg.publishableKey || cfg.anonKey || cfg.key;
  const gate = document.getElementById('mandatoryAccessGate');
  const authArea = document.getElementById('accessAuthArea');
  const completeArea = document.getElementById('accessCompleteArea');
  const statusEl = document.getElementById('accessStatus');
  let client = null;
  let checking = false;

  const errorText = error => {
    const msg = error?.message || String(error || 'Erro desconhecido');
    if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
    if (/user already registered/i.test(msg)) return 'Este e-mail já possui uma conta. Use a opção Entrar.';
    if (/email rate limit/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    if (/row-level security|permission denied|not allowed/i.test(msg)) return 'A correção de segurança ainda não foi executada no Supabase.';
    if (/failed to fetch|network/i.test(msg)) return 'Não foi possível conectar. Verifique a internet.';
    return msg;
  };
  const showStatus = (message, type='info') => {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = `access-status ${message ? 'show' : ''} ${type}`;
  };
  const busy = (button, on, text) => {
    if (!button) return;
    if (on) { button.dataset.old = button.textContent; button.disabled = true; button.textContent = text || 'Aguarde...'; }
    else { button.disabled = false; button.textContent = button.dataset.old || button.textContent; }
  };
  const lock = () => {
    document.body.classList.add('auth-locked');
    if (gate) gate.hidden = false;
    window.TEM_AQUI_ACCESS_GRANTED = false;
  };
  const unlock = (session, profile) => {
    window.TEM_AQUI_ACCESS_GRANTED = true;
    window.TEM_AQUI_CURRENT_PRIVATE_PROFILE = profile || null;
    if (gate) gate.hidden = true;
    document.body.classList.remove('auth-locked');
    window.dispatchEvent(new CustomEvent('tem-aqui-access-granted', { detail: { session, profile } }));
  };
  const pendingKey = 'temAquiPendingRegistrationV60';
  const getPending = () => { try { return JSON.parse(localStorage.getItem(pendingKey) || 'null'); } catch (_) { return null; } };
  const setPending = value => { try { value ? localStorage.setItem(pendingKey, JSON.stringify(value)) : localStorage.removeItem(pendingKey); } catch (_) {} };
  const validName = value => value.trim().length >= 5 && value.trim().split(/\s+/).length >= 2;
  const validAddress = value => value.trim().length >= 8;

  window.showMandatoryAccessTab = tab => {
    const login = tab !== 'signup';
    document.getElementById('accessLoginTab')?.classList.toggle('active', login);
    document.getElementById('accessSignupTab')?.classList.toggle('active', !login);
    document.getElementById('accessLoginForm')?.classList.toggle('hidden', !login);
    document.getElementById('accessSignupForm')?.classList.toggle('hidden', login);
    showStatus('');
  };

  async function loadRegistration(session) {
    const uid = session?.user?.id;
    if (!uid) return null;
    const [profileResult, privateResult] = await Promise.all([
      client.from('profiles').select('id,nome,whatsapp').eq('id', uid).maybeSingle(),
      client.from('user_private_profiles').select('user_id,email,address,completed_at').eq('user_id', uid).maybeSingle()
    ]);
    if (privateResult.error && !/0 rows|no rows/i.test(privateResult.error.message || '')) throw privateResult.error;
    return {
      profile: profileResult.data || null,
      privateProfile: privateResult.data || null
    };
  }

  function isComplete(registration) {
    return !!(
      registration?.profile?.nome?.trim() &&
      registration?.privateProfile?.email?.trim() &&
      registration?.privateProfile?.address?.trim() &&
      registration?.privateProfile?.completed_at
    );
  }

  function showCompletion(session, registration) {
    lock();
    authArea.hidden = true;
    completeArea.hidden = false;
    const pending = getPending();
    const metadata = session.user.user_metadata || {};
    document.getElementById('accessCompleteName').value = registration?.profile?.nome || pending?.name || metadata.nome || metadata.full_name || '';
    document.getElementById('accessCompleteEmail').value = session.user.email || '';
    document.getElementById('accessCompleteAddress').value = registration?.privateProfile?.address || pending?.address || '';
    document.getElementById('accessCompleteWhatsapp').value = registration?.profile?.whatsapp || pending?.whatsapp || metadata.whatsapp || '';
    showStatus('Complete o cadastro para liberar o aplicativo.', 'info');
  }

  async function completeRegistration(name, address, whatsapp='') {
    const { data, error } = await client.rpc('complete_my_registration', {
      p_full_name: name.trim(),
      p_address: address.trim(),
      p_whatsapp: whatsapp.trim() || null
    });
    if (error) throw error;
    await client.auth.updateUser({ data: { nome: name.trim(), full_name: name.trim(), whatsapp: whatsapp.trim() || null } });
    setPending(null);
    return data;
  }

  async function checkAccess() {
    if (checking || !client) return;
    checking = true;
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const session = data.session;
      if (!session) {
        lock(); authArea.hidden = false; completeArea.hidden = true;
        showStatus('Entre ou crie sua conta para acessar.', 'info');
        return;
      }
      const registration = await loadRegistration(session);
      if (!isComplete(registration)) {
        const pending = getPending();
        if (pending && pending.email?.toLowerCase() === session.user.email?.toLowerCase() && validName(pending.name || '') && validAddress(pending.address || '')) {
          try {
            await completeRegistration(pending.name, pending.address, pending.whatsapp || '');
            const refreshed = await loadRegistration(session);
            if (isComplete(refreshed)) { unlock(session, refreshed); return; }
          } catch (_) {}
        }
        showCompletion(session, registration);
        return;
      }
      unlock(session, registration);
    } catch (error) {
      lock(); authArea.hidden = false; completeArea.hidden = true;
      showStatus(errorText(error), 'error');
    } finally { checking = false; }
  }

  window.mandatoryLogin = async event => {
    event?.preventDefault?.();
    const button = document.getElementById('accessLoginButton');
    const email = document.getElementById('accessLoginEmail').value.trim();
    const password = document.getElementById('accessLoginPassword').value;
    if (!email || !password) return showStatus('Informe o e-mail e a senha.', 'error');
    busy(button, true, 'Entrando...');
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await checkAccess();
    } catch (error) { showStatus(errorText(error), 'error'); }
    finally { busy(button, false); }
  };

  window.mandatorySignup = async event => {
    event?.preventDefault?.();
    const button = document.getElementById('accessSignupButton');
    const name = document.getElementById('accessSignupName').value.trim();
    const email = document.getElementById('accessSignupEmail').value.trim();
    const address = document.getElementById('accessSignupAddress').value.trim();
    const whatsapp = document.getElementById('accessSignupWhatsapp').value.trim();
    const password = document.getElementById('accessSignupPassword').value;
    const confirmation = document.getElementById('accessSignupPasswordConfirm').value;
    if (!validName(name)) return showStatus('Informe o nome completo, com nome e sobrenome.', 'error');
    if (!email) return showStatus('Informe o e-mail.', 'error');
    if (!validAddress(address)) return showStatus('Informe o endereço completo.', 'error');
    if (password.length < 8) return showStatus('A senha precisa ter pelo menos 8 caracteres.', 'error');
    if (password !== confirmation) return showStatus('As duas senhas não são iguais.', 'error');
    busy(button, true, 'Criando conta...');
    try {
      setPending({ name, email, address, whatsapp });
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { nome: name, full_name: name, whatsapp: whatsapp || null } }
      });
      if (error) throw error;
      if (!data.session) {
        showStatus('Conta criada. Abra o e-mail de confirmação e depois volte para entrar.', 'ok');
        showMandatoryAccessTab('login');
        document.getElementById('accessLoginEmail').value = email;
        return;
      }
      await completeRegistration(name, address, whatsapp);
      await checkAccess();
    } catch (error) { showStatus(errorText(error), 'error'); }
    finally { busy(button, false); }
  };

  window.mandatoryCompleteRegistration = async event => {
    event?.preventDefault?.();
    const button = document.getElementById('accessCompleteButton');
    const name = document.getElementById('accessCompleteName').value.trim();
    const address = document.getElementById('accessCompleteAddress').value.trim();
    const whatsapp = document.getElementById('accessCompleteWhatsapp').value.trim();
    if (!validName(name)) return showStatus('Informe o nome completo, com nome e sobrenome.', 'error');
    if (!validAddress(address)) return showStatus('Informe o endereço completo.', 'error');
    busy(button, true, 'Salvando...');
    try { await completeRegistration(name, address, whatsapp); await checkAccess(); }
    catch (error) { showStatus(errorText(error), 'error'); }
    finally { busy(button, false); }
  };

  window.mandatoryLogout = async () => { if (client) await client.auth.signOut(); lock(); authArea.hidden = false; completeArea.hidden = true; showMandatoryAccessTab('login'); };

  async function init() {
    lock();
    if (!cfg.url || !key || !window.supabase?.createClient) {
      showStatus('A configuração do Supabase não foi carregada.', 'error');
      return;
    }
    client = window.supabase.createClient(cfg.url, key, { auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    window.temAquiAccessClient = client;
    client.auth.onAuthStateChange((_event, session) => {
      if (!session) { lock(); authArea.hidden=false; completeArea.hidden=true; showMandatoryAccessTab('login'); }
      setTimeout(() => checkAccess(), 0);
    });
    await checkAccess();
  }
  init().catch(error => showStatus(errorText(error), 'error'));
})();
