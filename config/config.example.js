// Copie este arquivo para config.local.js em desenvolvimento
// ou para config.deploy.js no ambiente publicado.
// Nao versionar chaves reais em repositorios publicos.
globalThis.CONFIG = {
  FIREBASE_API_KEY: '',
  AI_FUNCTION_URL: '',
  WORKFLOW_API_BASE_URL: '',
  // URL da Cloud Function checkEmail (público, sem auth).
  // Elimina a leitura pública do Firestore no fluxo de Primeiro Acesso.
  // Obtida após o primeiro deploy das Cloud Functions.
  CHECK_EMAIL_URL: '',
  // URL da Cloud Function setUserClaims (autenticada).
  // Define o Custom Claim {perfil} no token do usuário após o login,
  // permitindo que as regras do Firestore apliquem controle por perfil.
  SET_CLAIMS_URL: '',
  TENANCY: {
    // Manter false enquanto usa a base legada nas colecoes raiz do Firestore.
    // Ao ativar, os dados passam a usar caminhos como tenants/{tenantId}/processos.
    enabled: false,
    tenantId: 'cage-rs',
    dataRoot: 'tenants',
    environment: 'dev',
  },
  ORG: {
    systemName: 'SIGA 2.0',
    systemBrand: 'EP·CAGE',
    systemFullName: 'SIGA 2.0 — EP·CAGE',
    publicUrl: 'https://sigaepp.web.app/',
    organizationName: 'EPP/CAGE',
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
    domainProfiles: {
      'sefaz.rs.gov.br': 'ep',
      'cage.rs.gov.br': 'ep',
    },
    logos: {
      app: 'logo-siga.png',
      organization: 'epp-logo.png',
    },
  },
};
