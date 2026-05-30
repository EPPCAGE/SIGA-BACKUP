/**
 * @fileoverview Gestão de perfis e permissões de usuários
 * Módulo compartilhado entre processos.html e projetos.html
 * 
 * Exporta funções para verificação de perfis e acesso a módulos
 */

(function initUsersPermissions(globalScope) {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // PERFIS E LABELS
  // ══════════════════════════════════════════════════════════════

  /**
   * Labels descritivos dos perfis de usuário
   * @type {Object<string, string>}
   */
  globalScope.PERFIL_LABELS = {
    ep: globalScope.ORG_CONFIG?.epProfileLabel || 'Equipe de Processos',
    dono: 'Dono do Processo',
    gestor: 'Gestor / Adjunto',
    gerente_projeto: 'Projetos'
  };

  // ══════════════════════════════════════════════════════════════
  // FUNÇÕES DE VERIFICAÇÃO DE PERFIL
  // ══════════════════════════════════════════════════════════════

  /**
   * Retorna lista de perfis do usuário (suporta multi-perfil)
   * @param {Object} [u=usuarioLogado] - Usuário a verificar
   * @returns {string[]} Array de perfis
   */
  globalScope.getPerfisUsuario = function getPerfisUsuario(u) {
    u = u || globalScope.usuarioLogado;
    if (!u) return [];
    
    // Multi-perfil (array)
    if (Array.isArray(u.perfis) && u.perfis.length) {
      return [...new Set(u.perfis.map(p => String(p || '').trim()).filter(Boolean))];
    }
    
    // Perfil único (backward compatibility)
    return u.perfil ? [u.perfil] : [];
  };

  /**
   * Verifica se usuário possui um perfil específico
   * @param {string} perfil - Perfil a verificar
   * @param {Object} [u=usuarioLogado] - Usuário a verificar
   * @returns {boolean}
   */
  globalScope.hasPerfil = function hasPerfil(perfil, u) {
    return globalScope.getPerfisUsuario(u || globalScope.usuarioLogado).includes(perfil);
  };

  /**
   * Verifica se usuário é EP (Equipe de Processos)
   * @param {Object} [u=usuarioLogado] - Usuário a verificar
   * @returns {boolean}
   */
  globalScope.isEP = function isEP(u) {
    // Mantém compatibilidade com código legado que verifica perfil direto
    const usuario = u || globalScope.usuarioLogado;
    return usuario?.perfil === 'ep' || globalScope.hasPerfil('ep', usuario);
  };

  /**
   * Verifica se usuário é Dono (Dono do Processo)
   * @returns {boolean}
   */
  globalScope.isDono = function isDono() {
    return globalScope.hasPerfil('dono');
  };

  /**
   * Verifica se usuário é Gerente de Projeto
   * @returns {boolean}
   */
  globalScope.isGerenteProjeto = function isGerenteProjeto() {
    return globalScope.hasPerfil('gerente_projeto');
  };

  /**
   * Verifica se usuário é Solicitante (abre workflows, somente leitura no restante)
   * @returns {boolean}
   */
  globalScope.isSolicitante = function isSolicitante() {
    return globalScope.hasPerfil('solicitante');
  };

  // ══════════════════════════════════════════════════════════════
  // FUNÇÕES DE ACESSO A MÓDULOS
  // ══════════════════════════════════════════════════════════════

  /**
   * Verifica se usuário tem acesso ao módulo de Processos
   * @param {Object} [u] - Usuário a verificar
   * @returns {boolean}
   */
  globalScope.hasProcessosAccess = function hasProcessosAccess(u) {
    const perfis = globalScope.getPerfisUsuario(u || globalScope.usuarioLogado);
    return perfis.some(p => ['ep', 'dono', 'gestor'].includes(p));
  };

  /**
   * Verifica se usuário tem acesso ao módulo de Projetos
   * @param {Object} [u] - Usuário a verificar
   * @returns {boolean}
   */
  globalScope.hasProjetosAccess = function hasProjetosAccess(u) {
    const perfis = globalScope.getPerfisUsuario(u || globalScope.usuarioLogado);
    return perfis.some(p => ['ep', 'gestor', 'gerente_projeto'].includes(p));
  };

  // ══════════════════════════════════════════════════════════════
  // UTILITÁRIOS
  // ══════════════════════════════════════════════════════════════

  /**
   * Retorna texto descritivo dos perfis do usuário
   * @param {Object} user - Usuário
   * @returns {string} Perfis formatados (ex: "EP · Gestor")
   */
  globalScope._roleText = function _roleText(user) {
    const perfis = globalScope.getPerfisUsuario(user);
    if (perfis.length) {
      return perfis.map(p => globalScope.PERFIL_LABELS[p] || p).join(' · ');
    }
    // Fallback para perfil único
    return globalScope.PERFIL_LABELS[user?.perfil] || user?.perfil || '-';
  };

  console.info('[users-permissions] Módulo carregado');

})(globalThis);
