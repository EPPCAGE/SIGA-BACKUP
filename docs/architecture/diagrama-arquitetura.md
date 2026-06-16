# Diagrama de Arquitetura — SIGA 2.0

Mapas visuais para onboarding técnico. Renderizam diretamente no GitHub e em qualquer editor Mermaid.

---

## 1. Topologia do sistema

Como as peças se conectam em produção.

```mermaid
graph TB
  subgraph Browser["🌐 Navegador (usuário)"]
    direction LR
    PH["processos.html\n~18 mil linhas"]
    PRJ["projetos.html\n~1.3 mil linhas"]
  end

  subgraph Shared["src/ — camadas compartilhadas"]
    direction TB
    TC["tenant-config.js\nresolução de paths"]
    OC["org-config.js\nbranding institucional"]
    FH_["firebase-helpers.js\ninit Firebase + refs"]
    FR["firestore-repositories.js\nacesso ao Firestore"]
    AC["processos/app-constants.js\nenums, labels, cores"]
    HUB["processos/module-hub-controller.js\nnavegação do hub"]
    SEC["processos/security-utils.js\nesc(), safeUrl()"]
  end

  subgraph Firebase["☁️ Firebase — Google Cloud"]
    FHOST["Firebase Hosting\narquivos estáticos"]
    FS["Cloud Firestore\nbanco de dados"]
    FAUTH["Firebase Auth\nautenticação"]
    CF["Cloud Functions\nPOST /ai"]
    SM["Secret Manager\nchave OpenAI, credenciais"]
  end

  subgraph Azure["☁️ Azure"]
    OAI["Azure OpenAI\nGPT-4o"]
  end

  FHOST -->|"serve"| PH
  FHOST -->|"serve"| PRJ
  PH -->|"usa"| Shared
  PRJ -->|"usa"| Shared
  FR -->|"SDK direto\nsem API intermediária"| FS
  PH -->|"login/logout"| FAUTH
  PH -->|"POST com Firebase token"| CF
  CF -->|"valida token"| FAUTH
  CF -->|"busca segredos"| SM
  CF -->|"prompt + contexto"| OAI
  OAI -->|"resposta JSON"| CF
  CF -->|"JSON"| PH
```

> **Ponto crítico para onboarding:** não existe API REST entre o frontend e o Firestore — o browser chama o Firestore diretamente via SDK. Toda a lógica de autorização fica nas `firestore.rules`. A única passagem por servidor é o proxy `/ai` na Cloud Function.

---

## 2. Módulos do frontend e suas coleções Firestore

Cada módulo de navegação, qual função o renderiza e quais coleções lê/escreve.

```mermaid
graph LR
  subgraph NAV["Navegação (go('página', btn))"]
    PROC["Processos\ngo('processos')"]
    SOL["Solicitações\ngo('solicitacoes')"]
    FAQ["FAQ\ngo('faq')"]
    PLANO["PAT\ngo('plano')"]
    AUD["Análise de Aderência\ngo('auditoria')"]
    PUB["Publicações\ngo('publicacoes')"]
  end

  subgraph FIRE["Coleções Firestore"]
    C1[("processos")]
    C2[("solicitacoes")]
    C4[("plano\nplano_metas")]
    C5[("publicacoes")]
    C6[("kpis")]
    C8[("relatorios_ind")]
    C9[("fluxos")]
    C10[("sessions")]
    C11[("config/usuarios\nconfig/ejs\nconfig/mapeados\netc.")]
  end

  PROC -->|"rDetalhe()\nrenderProcs()"| C1
  PROC --> C6
  PROC --> C9
  SOL -->|"rSolicitacoes()"| C2
  PLANO -->|"rPlano()"| C4
  AUD -->|"rAuditoria()"| C1
  PUB --> C5
  PROC --> C10
  PROC --> C11
  AUD --> C11
```

