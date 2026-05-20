'use strict';

const PERFIL_LABELS = globalThis.PERFIL_LABELS || {
  ep: ORG_CONFIG.epProfileLabel,
  dono: 'Executor de Processo',
  gestor: 'Gestor / Adjunto',
  gerente_projeto: 'Projetos'
};

const DOMINIOS_PERMITIDOS = ORG_CONFIG.allowedDomains;

let USUARIOS = [
  { email: ORG_CONFIG.localEpEmail, nome: ORG_CONFIG.epTeamName, perfil: 'ep', iniciais: 'EP' }
];
let solicitacoes = [];
let usuarioLogado = null;

function getPerfisUsuario(u = usuarioLogado) {
  if (!u) return [];
  if (Array.isArray(u.perfis) && u.perfis.length) {
    return [...new Set(u.perfis.map(p => String(p || '').trim()).filter(Boolean))];
  }
  return u.perfil ? [u.perfil] : [];
}

function hasPerfil(perfil, u = usuarioLogado) {
  return getPerfisUsuario(u).includes(perfil);
}

function isEP() {
  return hasPerfil('ep');
}

function isDono() {
  return hasPerfil('dono');
}

function isGerenteProjeto() {
  return hasPerfil('gerente_projeto');
}

function hasProcessosAccess(u) {
  const perfis = getPerfisUsuario(u || usuarioLogado);
  return perfis.some(p => ['ep', 'dono', 'gestor'].includes(p));
}

function hasProjetosAccess(u) {
  const perfis = getPerfisUsuario(u || usuarioLogado);
  return perfis.some(p => ['ep', 'gestor', 'gerente_projeto'].includes(p));
}

function _sharedToast(msg, color) {
  if (typeof projToast === 'function') {
    projToast(msg, color);
    return;
  }
  console.info(msg);
}

function _roleText(user) {
  return getPerfisUsuario(user).map(p => PERFIL_LABELS[p] || p).join(' · ') || (PERFIL_LABELS[user?.perfil] || user?.perfil || '-');
}

function _popularUsuarioProjetos(user) {
  const avEl = document.getElementById('proj-av');
  const nameEl = document.getElementById('proj-nome');
  const roleEl = document.getElementById('proj-perfil');
  if (avEl) avEl.textContent = user?.iniciais || '?';
  if (nameEl) nameEl.textContent = user?.nome || '-';
  if (roleEl) roleEl.textContent = _roleText(user);
}

function aplicarPermissoes() {
  const podeEditarTudo = isEP();
  document.querySelectorAll('.ep-only').forEach(el => {
    el.style.display = podeEditarTudo ? '' : 'none';
  });
}

function mostrarHub() {
  globalThis.location.href = 'processos.html';
}

function abrirModuloProcessos() {
  if (!hasProcessosAccess()) {
    _sharedToast('Seu perfil não tem acesso ao módulo de processos.', '#dc2626');
    return;
  }
  globalThis.location.href = 'processos.html';
}

function abrirModuloProjetos() {
  if (!hasProjetosAccess()) {
    _sharedToast('Seu perfil não tem acesso ao módulo de projetos.', '#dc2626');
    return;
  }
  const hubEl = document.getElementById('module-hub');
  const loginEl = document.getElementById('login-screen');
  const procShell = document.querySelector('.shell');
  const projShell = document.getElementById('proj-shell');
  if (hubEl) hubEl.style.display = 'none';
  if (loginEl) loginEl.style.display = 'none';
  if (procShell) procShell.style.display = 'none';
  if (projShell) projShell.classList.add('on');
  _popularUsuarioProjetos(usuarioLogado);
  aplicarPermissoes();
  const mobBar = document.getElementById('mob-top-bar');
  const mobBackdrop = document.getElementById('mob-backdrop');
  if (mobBar) mobBar.style.display = 'none';
  if (mobBackdrop) mobBackdrop.style.display = 'none';
  if (typeof projLoad === 'function') projLoad();
  if (typeof projRenderCurrentPage === 'function') {
    projRenderCurrentPage();
  } else if (typeof projGo === 'function') {
    projGo('inicio', document.getElementById('pnb-inicio'));
  }
}

function voltarAoHub() {
  globalThis.location.href = 'processos.html';
}

function _encaminharModuloLocal(user, toastOnEnter) {
  usuarioLogado = user;
  _popularUsuarioProjetos(user);
  const temProj = hasProjetosAccess(user);
  const temProc = hasProcessosAccess(user);
  if (temProj) {
    abrirModuloProjetos();
    if (toastOnEnter) _sharedToast('Bem-vindo(a), ' + (user.nome || user.email) + '!', 'var(--teal)');
    return;
  }
  if (temProc && !temProj) {
    globalThis.location.href = 'processos.html';
  }
}

