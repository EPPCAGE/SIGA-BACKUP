(function initOrgConfig(globalScope) {
  const defaultConfig = Object.freeze({
    systemName: 'SIGA 2.0',
    systemBrand: 'EP·CAGE',
    systemFullName: 'SIGA 2.0 — EP·CAGE',
    publicUrl: 'https://sigaepp.web.app/',
    organizationName: 'Sistema Integrado de Gestão Estratégica',
    institutionName: 'CAGE/Sefaz-RS',
    officeName: 'Escritório de Processos',
    projectOfficeName: 'Escritório de Projetos da CAGE',
    reportHeaderLabel: 'CAGE-RS · ESCRITÓRIO DE PROJETOS E PROCESSOS',
    processPresentationFooter: 'EP·CAGE — Escritório de Processos — CAGE/Sefaz-RS',
    processPresentationClosingMessage: 'Processo mapeado e documentado pela EP·CAGE.',
    processPresentationClosingFooter: 'EP·CAGE — Gestão de Processos Institucionais',
    indicatorReportOrgLabel: 'EP·CAGE · Escritório de Processos',
    indicatorReportFooter: 'Gerado pelo sistema SIGA 2.0 — EP·CAGE/Sefaz-RS',
    supportTeamLabel: 'EPP',
    epProfileLabel: 'EPP',
    epTeamName: 'Equipe EP',
    epTeamEmail: 'epp.cage@sefaz.rs.gov.br',
    notificationFromName: 'EP·CAGE',
    noreplySuggestion: 'noreply.ep@sefaz.rs.gov.br',
    automaticEmailFooter: 'Este é um e-mail automático do EPP — CAGE/Sefaz-RS.',
    localEpEmail: 'ep@sefaz.rs.gov.br',
    loginEmailPlaceholder: 'usuario@sefaz.rs.gov.br',
    supportPortalUrl: 'https://atendimentocage.sefaz.rs.gov.br/',
    supportPortalLabel: 'Portal e-CAGE',
    allowedDomains: ['sefaz.rs.gov.br', 'cage.rs.gov.br'],
    domainProfiles: { 'sefaz.rs.gov.br': 'ep', 'cage.rs.gov.br': 'ep' },
    logos: {
      app: 'logo-siga.png',
      organization: 'epp-logo.png',
    },
  });

  function buildOrgConfig() {
    const incoming = globalScope.CONFIG?.ORG;
    return {
      ...defaultConfig,
      ...incoming,
      allowedDomains: Array.isArray(incoming?.allowedDomains) ? incoming.allowedDomains : defaultConfig.allowedDomains,
      domainProfiles: { ...defaultConfig.domainProfiles, ...incoming?.domainProfiles },
      logos: { ...defaultConfig.logos, ...incoming?.logos },
    };
  }

  globalScope.ORG_CONFIG_DEFAULT = defaultConfig;
  globalScope.ORG_CONFIG = buildOrgConfig();
})(globalThis);