> **Atenção:** `processos` é a coleção mais acessada — armazena não só os dados básicos mas também todo o estado do mapeamento: etapas, formulários, reuniões, indicadores, POP, análise de aderência e histórico de acompanhamento. Um único documento pode ter centenas de campos.

---

## 3. Camada de dados — como o código acessa o Firestore

```mermaid
graph TD
  UI["UI (processos.html)"]

  subgraph Repos["src/shared/firestore-repositories.js"]
    RP["processosRepository"]
    RK["kpisRepository"]
    RS["solicitacoesRepository"]
    RPL["planoRepository / planoMetasRepository"]
    RPB["publicacoesRepository"]
    RRI["relatoriosIndicadoresRepository"]
    RF["fluxosRepository"]
    RSE["sessoesRepository"]
    RPJ["projetosRepository"]
    RPG["programasRepository"]
    RC["configRepository\n(config/usuarios, config/ejs, etc.)"]
  end

  subgraph FS["Cloud Firestore"]
    processos[("processos")]
    kpis[("kpis")]
    solicitacoes[("solicitacoes")]
    plano[("plano")]
    plano_metas[("plano_metas")]
    publicacoes[("publicacoes")]
    relatorios_ind[("relatorios_ind")]
    fluxos[("fluxos")]
    sessions[("sessions")]
    projPROJETOS[("projPROJETOS")]
    projPROGRAMAS[("projPROGRAMAS")]
    config[("config/{doc}")]
  end

  UI --> RP --> processos
  UI --> RK --> kpis
  UI --> RS --> solicitacoes
  UI --> RPL --> plano & plano_metas
  UI --> RPB --> publicacoes
  UI --> RRI --> relatorios_ind
  UI --> RF --> fluxos
  UI --> RSE --> sessions
  UI --> RPJ --> projPROJETOS
  UI --> RPG --> projPROGRAMAS
  UI --> RC --> config
```

> **Regra de desenvolvimento:** nenhuma nova chamada `.collection()` ou `.doc()` deve ser adicionada diretamente no HTML. Todo acesso novo ao Firestore deve passar pelos repositórios em `firestore-repositories.js`.

---

## 4. Fluxo de autenticação

```mermaid
sequenceDiagram
  participant U as Usuário
  participant App as processos.html
  participant FA as Firebase Auth
  participant FS as Firestore
  participant CF as Cloud Function /ai

  U->>App: acessa a URL
  App->>FA: onAuthStateChanged()
  alt não autenticado
    FA-->>App: null
    App->>U: exibe tela de login
    U->>App: e-mail + senha
    App->>FA: signInWithEmailAndPassword()
    FA-->>App: UserCredential (uid, email)
  else já autenticado
    FA-->>App: User (uid, email)
  end

  App->>FS: busca config/usuarios
  FS-->>App: {perfil, nome, ativo}
  Note over App: define isEP(), isDono(), isGestor()<br/>controla o que é exibido na UI

  App->>FS: lê/escreve coleções conforme perfil
  Note over FS: firestore.rules valida<br/>request.auth.uid e perfil

  U->>App: aciona análise com IA
  App->>FA: getIdToken()
  FA-->>App: JWT token
  App->>CF: POST /ai { _token, modo, dados }
  CF->>FA: verifyIdToken(token)
  FA-->>CF: uid validado
  CF->>FS: busca config/usuarios para checar perfil
  CF-->>App: resposta JSON da IA
```

---

## 5. Pipeline de mapeamento de processo

Fases e etapas que um processo percorre, com os perfis responsáveis.