function _mostrarProjetos(user) {
  usuarioLogado = user;
  abrirModuloProjetos();
}

function _carregarUsuariosFirebase(_fbObj) {
  return _fbObj.getDoc(_fbObj.doc(_fbObj.db, 'config', 'usuarios'))
    .then(function(usrDoc) {
      if (usrDoc.exists() && usrDoc.data().data) {
        try {
          USUARIOS = JSON.parse(usrDoc.data().data);
        } catch (err) {
          console.warn('usuarios/config parse:', err.message);
        }
      }
    })
    .catch(function(err) {
      console.warn('usuarios/config load:', err.message);
    });
}

async function doLogin() {
  const email = document.getElementById('login-email')?.value.trim().toLowerCase() || '';
  const senha = document.getElementById('login-senha')?.value || '';
  if (!email) {
    mostrarErrLogin('Informe seu e-mail.');
    return;
  }
  if (!senha) {
    mostrarErrLogin('Informe sua senha.');
    return;
  }

  const dominio = email.split('@')[1] || '';
  if (!DOMINIOS_PERMITIDOS.includes(dominio)) {
    mostrarErrLogin('Acesso restrito a e-mails institucionais.');
    return;
  }

  const user = USUARIOS.find(u => u.email === email);
  if (!user) {
    mostrarErrLogin('Acesso não autorizado. Solicite cadastro ao EPP.');
    return;
  }

  if (fbReady()) {
    const btn = document.querySelector('.login-btn');
    if (btn) {
      btn.textContent = 'Entrando…';
      btn.disabled = true;
    }
    try {
      const { auth, signInWithEmailAndPassword } = fb();
      await signInWithEmailAndPassword(auth, email, senha);
    } catch (e) {
      if (btn) {
        btn.textContent = 'Entrar';
        btn.disabled = false;
      }
      const msgs = {
        'auth/wrong-password': 'Senha incorreta.',
        'auth/user-not-found': 'Usuário não encontrado. Use "Primeiro acesso" para criar sua senha.',
        'auth/invalid-credential': 'E-mail ou senha incorretos.',
        'auth/too-many-requests': 'Muitas tentativas. Tente novamente em alguns minutos.'
      };
      mostrarErrLogin(msgs[e.code] || ('Erro ao entrar: ' + e.message));
    }
    return;
  }

  lsSet('siga_user', user.email);
  _encaminharModuloLocal(user, true);
}

function togglePrimeiroAcesso() {
  const form = document.getElementById('primeiro-acesso-form');
  if (!form) return;
  const visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : 'block';
  if (!visible) document.getElementById('pa-email')?.focus();
}

function senhaTempRandomIndex(max) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Gerador seguro de números aleatórios indisponível.');
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error('Limite inválido para geração de senha temporária.');
  }
  const random = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do {
    globalThis.crypto.getRandomValues(random);
  } while (random[0] >= limit);
  return random[0] % max;
}

function senhaTempPick(chars) {
  return chars[senhaTempRandomIndex(chars.length)];
}

function senhaTempShuffle(chars) {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = senhaTempRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function gerarSenhaTemp() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const senha = [senhaTempPick(upper), senhaTempPick(lower), senhaTempPick(digits)];
  for (let i = 0; i < 5; i += 1) {
    senha.push(senhaTempPick(all));
  }
  return senhaTempShuffle(senha);
}

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

async function _primeiroAcessoExistente(email, showErr, showOk) {
  if (!fbReady()) {
    showErr('Firebase não configurado.');
    return;
  }
  const rlErr = _resetRateLimit(email);
  if (rlErr) { showErr(rlErr); return; }
  try {
    const { auth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } = fb();
    try {
      const tmpPass = gerarSenhaTemp() + gerarSenhaTemp();
      await createUserWithEmailAndPassword(auth, email, tmpPass);
      await signOut(auth);
    } catch (createErr) {
      if (createErr.code !== 'auth/email-already-in-use') throw createErr;
    }
    await sendPasswordResetEmail(auth, email);
    showOk('Link de redefinição enviado para ' + email + '. Verifique sua caixa de entrada (e a pasta de spam).');
  } catch (err) {
    showErr('Erro ao enviar e-mail: ' + err.message);
  }
}

