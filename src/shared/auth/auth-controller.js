/**
 * @fileoverview Controller de autenticação compartilhado
 * Módulo compartilhado entre processos.html e projetos.html
 * 
 * Gerencia login, primeiro acesso, recuperação de senha e troca de senha
 */

(function initAuthController(globalScope) {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // RATE LIMITING — reset de senha
  // ══════════════════════════════════════════════════════════════
  // Máx. 3 tentativas por e-mail em janela de 5 min (client-side via localStorage).
  // Retorna null se permitido, ou string de erro se bloqueado.
  function _resetRateLimit(email) {
    const KEY = 'siga_reset_rl';
    const MAX = 3;
    const WINDOW_MS = 5 * 60 * 1000;
    const now = Date.now();
    let rl = {};
    try { rl = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage indisponível */ }
    const attempts = (rl[email] || []).filter(t => now - t < WINDOW_MS);
    if (attempts.length >= MAX) {
      const wait = Math.ceil((WINDOW_MS - (now - attempts[0])) / 1000);
      const mins = Math.floor(wait / 60);
      const secs = wait % 60;
      return `Muitas tentativas. Aguarde ${mins > 0 ? mins + ' min ' : ''}${secs}s antes de solicitar outro e-mail.`;
    }
    attempts.push(now);
    rl[email] = attempts;
    try { localStorage.setItem(KEY, JSON.stringify(rl)); } catch { /* storage indisponível */ }
    return null;
  }

  // ══════════════════════════════════════════════════════════════
  // LOGIN
  // ══════════════════════════════════════════════════════════════

  /**
   * Realiza login com e-mail e senha
   * @async
   * @returns {Promise<void>}
   */
  globalScope.doLogin = async function doLogin() {
    const email = document.getElementById('login-email')?.value.trim().toLowerCase() || '';
    const senha = document.getElementById('login-senha')?.value || '';
    
    if (!email) {
      globalScope.mostrarErrLogin('Informe seu e-mail.');
      return;
    }
    
    if (!senha) {
      globalScope.mostrarErrLogin('Informe sua senha.');
      return;
    }

    // Valida domínio
    const dominio = email.split('@')[1] || '';
    if (!globalScope.DOMINIOS_PERMITIDOS.includes(dominio)) {
      globalScope.mostrarErrLogin('Acesso restrito a e-mails institucionais.');
      return;
    }

    // Com Firebase: tenta autenticar
    if (globalScope.fbReady && globalScope.fbReady()) {
      const btn = document.querySelector('.login-btn');
      if (btn) {
        btn.textContent = 'Entrando…';
        btn.disabled = true;
      }
      
      try {
        const { auth, signInWithEmailAndPassword } = globalScope.fb();
        globalScope._isManualLogin = true;
        await signInWithEmailAndPassword(auth, email, senha);
        // onAuthStateChanged vai carregar dados e aplicar o usuário
      } catch (e) {
        if (btn) {
          btn.textContent = 'Entrar';
          btn.disabled = false;
        }
        
        const msgs = {
          'auth/wrong-password': 'Senha incorreta.',
          'auth/user-not-found': 'Usuário não encontrado. Use "Primeiro acesso" para criar sua senha.',
          'auth/invalid-credential': 'E-mail ou senha incorretos.',
          'auth/too-many-requests': 'Muitas tentativas. Tente novamente em alguns minutos.',
        };
        globalScope.mostrarErrLogin(msgs[e.code] || ('Erro ao entrar: ' + e.message));
      }
    } else {
      // Fallback sem Firebase (modo local)
      const user = globalScope._findUsuarioByEmail(email);
      if (!user) {
        globalScope.mostrarErrLogin('Acesso não encontrado. Use "Primeiro acesso" para criar seu cadastro.');
        return;
      }
      
      if (globalScope.lsSet) {
        globalScope.lsSet('siga_user', user.email);
      }
      
      if (globalScope._aplicarUsuario) {
        globalScope._aplicarUsuario(user);
      }
    }
  };

  /**
   * Exibe mensagem de erro no formulário de login
   * @param {string} msg - Mensagem de erro
   */
  globalScope.mostrarErrLogin = function mostrarErrLogin(msg) {
    const e = document.getElementById('login-err');
    if (!e) return;
    const ov = document.getElementById('boot-overlay');
    if (ov) ov.style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    e.style.color = '#F2A0A0';
    e.textContent = msg;
    e.style.display = 'block';
  };

  // ══════════════════════════════════════════════════════════════
  // PRIMEIRO ACESSO / RECUPERAÇÃO DE SENHA
  // ══════════════════════════════════════════════════════════════

  /**
   * Toggle visibilidade do formulário de primeiro acesso
   */
  globalScope.togglePrimeiroAcesso = function togglePrimeiroAcesso() {
    const f = document.getElementById('primeiro-acesso-form');
    if (!f) return;
    const visible = f.style.display !== 'none';
    f.style.display = visible ? 'none' : 'block';
    if (!visible) {
      document.getElementById('pa-email')?.focus();
    }
  };

  /**
   * Processa solicitação de primeiro acesso
   * @async
   */
  globalScope.processarPrimeiroAcesso = async function processarPrimeiroAcesso() {
    const btn = document.getElementById('pa-btn');
    if (btn?.disabled) return;
    
    const nome = (document.getElementById('pa-nome')?.value || '').trim();
    const email = (document.getElementById('pa-email')?.value || '').trim().toLowerCase();
    const msgEl = document.getElementById('pa-msg');
    
    const showErr = m => {
      if (!msgEl) return;
      msgEl.style.background = 'rgba(242,160,160,.15)';
      msgEl.style.color = '#F2A0A0';
      msgEl.textContent = m;
      msgEl.style.display = 'block';
    };
    
    const showOk = m => {
      if (!msgEl) return;
      msgEl.style.background = 'rgba(160,242,196,.15)';
      msgEl.style.color = '#A0F2C4';
      msgEl.textContent = m;
      msgEl.style.display = 'block';
    };

    if (!email) {
      showErr('Informe seu e-mail institucional.');
      return;
    }
    
    const dominio = email.split('@')[1] || '';
    if (!globalScope.DOMINIOS_PERMITIDOS.includes(dominio)) {
      showErr('Use um e-mail institucional válido (' + globalScope.DOMINIOS_PERMITIDOS.join(' ou ') + ').');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando…';
    }
    
    try {
      const emailCadastrado = globalScope._checkEmailExists 
        ? await globalScope._checkEmailExists(email)
        : globalScope.USUARIOS.some(u => u.email === email);
        
      if (emailCadastrado) {
        await globalScope._primeiroAcessoExistente(email, showErr, showOk);
      } else {
        await globalScope._primeiroAcessoNovo(email, nome, showErr, showOk);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Continuar →';
      }
    }
  };

  // Salva config/usuarios diretamente no Firestore, sem exigir perfil EP.
  // fbSaveAll() só grava usuarios dentro de if(isEP()), o que falha no
  // auto-cadastro porque nenhum usuário está logado nesse momento.
  async function _fbSaveUsuarios() {
    const repo = globalScope.configRepository;
    if (!repo) throw new Error('Repositório de usuários não disponível. Tente novamente em instantes.');
    const lista = (globalScope.USUARIOS || []).map(function(u) {
      if (!u._perfil_original) return u;
      const { _perfil_original, ...rest } = u;
      return { ...rest, perfil: _perfil_original };
    });
    await repo.set('usuarios', { data: JSON.stringify(lista) });
  }

  // Garante que o usuário está em USUARIOS (cadastro mínimo), salvando no Firestore.
  // Usado quando a conta Auth existe mas o SIGA ainda não tem o registro.
  async function _garantirCadastroSiga(email, nome) {
    if (globalScope._findUsuarioByEmail(email)) return; // já existe
    const palavras = (nome || email.split('@')[0]).trim().split(/\s+/).filter(Boolean);
    const iniciais = (palavras.length >= 2
      ? palavras[0][0] + palavras[palavras.length - 1][0]
      : (palavras[0] || '?').slice(0, 2)
    ).toUpperCase();
    globalScope.USUARIOS.push({
      email,
      nome: palavras.join(' ') || email,
      perfil: 'dono',
      perfis: ['dono', 'gerente_projeto'],
      iniciais,
      macroprocessos_vinculados: [],
      processos_vinculados: [],
      trocar_senha: true
    });
    await _fbSaveUsuarios();
    // Notifica EPPs do novo cadastro automático
    if (globalScope.enviarNotif) {
      (globalScope.USUARIOS || []).filter(u => u.perfil === 'ep' && u.email).forEach(ep =>
        globalScope.enviarNotif(ep.email, ep.nome,
          'Usuário cadastrado automaticamente via "Primeiro Acesso": ' + email,
          'Controle de Acesso', '', 'Sistema')
      );
    }
  }

  /**
   * Primeiro acesso para usuário já cadastrado (envia reset de senha)
   * @async
   * @param {string} email - E-mail do usuário
   * @param {Function} showErr - Callback para mostrar erro
   * @param {Function} showOk - Callback para mostrar sucesso
   */
  globalScope._primeiroAcessoExistente = async function _primeiroAcessoExistente(email, showErr, showOk) {
    if (!globalScope.fbReady || !globalScope.fbReady()) {
      showErr('Firebase não configurado.');
      return;
    }
    const rlErr = _resetRateLimit(email);
    if (rlErr) { showErr(rlErr); return; }
    
    try {
      const { auth, sendPasswordResetEmail, initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword, FIREBASE_CONFIG } = globalScope.fb();
      
      // Tenta criar conta Firebase Auth (caso EPP tenha cadastrado manualmente)
      const secApp = initializeApp(FIREBASE_CONFIG, 'sec_exist_' + Date.now());
      const secAuth = getAuth(secApp);
      let contaCriada = false;
      const senhaTemp = globalScope.gerarSenhaTemp();
      
      try {
        await createUserWithEmailAndPassword(secAuth, email, senhaTemp);
        contaCriada = true;
      } catch (createErr) {
        if (createErr.code !== 'auth/email-already-in-use') throw createErr;
      } finally {
        await deleteApp(secApp).catch(() => {});
      }

      if (contaCriada) {
        // Conta recém-criada — envia senha temporária
        const user = globalScope._findUsuarioByEmail(email);
        if (user) {
          user.trocar_senha = true;
          await _fbSaveUsuarios();
        }
        const nome = user?.nome || email;
        if (globalScope._enviarSenhaAcesso) {
          globalScope._enviarSenhaAcesso(email, nome, senhaTemp);
        }
        showOk('Acesso liberado! Enviamos uma senha temporária para ' + email + '. Use-a para entrar e defina sua senha definitiva.');
      } else {
        // Conta já existe no Auth — garante cadastro no SIGA antes de enviar reset
        const user = globalScope._findUsuarioByEmail(email);
        if (!user) {
          // Usuário tem Auth mas não está no SIGA — cadastra automaticamente
          const { auth: _auth, sendPasswordResetEmail: _spr } = globalScope.fb();
          await _garantirCadastroSiga(email, email.split('@')[0]);
          await _spr(_auth, email);
          showOk('Acesso configurado! Enviamos um link de redefinição de senha para ' + email + '. Verifique sua caixa de entrada (e a pasta de spam).');
        } else {
          // Usuário já cadastrado — apenas reset de senha
          await sendPasswordResetEmail(auth, email);
          showOk('Link de redefinição enviado para ' + email + '. Verifique sua caixa de entrada (e a pasta de spam).');
        }
      }
    } catch (err) {
      showErr('Erro ao enviar e-mail: ' + err.message);
    }
  };

  /**
   * Primeiro acesso para novo usuário (cria solicitação)
   * @async
   * @param {string} email - E-mail do usuário
   * @param {string} nome - Nome completo do usuário
   * @param {Function} showErr - Callback para mostrar erro
   * @param {Function} showOk - Callback para mostrar sucesso
   */
  globalScope._primeiroAcessoNovo = async function _primeiroAcessoNovo(email, nome, showErr, showOk) {
    if (!nome) {
      showErr('Informe seu nome completo.');
      return;
    }
    if (!globalScope.fbReady || !globalScope.fbReady()) {
      showErr('Firebase não configurado.');
      return;
    }
    const rlErr = _resetRateLimit(email);
    if (rlErr) { showErr(rlErr); return; }

    const senhaTemp = globalScope.gerarSenhaTemp();

    // Cria conta no Firebase Auth
    try {
      const { initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword, FIREBASE_CONFIG } = globalScope.fb();
      const secApp = initializeApp(FIREBASE_CONFIG, 'sec_' + Date.now());
      const secAuth = getAuth(secApp);
      
      try {
        await createUserWithEmailAndPassword(secAuth, email, senhaTemp);
      } catch (error_) {
        await deleteApp(secApp).catch(() => {});
        if (error_.code === 'auth/email-already-in-use') {
          // Conta Auth já existe — garante cadastro no SIGA e envia reset de senha
          const { auth: _auth, sendPasswordResetEmail: _spr } = globalScope.fb();
          await _garantirCadastroSiga(email, nome);
          await _spr(_auth, email);
          showOk('Acesso configurado! Enviamos um link de redefinição de senha para ' + email + '. Verifique sua caixa de entrada (e a pasta de spam).');
          return;
        }
        throw error_;
      }
      await deleteApp(secApp);
    } catch (e) {
      showErr('Erro ao criar acesso: ' + (e.message || e.code || e));
      return;
    }

    // Registra no SIGA e só então envia o e-mail
    try {
      const palavras = nome.trim().split(/\s+/).filter(Boolean);
      const iniciais = (palavras.length >= 2
        ? palavras[0][0] + palavras[palavras.length - 1][0]
        : (palavras[0] || '?').slice(0, 2)
      ).toUpperCase();

      globalScope.USUARIOS.push({
        email,
        nome,
        perfil: 'dono',
        perfis: ['dono', 'gerente_projeto'],
        iniciais,
        macroprocessos_vinculados: [],
        processos_vinculados: [],
        trocar_senha: true
      });

      await _fbSaveUsuarios(); // lança erro se o repositório não estiver disponível

      // Só envia o e-mail após confirmar o save no Firestore
      if (globalScope._enviarSenhaAcesso) {
        globalScope._enviarSenhaAcesso(email, nome, senhaTemp);
      }

      // Notifica EPPs
      if (globalScope.enviarNotif) {
        globalScope.USUARIOS.filter(u => u.perfil === 'ep' && u.email).forEach(ep =>
          globalScope.enviarNotif(
            ep.email, ep.nome,
            'Novo usuário registrado: ' + nome + ' (' + email + '). Acesso liberado automaticamente.',
            'Controle de Acesso', '', 'Sistema'
          )
        );
      }
    } catch (e) {
      // Desfaz o push em memória para não deixar estado inconsistente
      const idx = (globalScope.USUARIOS || []).findLastIndex(u => u.email === email);
      if (idx >= 0) globalScope.USUARIOS.splice(idx, 1);
      showErr('Acesso criado no Firebase, mas falha ao registrar no SIGA: ' + (e.message || e));
      return;
    }

    showOk('Acesso criado! Enviamos uma senha temporária para ' + email + '. Verifique sua caixa de entrada e spam.');
    
    // Limpa formulário
    const nomeEl = document.getElementById('pa-nome');
    const emailEl = document.getElementById('pa-email');
    if (nomeEl) nomeEl.value = '';
    if (emailEl) emailEl.value = '';
  };

  // ══════════════════════════════════════════════════════════════
  // GERAÇÃO DE SENHA TEMPORÁRIA
  // ══════════════════════════════════════════════════════════════

  /**
   * Gera senha temporária segura (8 caracteres)
   * @returns {string} Senha gerada
   */
  globalScope.gerarSenhaTemp = function gerarSenhaTemp() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const all = upper + lower + digits;
    
    // Pad para 32 caracteres (2^5) para evitar bias de modulo
    const _pad32 = (s) => {
      let r = s;
      while (r.length < 32) r += s;
      return r.slice(0, 32);
    };
    
    const U32 = _pad32(upper);
    const L32 = _pad32(lower);
    const D32 = _pad32(digits);
    const A32 = _pad32(all);
    
    const _rndBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
    const _pickP2 = (p32, byte) => p32[byte >> 3]; // Top 5 bits
    
    const bytes = _rndBytes(16); // 8 para chars, 8 para shuffle
    let p = _pickP2(U32, bytes[0]) + _pickP2(L32, bytes[1]) + _pickP2(D32, bytes[2]);
    p += _pickP2(A32, bytes[3]);
    p += _pickP2(A32, bytes[4]);
    p += _pickP2(A32, bytes[5]);
    p += _pickP2(A32, bytes[6]);
    p += _pickP2(A32, bytes[7]);
    
    // Fisher-Yates shuffle
    const arr = p.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = bytes[8 + i] & 7; // 0-7
      if (j <= i) {
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    
    return arr.join('');
  };

  /**
   * Envia senha de acesso por e-mail
   * @param {string} email - E-mail destino
   * @param {string} nome - Nome do usuário
   * @param {string} senha - Senha temporária
   */
  globalScope._enviarSenhaAcesso = function _enviarSenhaAcesso(email, nome, senha) {
    const ejsConfig = globalScope.ejsConfig;
    const ORG_CONFIG = globalScope.ORG_CONFIG;
    
    if (ejsConfig?.service && ejsConfig?.template && ejsConfig?.pubkey && typeof emailjs !== 'undefined') {
      emailjs.send(ejsConfig.service, ejsConfig.template, {
        to_name: nome,
        to_email: email,
        from_name: ORG_CONFIG.notificationFromName,
        processo: 'Acesso liberado',
        acao: 'Seu acesso ao sistema ' + ORG_CONFIG.systemBrand + ' foi aprovado.\n\nSua senha temporária: ' + senha + '\n\nAcesse o sistema e altere sua senha no primeiro login.',
        prazo: 'Alterar a senha no primeiro acesso',
        link: ORG_CONFIG.publicUrl,
      }).then(() => console.info('Senha temporária enviada para', email))
        .catch(err => console.warn('EmailJS erro ao enviar senha:', err?.text || err?.message));
    } else {
      console.warn('_enviarSenhaAcesso: EmailJS não configurado — e-mail não enviado para', email);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // MENU DE USUÁRIO (popup nas iniciais)
  // ══════════════════════════════════════════════════════════════

  globalScope.abrirMenuUsuario = function abrirMenuUsuario(event, el) {
    event.stopPropagation();
    const popup = document.getElementById('user-menu-popup');
    if (!popup) return;
    const rect = el.getBoundingClientRect();
    popup.style.display = 'block';
    // Posiciona acima ou abaixo do botão, alinhado à direita
    const spaceBelow = window.innerHeight - rect.bottom;
    const popupH = popup.offsetHeight || 100;
    if (spaceBelow < popupH + 8) {
      popup.style.top  = (rect.top - popupH - 6) + 'px';
    } else {
      popup.style.top  = (rect.bottom + 6) + 'px';
    }
    popup.style.left = Math.max(8, rect.right - popup.offsetWidth) + 'px';
    // Fecha ao clicar fora
    setTimeout(function() {
      document.addEventListener('click', globalScope.fecharMenuUsuario, { once: true });
    }, 0);
  };

  globalScope.fecharMenuUsuario = function fecharMenuUsuario() {
    const popup = document.getElementById('user-menu-popup');
    if (popup) popup.style.display = 'none';
  };

  // ══════════════════════════════════════════════════════════════
  // TROCAR SENHA (primeiro acesso com senha temporária)
  // ══════════════════════════════════════════════════════════════

  globalScope.abrirModalTrocarSenha = function abrirModalTrocarSenha() {
    const modal = document.getElementById('trocar-senha-modal');
    if (modal) modal.style.display = 'flex';
  };

  globalScope.salvarNovaSenha = async function salvarNovaSenha() {
    const nova  = document.getElementById('ts-nova')?.value  || '';
    const conf  = document.getElementById('ts-conf')?.value  || '';
    const msg   = document.getElementById('ts-msg');
    const btn   = document.querySelector('#trocar-senha-modal .login-btn');

    function showMsg(txt, ok) {
      if (!msg) return;
      msg.textContent = txt;
      msg.style.color = ok ? '#7fe0b0' : '#F2A0A0';
      msg.style.display = 'block';
    }

    if (nova.length < 6)       { showMsg('A senha deve ter ao menos 6 caracteres.', false); return; }
    if (nova !== conf)          { showMsg('As senhas não coincidem.', false); return; }

    if (btn) { btn.textContent = 'Salvando…'; btn.disabled = true; }
    try {
      const { auth, updatePassword } = globalScope.fb();
      await updatePassword(auth.currentUser, nova);

      // Remove flag trocar_senha.
      // EP pode escrever em config/usuarios; não-EP usa /usuarios/{uid} como override.
      const usuario = globalScope.usuarioLogado;
      if (usuario) {
        usuario.trocar_senha = false;
        const idx = (globalScope.USUARIOS || []).findIndex(function(u) { return u.email === usuario.email; });
        if (idx >= 0) globalScope.USUARIOS[idx].trocar_senha = false;
        try {
          await _fbSaveUsuarios(); // funciona para EP (escreve em config/usuarios)
        } catch(configErr) {
          // Não-EP: persiste override em /usuarios/{uid} (regra: uid == uid)
          try {
            const { auth: _a, db, doc: _doc, setDoc: _set } = globalScope.fb();
            await _set(_doc(db, 'usuarios', _a.currentUser.uid), { trocar_senha: false }, { merge: true });
          } catch(fsErr) { console.warn('salvarNovaSenha: não foi possível persistir trocar_senha:', fsErr.message); }
        }
      }

      const modal = document.getElementById('trocar-senha-modal');
      if (modal) modal.style.display = 'none';
      if (typeof globalScope.openModuleHub === 'function') globalScope.openModuleHub();
    } catch (e) {
      showMsg('Erro ao salvar: ' + (e.message || e.code), false);
    } finally {
      if (btn) { btn.textContent = 'Definir senha e entrar →'; btn.disabled = false; }
    }
  };

  // ══════════════════════════════════════════════════════════════
  // ALTERAR SENHA (voluntário, usuário já logado)
  // ══════════════════════════════════════════════════════════════

  globalScope.abrirAlterarSenha = function abrirAlterarSenha() {
    globalScope.fecharMenuUsuario();
    ['alt-pwd-atual','alt-pwd-nova','alt-pwd-conf'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const msg = document.getElementById('alt-pwd-msg');
    if (msg) msg.style.display = 'none';
    const modal = document.getElementById('alterar-senha-modal');
    if (modal) modal.style.display = 'flex';
  };

  globalScope.salvarAlterarSenha = async function salvarAlterarSenha() {
    const atual = document.getElementById('alt-pwd-atual')?.value || '';
    const nova  = document.getElementById('alt-pwd-nova')?.value  || '';
    const conf  = document.getElementById('alt-pwd-conf')?.value  || '';
    const btn   = document.getElementById('alt-pwd-btn');

    function showMsg(txt, ok) {
      const msg = document.getElementById('alt-pwd-msg');
      if (!msg) return;
      msg.textContent = txt;
      msg.style.background = ok ? 'rgba(127,224,176,.15)' : 'rgba(242,160,160,.15)';
      msg.style.color = ok ? '#7fe0b0' : '#F2A0A0';
      msg.style.display = 'block';
    }

    if (!atual)              { showMsg('Informe a senha atual.', false); return; }
    if (nova.length < 6)    { showMsg('A nova senha deve ter ao menos 6 caracteres.', false); return; }
    if (nova !== conf)       { showMsg('As senhas não coincidem.', false); return; }

    if (btn) { btn.textContent = 'Salvando…'; btn.disabled = true; }
    try {
      const { auth, reauthenticateWithCredential, EmailAuthProvider, updatePassword } = globalScope.fb();
      const user = auth.currentUser;
      const cred = EmailAuthProvider.credential(user.email, atual);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, nova);
      showMsg('Senha alterada com sucesso!', true);
      setTimeout(function() {
        const modal = document.getElementById('alterar-senha-modal');
        if (modal) modal.style.display = 'none';
      }, 1500);
    } catch (e) {
      const msgs = {
        'auth/wrong-password':      'Senha atual incorreta.',
        'auth/invalid-credential':  'Senha atual incorreta.',
        'auth/too-many-requests':   'Muitas tentativas. Aguarde alguns minutos.',
      };
      showMsg(msgs[e.code] || ('Erro: ' + e.message), false);
    } finally {
      if (btn) { btn.textContent = 'Salvar'; btn.disabled = false; }
    }
  };

  // ══════════════════════════════════════════════════════════════
  // CRIAR USUÁRIO PARA ATRIBUIÇÃO DE ETAPA (chamado por EP logado)
  // ══════════════════════════════════════════════════════════════

  globalScope._criarUsuarioParaAtribuicao = async function _criarUsuarioParaAtribuicao(email, nome, perfil) {
    // Se já existe no SIGA, não recria — retorna null para o chamador saber
    if (globalScope._findUsuarioByEmail && globalScope._findUsuarioByEmail(email)) return null;

    const senhaTemp = globalScope.gerarSenhaTemp();

    // Cria conta no Firebase Auth via app secundária (não deslogar o EP atual)
    const { initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword, FIREBASE_CONFIG } = globalScope.fb();
    const secApp = initializeApp(FIREBASE_CONFIG, 'sec_atrib_' + Date.now());
    const secAuth = getAuth(secApp);
    try {
      await createUserWithEmailAndPassword(secAuth, email, senhaTemp);
    } catch (e) {
      if (e.code !== 'auth/email-already-in-use') throw e;
      // Conta Auth já existe — garante só o registro no SIGA
    } finally {
      await deleteApp(secApp).catch(() => {});
    }

    // Adiciona ao SIGA
    const palavras = (nome || email.split('@')[0]).trim().split(/\s+/).filter(Boolean);
    const iniciais = (palavras.length >= 2
      ? palavras[0][0] + palavras[palavras.length - 1][0]
      : (palavras[0] || '?').slice(0, 2)
    ).toUpperCase();

    (globalScope.USUARIOS || []).push({
      email,
      nome: palavras.join(' ') || email,
      perfil: perfil || 'dono',
      perfis: perfil === 'gestor' ? ['gestor'] : ['dono', 'gerente_projeto'],
      iniciais,
      macroprocessos_vinculados: [],
      processos_vinculados: [],
      trocar_senha: true,
    });

    await _fbSaveUsuarios();

    return senhaTemp;
  };

  console.info('[auth-controller] Módulo carregado');

})(globalThis);
