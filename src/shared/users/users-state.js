/**
 * @fileoverview Gestão de estado de usuários e solicitações
 * Módulo compartilhado entre processos.html e projetos.html
 * 
 * Gerencia USUARIOS e usuarioLogado
 */

(function initUsersState(globalScope) {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // CONSTANTES
  // ══════════════════════════════════════════════════════════════

  /**
   * Domínios de e-mail permitidos para login
   * @type {string[]}
   */
  globalScope.DOMINIOS_PERMITIDOS = globalScope.ORG_CONFIG?.allowedDomains || ['sefaz.rs.gov.br'];

  // ══════════════════════════════════════════════════════════════
  // ESTADO GLOBAL
  // ══════════════════════════════════════════════════════════════

  /**
   * Lista de todos os usuários cadastrados
   * @type {Array<Object>}
   */
  globalScope.USUARIOS = [
    {
      email: globalScope.ORG_CONFIG?.localEpEmail || 'ep@example.com',
      nome: globalScope.ORG_CONFIG?.epTeamName || 'Equipe de Processos',
      perfil: 'ep',
      perfis: ['ep'],
      iniciais: 'EP'
    }
  ];

  /**
   * Usuário atualmente autenticado
   * @type {Object|null}
   */
  globalScope.usuarioLogado = null;

  // ══════════════════════════════════════════════════════════════
  // FUNÇÕES DE BUSCA
  // ══════════════════════════════════════════════════════════════

  /**
   * Busca usuário por e-mail
   * @param {string} email - E-mail do usuário
   * @returns {Object|undefined} Usuário encontrado ou undefined
   */
  globalScope._findUsuarioByEmail = function _findUsuarioByEmail(email) {
    if (!email) return undefined;
    const normalizedEmail = String(email).trim().toLowerCase();
    return globalScope.USUARIOS.find(u => u.email?.toLowerCase() === normalizedEmail);
  };

  // ══════════════════════════════════════════════════════════════
  // CARREGAR USUÁRIOS DO FIRESTORE
  // ══════════════════════════════════════════════════════════════

  /**
   * Carrega lista de usuários do Firestore (config/usuarios)
   * @param {Object} _fbObj - Objeto Firebase (_fb)
   * @returns {Promise<void>}
   */
  globalScope._carregarUsuariosFirebase = function _carregarUsuariosFirebase(_fbObj) {
    if (!_fbObj || !_fbObj.db) {
      console.warn('[users-state] Firebase não disponível para carregar usuários');
      return Promise.resolve();
    }

    return _fbObj.getDoc(_fbObj.doc(_fbObj.db, 'config', 'usuarios'))
      .then(function(usrDoc) {
        if (usrDoc.exists() && usrDoc.data().data) {
          try {
            const usuarios = JSON.parse(usrDoc.data().data);
            if (Array.isArray(usuarios)) {
              globalScope.USUARIOS = usuarios;
              console.info('[users-state] ' + usuarios.length + ' usuários carregados');
            }
          } catch (err) {
            console.warn('[users-state] Erro ao parsear usuários:', err.message);
          }
        }
      })
      .catch(function(err) {
        console.warn('[users-state] Erro ao carregar usuários:', err.message);
      });
  };

  console.info('[users-state] Módulo carregado');

})(globalThis);