async function _primeiroAcessoNovo(email, nome, showErr, showOk) {
  if (!nome) {
    showErr('Informe seu nome completo para solicitar o primeiro acesso.');
    return;
  }
  const jaSolicitou = solicitacoes.find(s => s.email === email && s.status === 'pendente');
  if (jaSolicitou) {
    showOk('Já existe uma solicitação pendente para este e-mail. Aguarde a aprovação do EPP.');
    return;
  }
  if (!fbReady()) {
    showErr('Firebase não configurado.');
    return;
  }
  try {
    const { db, doc, setDoc } = fb();
    const sol = { email, nome, status: 'pendente', solicitado_em: new Date().toLocaleDateString('pt-BR'), modulo: 'projetos' };
    await setDoc(doc(db, 'solicitacoes', email), sol);
    solicitacoes.push(sol);
    showOk('Solicitação enviada! O EPP receberá uma notificação e entrará em contato.');
    if (document.getElementById('pa-nome')) document.getElementById('pa-nome').value = '';
    if (document.getElementById('pa-email')) document.getElementById('pa-email').value = '';
  } catch (e) {
    showErr('Erro ao enviar solicitação: ' + e.message);
  }
}

async function processarPrimeiroAcesso() {
  const nome = document.getElementById('pa-nome')?.value.trim() || '';
  const email = document.getElementById('pa-email')?.value.trim().toLowerCase() || '';
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
  if (!DOMINIOS_PERMITIDOS.includes(dominio)) {
    showErr('Use um e-mail institucional válido (' + DOMINIOS_PERMITIDOS.join(' ou ') + ').');
    return;
  }

  if (USUARIOS.some(u => u.email === email)) {
    await _primeiroAcessoExistente(email, showErr, showOk);
  } else {
    await _primeiroAcessoNovo(email, nome, showErr, showOk);
  }
}

function mostrarErrLogin(msg) {
  const el = document.getElementById('login-err');
  if (!el) return;
  el.style.color = '#F2A0A0';
  el.textContent = msg;
  el.style.display = 'block';
}

function abrirModalTrocarSenha() {
  const modal = document.getElementById('trocar-senha-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('ts-nova')?.focus();
  }
}

async function salvarNovaSenha() {
  const nova = document.getElementById('ts-nova')?.value || '';
  const conf = document.getElementById('ts-conf')?.value || '';
  const msgEl = document.getElementById('ts-msg');
  const showErr = m => {
    if (!msgEl) return;
    msgEl.style.color = '#F2A0A0';
    msgEl.textContent = m;
    msgEl.style.display = 'block';
  };
  if (nova.length < 6) {
    showErr('A senha deve ter pelo menos 6 caracteres.');
    return;
  }
  if (nova !== conf) {
    showErr('As senhas não coincidem.');
    return;
  }
  if (!fbReady()) {
    showErr('Firebase não disponível.');
    return;
  }
  const { auth, updatePassword } = fb();
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    showErr('Sessão inválida. Faça login novamente.');
    return;
  }
  try {
    await updatePassword(firebaseUser, nova);
    if (usuarioLogado) usuarioLogado.trocar_senha = false;
    const modal = document.getElementById('trocar-senha-modal');
    if (modal) modal.style.display = 'none';
    _sharedToast('Senha definida com sucesso! Bem-vindo(a) ao módulo de projetos.', 'var(--green)');
  } catch (e) {
    const msgs = {
      'auth/requires-recent-login': 'Sessão expirada. Faça logout e login novamente.',
      'auth/weak-password': 'Senha muito fraca. Use pelo menos 6 caracteres.'
    };
    showErr(msgs[e.code] || ('Erro ao alterar senha: ' + e.message));
  }
}

function abrirMenuUsuario(ev, targetEl) {
  ev.stopPropagation();
  const menu = document.getElementById('user-menu-popup');
  if (!menu) return;
  if (menu.style.display !== 'none') {
    fecharMenuUsuario();
    return;
  }
  const rect = (targetEl || ev.currentTarget).getBoundingClientRect();
  menu.style.display = 'block';
  const menuWidth = 175;
  const menuHeight = 85;
  let left = rect.left;
  let top = rect.top - menuHeight - 6;
  if (top < 8) top = rect.bottom + 6;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  setTimeout(() => document.addEventListener('click', fecharMenuUsuario, { once: true }), 0);
}

function fecharMenuUsuario() {
  const menu = document.getElementById('user-menu-popup');
  if (menu) menu.style.display = 'none';
}