```mermaid
graph LR
  subgraph ENT["Fase: Entendimento 🔵"]
    E1["Abertura\n(EP)"]
    E2["Reunião de\nentendimento\n(EP)"]
    E3["Quest. maturidade\n(Dono)"]
  end

  subgraph MOD["Fase: Modelagem 🟣"]
    M1["Esboço AS IS\n(EP)"]
    M2["Det. e Validação\nAS IS\n(Dono)"]
    M3["Identificação\nde riscos\n(EP)"]
    M4["Análise\ninteligente\n(EP)"]
    M5["Melhorias /\nTO BE\n(EP)"]
  end

  subgraph FORM["Fase: Formalização 🟠"]
    F1["Indicadores\n(EP)"]
    F2["Construção\nPOP\n(EP)"]
    F3["Aprov. Gestor\n(Gestor)"]
    F4["Publicação\n(EP)"]
  end

  subgraph OP["Fase: Operação 🟢"]
    O1["Acompanhamento\n(EP)"]
  end

  subgraph ADE["Fase: Análise de Aderência 🔴"]
    A1["Análise de\nAderência\n(EP)"]
  end

  E1 --> E2 --> E3 --> M1 --> M2 --> M3 --> M4 --> M5
  M5 --> F1 --> F2 --> F3 --> F4 --> O1 --> A1
```

---

## 6. Estrutura de arquivos — onde fica o quê

```mermaid
graph TD
  ROOT["siga2.0/"]

  ROOT --> PH2["processos.html\nMódulo principal — renderização,\nworkflow e lógica de negócio"]
  ROOT --> PRJ2["projetos.html\nMódulo de projetos"]
  ROOT --> CSS2["styles.css\nCSS compartilhado"]

  ROOT --> SRC["src/"]
  SRC --> SHARED["shared/\nReutilizável entre módulos"]
  SHARED --> TC2["tenant-config.js\npaths multi-tenant"]
  SHARED --> OC2["org-config.js\nbranding institucional"]
  SHARED --> FH2["firebase-helpers.js\ninit Firebase"]
  SHARED --> FR2["firestore-repositories.js\nacesso ao Firestore"]

  SRC --> SPROC["processos/\nExtrações do monolito"]
  SPROC --> AC2["app-constants.js\nPERFIL, STATUS, REUNIAO_TIPOS..."]
  SPROC --> HUB2["module-hub-controller.js\nhub de navegação"]
  SPROC --> SEC2["security-utils.js\nesc(), safeUrl()"]
  SPROC --> STO["storage-utils.js\nlocalStorage seguro"]
  SPROC --> ORG2["org-branding.js\naplicação de branding na UI"]

  ROOT --> FUNC["functions/\nCloud Functions"]
  FUNC --> IDX["index.js\nProxy Azure OpenAI\nmodos: analisar_bpmn, gerar_pop,\nassistente, relatorio_auditoria..."]

  ROOT --> CONFIG["config/"]
  CONFIG --> CEXAMPLE["config.example.js\nTemplate — copiar para config.local.js"]

  ROOT --> RULES["firestore.rules\nstorage.rules"]
  ROOT --> TESTS["tests/e2e/\nPlaywright"]
  ROOT --> TOOLS["tools/\nmigrações e scripts"]
  ROOT --> DOCS["docs/\nArquitetura, deploy, segurança"]
```

---

## Referências rápidas

| O que encontrar | Onde procurar |
|---|---|
| Enums de perfil, status, cores | `src/processos/app-constants.js` |
| Inicialização do Firebase | `src/shared/firebase-helpers.js` |
| Qualquer acesso ao Firestore | `src/shared/firestore-repositories.js` |
| Branding (nome do órgão, logo) | `src/shared/org-config.js` + `config/config.local.js` |
| Sanitização de HTML/URL | `src/processos/security-utils.js` — `esc()` e `safeUrl()` |
| Funções de renderização de página | `processos.html` — buscar `function r` ou `function render` |
| Regras de segurança Firestore | `firestore.rules` |
| Deploy CI/CD | `.github/workflows/firebase-deploy.yml` |
| Como configurar localmente | `SETUP_LOCAL.md` + `config/README.md` |
| Dívidas técnicas e roadmap | `docs/architecture/` |
