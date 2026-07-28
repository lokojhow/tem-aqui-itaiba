/* Tem Aqui — V61 cadastro obrigatório, endereço separado e preenchimento por CEP */
(() => {
  'use strict';
  const cfg = window.TEM_AQUI_SUPABASE || {};
  const key = cfg.publishableKey || cfg.anonKey || cfg.key;
  const gate = document.getElementById('mandatoryAccessGate');
  const authArea = document.getElementById('accessAuthArea');
  const completeArea = document.getElementById('accessCompleteArea');
  const statusEl = document.getElementById('accessStatus');
  const cepTimers = {};
  let client = null;
  let checking = false;

  const errorText = error => {
    const msg = error?.message || String(error || 'Erro desconhecido');
    if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
    if (/user already registered/i.test(msg)) return 'Este e-mail já possui uma conta. Use a opção Entrar.';
    if (/email rate limit/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    if (/row-level security|permission denied|not allowed/i.test(msg)) return 'A correção de segurança ainda não foi executada no Supabase.';
    if (/function public\.complete_my_registration_v61|schema cache/i.test(msg)) return 'Execute a Etapa V61 no Supabase e tente novamente.';
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
    if (on) {
      button.dataset.old = button.textContent;
      button.disabled = true;
      button.textContent = text || 'Aguarde...';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.old || button.textContent;
    }
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

  const pendingKey = 'temAquiPendingRegistrationV61';
  const getPending = () => {
    try { return JSON.parse(localStorage.getItem(pendingKey) || 'null'); }
    catch (_) { return null; }
  };
  const setPending = value => {
    try {
      value
        ? localStorage.setItem(pendingKey, JSON.stringify(value))
        : localStorage.removeItem(pendingKey);
    } catch (_) {}
  };

  const validName = value =>
    value.trim().length >= 5 && value.trim().split(/\s+/).length >= 2;

  const cleanCep = value => String(value || '').replace(/\D/g, '').slice(0, 8);
  const formatCep = value => {
    const digits = cleanCep(value);
    return digits.length > 5 ? `${digits.slice(0,5)}-${digits.slice(5)}` : digits;
  };

  const addressIds = prefix => ({
    postalCode: `access${prefix}PostalCode`,
    street: `access${prefix}Street`,
    houseNumber: `access${prefix}Number`,
    complement: `access${prefix}Complement`,
    neighborhood: `access${prefix}Neighborhood`,
    city: `access${prefix}City`,
    state: `access${prefix}State`,
    help: `access${prefix}CepHelp`
  });

  const readValue = id => document.getElementById(id)?.value?.trim() || '';

  const readAddress = prefix => {
    const ids = addressIds(prefix);
    return {
      postalCode: cleanCep(readValue(ids.postalCode)),
      street: readValue(ids.street),
      houseNumber: readValue(ids.houseNumber),
      complement: readValue(ids.complement),
      neighborhood: readValue(ids.neighborhood),
      city: readValue(ids.city),
      state: readValue(ids.state).toUpperCase().slice(0,2)
    };
  };

  const writeValue = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.value = value || '';
  };

  const writeAddress = (prefix, address={}) => {
    const ids = addressIds(prefix);
    writeValue(ids.postalCode, formatCep(address.postalCode || address.postal_code || ''));
    writeValue(ids.street, address.street || '');
    writeValue(ids.houseNumber, address.houseNumber || address.house_number || '');
    writeValue(ids.complement, address.complement || '');
    writeValue(ids.neighborhood, address.neighborhood || '');
    writeValue(ids.city, address.city || '');
    writeValue(ids.state, String(address.state || '').toUpperCase());
  };

  const addressError = address => {
    if (address.postalCode.length !== 8) return 'Informe um CEP com 8 números.';
    if (address.street.trim().length < 3) return 'Informe o nome da rua.';
    if (!address.houseNumber.trim()) return 'Informe o número da casa ou escreva S/N.';
    if (address.city.trim().length < 2) return 'Informe a cidade.';
    if (!/^[A-Z]{2}$/.test(address.state)) return 'Informe a sigla do estado com 2 letras.';
    return '';
  };

  const setCepHelp = (prefix, message, type='') => {
    const help = document.getElementById(addressIds(prefix).help);
    if (!help) return;
    help.textContent = message;
    help.className = `access-field-help ${type}`.trim();
  };

  window.mandatoryFormatCep = (input, prefix) => {
    if (!input) return;
    input.value = formatCep(input.value);
    clearTimeout(cepTimers[prefix]);
    if (cleanCep(input.value).length === 8) {
      cepTimers[prefix] = setTimeout(() => window.mandatoryLookupCep(prefix, true), 350);
    }
  };

  window.mandatoryLookupCep = async (prefix, silent=false) => {
    const ids = addressIds(prefix);
    const input = document.getElementById(ids.postalCode);
    const cep = cleanCep(input?.value);
    if (cep.length !== 8) {
      if (!silent) setCepHelp(prefix, 'Informe os 8 números do CEP.', 'error');
      return false;
    }

    setCepHelp(prefix, 'Consultando o CEP...', '');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Falha na consulta do CEP.');
      const data = await response.json();
      if (data?.erro) {
        setCepHelp(prefix, 'CEP não encontrado. Confira os números ou preencha manualmente.', 'error');
        return false;
      }

      writeValue(ids.street, data.logradouro || readValue(ids.street));
      writeValue(ids.neighborhood, data.bairro || readValue(ids.neighborhood));
      writeValue(ids.city, data.localidade || readValue(ids.city));
      writeValue(ids.state, String(data.uf || readValue(ids.state)).toUpperCase());
      document.getElementById(ids.houseNumber)?.focus();
      setCepHelp(prefix, 'Endereço localizado. Confira os dados e informe o número da casa.', 'ok');
      return true;
    } catch (error) {
      console.warn('Consulta de CEP indisponível:', error);
      setCepHelp(prefix, 'Não foi possível consultar agora. Você pode preencher os campos manualmente.', 'error');
      return false;
    }
  };

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
      client.from('user_private_profiles')
        .select('user_id,email,address,postal_code,street,house_number,complement,neighborhood,city,state,completed_at')
        .eq('user_id', uid)
        .maybeSingle()
    ]);
    if (privateResult.error && !/0 rows|no rows/i.test(privateResult.error.message || '')) {
      throw privateResult.error;
    }
    return {
      profile: profileResult.data || null,
      privateProfile: privateResult.data || null
    };
  }

  function isComplete(registration) {
    const p = registration?.privateProfile;
    return !!(
      registration?.profile?.nome?.trim() &&
      p?.email?.trim() &&
      cleanCep(p?.postal_code).length === 8 &&
      p?.street?.trim() &&
      p?.house_number?.trim() &&
      p?.city?.trim() &&
      /^[A-Za-z]{2}$/.test(p?.state || '') &&
      p?.completed_at
    );
  }

  function showCompletion(session, registration) {
    lock();
    authArea.hidden = true;
    completeArea.hidden = false;

    const pending = getPending();
    const metadata = session.user.user_metadata || {};
    const privateProfile = registration?.privateProfile || {};
    const pendingAddress = pending?.address || {};

    writeValue(
      'accessCompleteName',
      registration?.profile?.nome || pending?.name || metadata.nome || metadata.full_name || ''
    );
    writeValue('accessCompleteEmail', session.user.email || '');
    writeAddress('Complete', {
      postalCode: privateProfile.postal_code || pendingAddress.postalCode,
      street: privateProfile.street || pendingAddress.street,
      houseNumber: privateProfile.house_number || pendingAddress.houseNumber,
      complement: privateProfile.complement || pendingAddress.complement,
      neighborhood: privateProfile.neighborhood || pendingAddress.neighborhood,
      city: privateProfile.city || pendingAddress.city,
      state: privateProfile.state || pendingAddress.state
    });
    writeValue(
      'accessCompleteWhatsapp',
      registration?.profile?.whatsapp || pending?.whatsapp || metadata.whatsapp || ''
    );
    showStatus('Complete os campos do endereço para liberar o aplicativo.', 'info');
  }

  async function completeRegistration(name, address, whatsapp='') {
    const { data, error } = await client.rpc('complete_my_registration_v61', {
      p_full_name: name.trim(),
      p_postal_code: cleanCep(address.postalCode),
      p_street: address.street.trim(),
      p_house_number: address.houseNumber.trim(),
      p_city: address.city.trim(),
      p_state: address.state.trim().toUpperCase(),
      p_neighborhood: address.neighborhood.trim() || null,
      p_complement: address.complement.trim() || null,
      p_whatsapp: whatsapp.trim() || null
    });
    if (error) throw error;

    await client.auth.updateUser({
      data: {
        nome: name.trim(),
        full_name: name.trim(),
        whatsapp: whatsapp.trim() || null
      }
    });
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
        lock();
        authArea.hidden = false;
        completeArea.hidden = true;
        showStatus('Entre ou crie sua conta para acessar.', 'info');
        return;
      }

      const registration = await loadRegistration(session);
      if (!isComplete(registration)) {
        const pending = getPending();
        const pendingAddress = pending?.address || {};
        if (
          pending &&
          pending.email?.toLowerCase() === session.user.email?.toLowerCase() &&
          validName(pending.name || '') &&
          !addressError(pendingAddress)
        ) {
          try {
            await completeRegistration(pending.name, pendingAddress, pending.whatsapp || '');
            const refreshed = await loadRegistration(session);
            if (isComplete(refreshed)) {
              unlock(session, refreshed);
              return;
            }
          } catch (_) {}
        }
        showCompletion(session, registration);
        return;
      }

      unlock(session, registration);
    } catch (error) {
      lock();
      authArea.hidden = false;
      completeArea.hidden = true;
      showStatus(errorText(error), 'error');
    } finally {
      checking = false;
    }
  }

  window.mandatoryLogin = async event => {
    event?.preventDefault?.();
    const button = document.getElementById('accessLoginButton');
    const email = readValue('accessLoginEmail');
    const password = document.getElementById('accessLoginPassword')?.value || '';
    if (!email || !password) return showStatus('Informe o e-mail e a senha.', 'error');

    busy(button, true, 'Entrando...');
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await checkAccess();
    } catch (error) {
      showStatus(errorText(error), 'error');
    } finally {
      busy(button, false);
    }
  };

  window.mandatorySignup = async event => {
    event?.preventDefault?.();
    const button = document.getElementById('accessSignupButton');
    const name = readValue('accessSignupName');
    const email = readValue('accessSignupEmail');
    const address = readAddress('Signup');
    const whatsapp = readValue('accessSignupWhatsapp');
    const password = document.getElementById('accessSignupPassword')?.value || '';
    const confirmation = document.getElementById('accessSignupPasswordConfirm')?.value || '';

    if (!validName(name)) return showStatus('Informe o nome completo, com nome e sobrenome.', 'error');
    if (!email) return showStatus('Informe o e-mail.', 'error');
    const invalidAddress = addressError(address);
    if (invalidAddress) return showStatus(invalidAddress, 'error');
    if (password.length < 8) return showStatus('A senha precisa ter pelo menos 8 caracteres.', 'error');
    if (password !== confirmation) return showStatus('As duas senhas não são iguais.', 'error');

    busy(button, true, 'Criando conta...');
    try {
      setPending({ name, email, address, whatsapp });
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            nome: name,
            full_name: name,
            whatsapp: whatsapp || null
          }
        }
      });
      if (error) throw error;

      if (!data.session) {
        showStatus('Conta criada. Abra o e-mail de confirmação e depois volte para entrar.', 'ok');
        showMandatoryAccessTab('login');
        writeValue('accessLoginEmail', email);
        return;
      }

      await completeRegistration(name, address, whatsapp);
      await checkAccess();
    } catch (error) {
      showStatus(errorText(error), 'error');
    } finally {
      busy(button, false);
    }
  };

  window.mandatoryCompleteRegistration = async event => {
    event?.preventDefault?.();
    const button = document.getElementById('accessCompleteButton');
    const name = readValue('accessCompleteName');
    const address = readAddress('Complete');
    const whatsapp = readValue('accessCompleteWhatsapp');

    if (!validName(name)) return showStatus('Informe o nome completo, com nome e sobrenome.', 'error');
    const invalidAddress = addressError(address);
    if (invalidAddress) return showStatus(invalidAddress, 'error');

    busy(button, true, 'Salvando...');
    try {
      await completeRegistration(name, address, whatsapp);
      await checkAccess();
    } catch (error) {
      showStatus(errorText(error), 'error');
    } finally {
      busy(button, false);
    }
  };

  window.mandatoryLogout = async () => {
    if (client) await client.auth.signOut();
    lock();
    authArea.hidden = false;
    completeArea.hidden = true;
    showMandatoryAccessTab('login');
  };

  async function init() {
    lock();
    if (!cfg.url || !key || !window.supabase?.createClient) {
      showStatus('A configuração do Supabase não foi carregada.', 'error');
      return;
    }

    client = window.supabase.createClient(cfg.url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    window.temAquiAccessClient = client;

    client.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        lock();
        authArea.hidden = false;
        completeArea.hidden = true;
        showMandatoryAccessTab('login');
      }
      setTimeout(() => checkAccess(), 0);
    });

    await checkAccess();
  }

  init().catch(error => showStatus(errorText(error), 'error'));
})();