function abrirAlterarSenha() {
  fecharMenuUsuario();
  ['alt-pwd-atual', 'alt-pwd-nova', 'alt-pwd-conf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const msgEl = document.getElementById('alt-pwd-msg');
  if (msgEl) msgEl.style.display = 'none';
  const modal = document.getElementById('alterar-senha-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => document.getElementById('alt-pwd-atual')?.focus(), 80);
}

async function salvarAlterarSenha() {
  const atual = document.getElementById('alt-pwd-atual')?.value || '';
  const nova = document.getElementById('alt-pwd-nova')?.value || '';
  const conf = document.getElementById('alt-pwd-conf')?.value || '';
  const msgEl = document.getElementById('alt-pwd-msg');
  const btn = document.getElementById('alt-pwd-btn');
  const showErr = m => {
    if (!msgEl) return;
    msgEl.style.background = 'rgba(242,160,160,.12)';
    msgEl.style.color = '#F2A0A0';
    msgEl.textContent = m;
    msgEl.style.display = 'block';
  };
  const showOk = m => {
    if (!msgEl) return;
    msgEl.style.background = 'rgba(160,242,196,.12)';
    msgEl.style.color = '#A0F2C4';
    msgEl.textContent = m;
    msgEl.style.display = 'block';
  };
  if (!atual) {
    showErr('Informe a senha atual.');
    return;
  }
  if (nova.length < 6) {
    showErr('A nova senha deve ter pelo menos 6 caracteres.');
    return;
  }
  if (nova !== conf) {
    showErr('As senhas não coincidem.');
    return;
  }
  if (!fbReady()) {
    showErr('Firebase não disponível.');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Salvando…';
  }
  try {
    const { auth, reauthenticateWithCredential, EmailAuthProvider, updatePassword } = fb();
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      showErr('Sessão inválida. Faça login novamente.');
      return;
    }
    const credential = EmailAuthProvider.credential(firebaseUser.email, atual);
    await reauthenticateWithCredential(firebaseUser, credential);
    await updatePassword(firebaseUser, nova);
    showOk('Senha alterada com sucesso!');
    setTimeout(() => {
      const modal = document.getElementById('alterar-senha-modal');
      if (modal) modal.style.display = 'none';
    }, 1400);
    _sharedToast('Senha alterada com sucesso!', 'var(--teal)');
  } catch (e) {
    const msgs = {
      'auth/wrong-password': 'Senha atual incorreta.',
      'auth/invalid-credential': 'Senha atual incorreta.',
      'auth/requires-recent-login': 'Sessão expirada. Faça logout e login novamente.',
      'auth/weak-password': 'Senha muito fraca. Use pelo menos 6 caracteres.'
    };
    showErr(msgs[e.code] || ('Erro: ' + e.message));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  }
}

async function doLogout() {
  if (fbReady()) {
    const { auth, signOut } = fb();
    await signOut(auth).catch(() => {});
  }
  usuarioLogado = null;
  lsRemove('siga_user');
  fecharMenuUsuario();
  const hubEl = document.getElementById('module-hub');
  const loginEl = document.getElementById('login-screen');
  const projShell = document.getElementById('proj-shell');
  const procShell = document.querySelector('.shell');
  if (hubEl) hubEl.style.display = 'none';
  if (projShell) projShell.classList.remove('on');
  if (procShell) procShell.style.display = 'none';
  if (loginEl) loginEl.style.display = 'flex';
}

function mobToggleDrawer() {
  const backdrop = document.getElementById('mob-backdrop');
  if (backdrop) backdrop.classList.remove('on');
}

document.addEventListener('DOMContentLoaded', function() {
  const projShell = document.getElementById('proj-shell');
  if (!projShell) return;

  projShell.classList.remove('on');
  const loginEl = document.getElementById('login-screen');
  const hubEl = document.getElementById('module-hub');
  const procShell = document.querySelector('.shell');
  if (hubEl) hubEl.remove();
  if (loginEl) loginEl.style.display = 'none';
  if (procShell) procShell.style.display = 'none';

  if (typeof projCarregarDemoSeVazio === 'function') projCarregarDemoSeVazio();
  if (typeof projLoad === 'function') projLoad();

  function _mostrarLogin() {
    if (fbReady()) {
      const _fbObj = fb();
      _carregarUsuariosFirebase(_fbObj);
    }
    if (loginEl) loginEl.style.display = 'flex';
  }

  function _encaminhar(user) {
    const temProj = hasProjetosAccess(user);
    const temProc = hasProcessosAccess(user);
    if (temProj) {
      _mostrarProjetos(user);
      return;
    }
    if (temProc && !temProj) {
      globalThis.location.href = 'processos.html';
      return;
    }
    _mostrarLogin();
  }

  if (fbReady()) {
    const _fbObj = fb();
    _fbObj.onAuthStateChanged(_fbObj.auth, function(firebaseUser) {
      if (!firebaseUser) {
        _mostrarLogin();
        return;
      }

      _carregarUsuariosFirebase(_fbObj)
        .finally(function() {
          const user = USUARIOS.find(function(u) { return u.email === firebaseUser.email; });
          if (user) {
            _encaminhar(user);
          } else {
            _mostrarLogin();
          }
        });
    });
  } else {
    const savedEmail = lsGet('siga_user');
    if (savedEmail) {
      const user = USUARIOS.find(function(u) { return u.email === savedEmail; });
      if (user) {
        _encaminhar(user);
        return;
      }
    }
    _mostrarLogin();
  }
});
