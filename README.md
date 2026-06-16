# EP·CAGE — Sistema Integrado de Gestão Estratégica e Alinhamento

Sistema web para mapeamento, auditoria e gestão estratégica de processos e projetos institucionais da CAGE/Sefaz-RS, com integração de IA (Azure OpenAI via Firebase Cloud Functions) e persistência em Firestore.

Para entender a organização técnica atual, comece por [`docs/architecture/index.md`](docs/architecture/index.md).

---

## Módulos

O sistema possui dois módulos independentes acessados a partir de um hub central:

| Módulo | Arquivo | Perfis com acesso |
|--------|---------|-------------------|
| **SIGA Processos** | `processos.html` | EP, Dono de Processo, Gestor |
| **SIGA Projetos** | `projetos.html` | EP, Gerente de Projeto |

Usuários com perfil `ep` têm acesso total a ambos os módulos. Usuários podem ter múltiplos perfis simultaneamente (ex.: Dono de Processo + Gerente de Projeto).

### Funcionalidades do SIGA Processos

| Seção | Perfis | Descrição |
|-------|--------|-----------|
| Fila de tarefas | Todos | Tarefas pendentes do usuário logado na pipeline |
| Painel geral | Todos | Dashboard com pipeline, pendências e resumo |
| Processos em andamento | Todos | Lista de processos em mapeamento |
| Arquitetura de processos | Todos | Macroprocesso → Processo → Subprocesso |
| Indicadores (KPIs) | Todos | KPIs com filtros, importação xlsx e sincronização com Google Sheets |
| FAQ | Todos | Perguntas e respostas frequentes |
| PAT | EP | Plano Anual de Trabalho — atividades por trimestre |
| Auditoria | EP | Auditorias de conformidade por processo |
| Metodologias | Todos | Publicações e documentos do EP |
| Notificações | Todos | Histórico de notificações e config EmailJS |
| Administração | EP | Cadastro de usuários, perfis e vínculos |
| Avisos | EP | Gerenciamento de avisos institucionais |

---

## Perfis de Usuário

| Perfil | Código | Módulo | Descrição |
|--------|--------|--------|-----------|
| Escritório de Processos | `ep` | Ambos | Acesso total a todos os módulos e funcionalidades |
| Dono de Processo | `dono` | SIGA Processos | Vê apenas processos onde é dono ou interessado |
| Gestor / Adjunto | `gestor` | SIGA Processos | Acesso de leitura + etapas de aprovação |
| Gerente de Projeto | `gerente_projeto` | SIGA Projetos | Visualização e edição de tarefas delegadas |

Um mesmo usuário pode ter múltiplos perfis. O campo `perfis` no Firestore armazena um array; o campo legado `perfil` mantém o primeiro perfil para retrocompatibilidade.

### Perfis padrão para novos usuários

Usuários que se auto-cadastram pelo "Primeiro acesso" recebem automaticamente os perfis **Dono de Processo + Gerente de Projeto**, dando acesso a ambos os módulos desde o início. O EPP pode ajustar os perfis a qualquer momento pelo painel de administração.

### Primeiro acesso e troca de senha obrigatória

Usuários criados pelo sistema (tanto pelo EPP quanto por auto-cadastro) recebem `trocar_senha: true`. Ao fazer login com a senha temporária, um modal bloqueia o acesso aos módulos e exige apenas a **definição de uma senha definitiva** (mínimo 6 caracteres). Os perfis já estão atribuídos e não precisam ser selecionados pelo usuário.

O hub de módulos só é exibido após essa etapa.

---

## Pipeline de Mapeamento

Cada processo percorre as seguintes etapas na ordem:

```
abertura → reuniao → riscos → questionario → esboco → det_etapas
→ analise_asis → valid_dono → desenho_final → aprovacao → pop
→ complement → apresentacao → publicacao → acompanha → auditoria
```

| Etapa | Fase | Responsável |
|-------|------|-------------|
| Abertura | Entendimento | EP |
| Reunião de entendimento (SIPOC) | Entendimento | EP |
| Identificação de riscos | Entendimento | EP |
| Questionário de maturidade | Entendimento | Dono |
| Esboço AS IS / TO BE | Modelagem | EP |
| Detalhamento de etapas | Modelagem | EP |
| Análise AS IS | Modelagem | EP |
| Validação com dono | Modelagem | Dono |
| Desenho final | Modelagem | EP |
| Aprovação | Formalização | EP |
| Construção POP | Formalização | EP |
| Complemento do dono | Formalização | Dono |
| Aprovação do patrocinador | Formalização | Patrocinador |
| Publicação | Formalização | EP |
| Acompanhamento | Operação | EP |
| Auditoria | Operação | EP |

---

## Indicadores (KPIs)

### Origens

| Origem | Descrição |
|--------|-----------|
| `manual` | Criado diretamente na interface |
| `importado` | Importado via arquivo `.xlsx` |
| `importado_editado` | Importado via xlsx e editado manualmente — não sobrescrito em re-importações |
| `gsheets` | Sincronizado via Google Sheets |
| `gsheets_editado` | Sincronizado via Google Sheets e editado manualmente — não sobrescrito em re-sincronizações |

### Regras de persistência

- Ao editar qualquer campo de um indicador importado ou sincronizado, a origem é promovida para `importado_editado` ou `gsheets_editado`.
- Re-importações e re-sincronizações ignoram períodos já promovidos, preservando edições manuais.
- **Limpar importados** remove `importado` e `gsheets`/`gsheets_editado`, mas mantém `importado_editado` e `manual`.

### Indicadores PPE

Indicadores marcados como PPE (Produto ou Processo Estratégico) recebem a etiqueta **PPE** no relatório PDF executivo.

### Relatório PDF

Gerado a partir da análise de IA, exibe:
- Cards de taxa de atingimento por área
- Comentário executivo gerado por IA
- Tabela de indicadores ordenada por Área → Nome → Período (cronológico), com etiqueta PPE

---

## Integrações de IA (Azure OpenAI)

A Cloud Function `functions/index.js` expõe o endpoint `/ai` com os seguintes modos:

| Modo | Uso |
|------|-----|
| `analisar_bpmn` | Analisa XML BPMN e retorna JSON com gargalos, oportunidades e complexidade |
| `gerar_pop` | Gera texto estruturado de POP a partir das etapas do processo |
| `assistente` | Assistente geral de gestão de processos (inclui geração de riscos) |
| `analisar_indicadores` | Comentário analítico executivo sobre KPIs (base para o relatório PDF) |
| `gerar_ppt` | Gera JSON para apresentação PowerPoint executiva |
| `extrair_pop` | Extrai metadados de um POP existente |
| `relatorio_auditoria` | Gera relatório executivo de auditoria em JSON |
| `gerar_questoes` | Gera lista de questões de auditoria com base no escopo |
| `gerar_faq` | Gera FAQ do processo para publicação |

Todas as chamadas requerem um Firebase ID token no campo `_token` do body (verificado no servidor).

---

## Persistência — Firestore

| Coleção | Conteúdo |
|---------|----------|
| `processos/{id}` | Dados completos de cada processo em mapeamento |
| `kpis/{id}` | Indicadores de desempenho (origem, meta, realizado, vínculo com processo) |
| `publicacoes/{id}` | Metodologias e documentos publicados |
| `plano/{id}` | Atividades do Plano Anual de Trabalho (PAT) |
| `config/arquitetura` | JSON da arquitetura de processos (macros/processos/subprocessos) |
| `config/usuarios` | Cadastro de usuários e perfis |
| `config/mapeados` | Set de processos marcados como mapeados manualmente |
| `config/criticos` | Set de processos marcados como críticos manualmente |
| `config/ejs` | Credenciais EmailJS para envio de notificações |
| `config/last_modified` | Sentinela de edição simultânea — atualizado a cada `fbSaveAll()` |

### Detecção de edição simultânea

Ao carregar os dados (`fbLoad`), o sistema registra o timestamp local. A cada salvamento, o documento `config/last_modified` é atualizado com o timestamp e o e-mail do usuário que salvou. Um listener `onSnapshot` em todas as sessões abertas detecta atualizações externas: se o timestamp remoto for mais recente que o carregamento local, um banner de alerta é exibido permitindo recarregar do servidor ou manter os dados locais.

---

## Fluxo de Acesso e Gestão de Senhas

Esta seção descreve todos os cenários possíveis em linguagem simples.

---

### Cenário 1 — EPP cadastra um novo usuário pelo painel de administração

O EPP abre "Gerenciamento de usuários", preenche nome, e-mail, cargo e perfil e clica em **Salvar**.

O sistema:
1. Registra o usuário internamente com o perfil definido pelo EPP e a flag `trocar_senha`.
2. Cria automaticamente uma conta de autenticação para o usuário (sem intervenção manual).
3. Envia um e-mail com uma **senha temporária** gerada pelo sistema.

O usuário recebe o e-mail, entra com a senha temporária e é obrigado a definir uma senha definitiva antes de acessar qualquer módulo.

> **Se o e-mail já tiver uma conta ativa** (ex.: usuário foi cadastrado antes por outro caminho), o sistema salva os dados sem sobrescrever a senha existente e informa o EPP via toast.

---

### Cenário 2 — Usuário novo se auto-cadastra pelo "Primeiro acesso"

Usuário vai à tela de login, clica em **"Primeiro acesso / Esqueci minha senha"**, informa nome completo e e-mail institucional e clica em **Continuar**.

**Condição**: e-mail não está cadastrado no sistema.

O sistema:
1. Verifica se o domínio do e-mail é permitido (`sefaz.rs.gov.br` ou `cage.rs.gov.br`). Se não for, bloqueia com mensagem de erro.
2. Cria a conta de autenticação para o usuário.
3. Registra o usuário internamente com os perfis padrão: **Dono de Processo + Gerente de Projeto**.
4. Envia um e-mail com uma senha temporária.
5. Notifica os membros do EPP sobre o novo cadastro.

O usuário entra com a senha temporária e define sua senha definitiva na primeira sessão.

---

### Cenário 3 — Usuário está cadastrado, mas nunca entrou no sistema

Pode acontecer quando o usuário foi registrado por um EPP antes da melhoria que automatiza o envio de senha (cadastros antigos/manuais que não geraram e-mail).

O usuário vai à tela de login, clica em **"Primeiro acesso / Esqueci minha senha"**, informa o e-mail e clica em **Continuar**.

**Condição**: e-mail está no cadastro interno, mas nunca teve uma conta de autenticação criada.

O sistema:
1. Detecta que o e-mail está cadastrado mas não tem conta de autenticação.
2. Cria a conta de autenticação.
3. Envia um e-mail com uma **senha temporária** (não um link de redefinição, para evitar o erro de "link expirado").
4. Marca o usuário para troca de senha no primeiro acesso.

O usuário entra com a senha temporária e define sua senha definitiva.

---

### Cenário 4 — Usuário esqueceu a senha

O usuário vai à tela de login, clica em **"Primeiro acesso / Esqueci minha senha"**, informa o e-mail e clica em **Continuar**.

**Condição**: e-mail está cadastrado e já tem conta de autenticação ativa (usuário já entrou antes).

O sistema envia um **link de redefinição de senha** para o e-mail. O usuário clica no link, define uma nova senha na página do Firebase e volta a fazer login normalmente.

> O botão "Continuar" fica desabilitado durante o envio para evitar múltiplos cliques — cada novo envio invalida o link anterior.

---

### Cenário 5 — Login normal

Usuário informa e-mail e senha na tela de login e clica em **Entrar**.

O sistema verifica as credenciais. Se estiverem corretas:

- **Usuário com `trocar_senha` ativo** → exibe o modal de troca de senha. O usuário define uma senha definitiva e só então acessa os módulos.
- **Usuário sem `trocar_senha`** → acesso direto ao hub de módulos.

---

### Cenário 6 — Credenciais incorretas

O usuário informa e-mail ou senha errados.

O sistema exibe a mensagem de erro correspondente:

| Situação | Mensagem exibida |
|----------|-----------------|
| E-mail não encontrado | "E-mail ou senha incorretos." |
| Senha errada | "E-mail ou senha incorretos." |
| Muitas tentativas seguidas | "Acesso temporariamente bloqueado. Tente novamente mais tarde." |

---

### Cenário 7 — Usuário bloqueado pelo EPP

O EPP pode bloquear um usuário pelo painel de administração. Quando um usuário bloqueado tenta fazer login:

1. A autenticação no Firebase é aceita normalmente.
2. O sistema verifica o campo `bloqueado` no cadastro interno.
3. A sessão é encerrada imediatamente e exibe a mensagem: **"Seu acesso foi bloqueado. Entre em contato com o EPP."**

O usuário não acessa nenhum módulo. O EPP pode desbloquear a qualquer momento pelo mesmo painel.

---

### Cenário 8 — Conta Firebase existe, mas usuário não está no cadastro interno

Pode ocorrer em situações excepcionais (ex.: conta criada diretamente no console do Firebase sem passar pelo sistema).

O sistema detecta que o usuário autenticado não está na lista interna, encerra a sessão automaticamente e exibe: **"Acesso não autorizado. Solicite cadastro ao EPP."**

---

### Cenário 9 — Domínio de e-mail não permitido

Ao tentar se auto-cadastrar com um e-mail de domínio não institucional, o sistema bloqueia imediatamente com a mensagem de quais domínios são aceitos, sem criar nenhuma conta.

Domínios aceitos: `sefaz.rs.gov.br` e `cage.rs.gov.br`.

---

### Cenário 10 — EPP edita um usuário existente

O EPP abre o painel, clica em **Editar** em um usuário já cadastrado, altera os dados (nome, cargo, perfil, vínculos) e salva.

O sistema atualiza apenas os dados cadastrais internos. **A senha do usuário não é alterada.** Se o usuário estiver logado no momento, o nome e o perfil exibidos na barra lateral são atualizados em tempo real.

---

### Cenário 11 — EPP remove um usuário

O EPP clica em **Editar** e depois em **Remover usuário**.

O sistema remove o usuário do cadastro interno. A conta de autenticação no Firebase **não é excluída automaticamente** — o usuário não conseguirá mais acessar o sistema (será bloqueado pelo Cenário 8), mas a conta de autenticação permanece no Firebase. Para exclusão completa da conta de autenticação, é necessário acessar o console do Firebase.

> O EPP logado não pode remover a própria conta.

---

### Resumo visual

```
Tela de login
│
├── [Entrar com e-mail + senha]
│   ├── Credenciais corretas
│   │   ├── Usuário bloqueado          → Acesso negado (Cenário 7)
│   │   ├── trocar_senha = true        → Modal de troca de senha (Cenário 5)
│   │   ├── Usuário não no cadastro    → Acesso negado (Cenário 8)
│   │   └── Login normal               → Hub de módulos (Cenário 5)
│   └── Credenciais incorretas         → Mensagem de erro (Cenário 6)
│
└── [Primeiro acesso / Esqueci minha senha]
    ├── E-mail não permitido           → Bloqueado (Cenário 9)
    ├── E-mail não cadastrado          → Auto-cadastro + senha temp (Cenário 2)
    ├── E-mail cadastrado, sem conta   → Cria conta + senha temp (Cenário 3)
    └── E-mail cadastrado, com conta   → Link de redefinição (Cenário 4)

Painel de administração (EPP)
├── Novo usuário                       → Cria conta + senha temp (Cenário 1)
├── Editar usuário                     → Atualiza dados (Cenário 10)
├── Remover usuário                    → Remove do cadastro (Cenário 11)
└── Bloquear/Desbloquear              → Alterna flag bloqueado (Cenário 7)
```

---

## Segurança e UX

- **Auto-logout**: sessão encerrada automaticamente após 5 minutos de inatividade. Um aviso aparece 30 segundos antes, com opção de continuar conectado.
- **Primeiro acesso**: modal obrigatório bloqueia o hub até que o usuário defina senha definitiva.
- **Controle de acesso por módulo**: o hub exibe apenas os cards dos módulos acessíveis ao perfil do usuário; tentativas de acesso direto via código são bloqueadas.

---

## Estrutura do Projeto

```
siga2.0/
├── processos.html           # SIGA Processos — front-end completo (~15 000 linhas)
├── projetos.html            # SIGA Projetos — front-end completo (~1 200 linhas)
├── projetos-logic.js        # Lógica exclusiva do módulo de projetos
├── styles.css               # CSS compartilhado
├── fonts/                   # Fontes woff2 e fonts.css
├── logo-siga.png            # Logo da aplicação
├── functions/
│   ├── index.js             # Cloud Function (Azure OpenAI proxy com auth)
│   ├── package.json         # Dependências das functions
│   └── package-lock.json
├── firebase.json            # Configuração Firebase Hosting + Firestore + Functions
├── firestore.rules          # Regras de segurança do Firestore
├── .firebaserc              # ID do projeto Firebase
├── sonar-project.properties # Configuração SonarCloud
├── package.json             # Scripts de QA/testes locais
├── config/
│   ├── config.example.js    # Modelo público de configuração
│   └── README.md            # Orientações de configuração por ambiente
├── docs/
│   ├── baseline/            # Pontos de controle funcionais
│   ├── configuration/       # Parametrizacao institucional
│   ├── deployment/          # Checklists de implantação
│   ├── architecture/         # Plano de modularização, camadas e arquitetura
│   └── security/             # Modelo de membros e regras exemplo tenant/seguro
├── src/
│   ├── shared/              # Código compartilhado entre módulos
│   │   ├── tenant-config.js # Configuração de ambiente e tenant
│   │   ├── org-config.js    # Configuração institucional compartilhada
│   │   ├── firebase-helpers.js # Helpers Firebase/Firestore tenant-aware
│   │   └── firestore-repositories.js # Repositórios Firestore por domínio
│   └── processos/           # Módulos extraídos gradualmente do SIGA Processos
│       ├── app-constants.js # Labels, cores e enums centrais
│       ├── module-hub-controller.js # Controller do hub de módulos
│       ├── org-branding.js # Aplicação da identidade institucional no módulo
│       ├── security-utils.js # Escape de HTML e validação de URLs
│       └── storage-utils.js # Utilitários seguros de armazenamento local
├── tests/
│   └── e2e/                 # Smoke tests e simulações Playwright
├── tools/
│   └── migrate-firestore-tenant.mjs # Plano/migração Firestore para tenants
└── .github/
    └── workflows/
        ├── firebase-deploy.yml  # Deploy para Firebase Hosting
        └── codeql.yml           # Análise estática de segurança
```

---

## Deploy

### Firebase Hosting (produção)

Push para `main` → workflow `firebase-deploy.yml` executa automaticamente:
1. Injeta credenciais dos Secrets do GitHub em `processos.html`
2. Publica em: `https://sigaepp.web.app`

**Secrets necessários no GitHub** (`Settings → Secrets and variables → Actions`):

| Secret | Descrição |
|--------|-----------|
| `FIREBASE_API_KEY` | Chave API do Firebase |
| `AI_FUNCTION_URL` | URL da Cloud Function (Azure OpenAI proxy) |

### Cloud Functions

```bash
cd functions
firebase deploy --only functions --project=gesproc2
```

**Secrets necessários no Firebase** (Google Cloud Secret Manager):

| Secret | Descrição |
|--------|-----------|
| `AZURE_OPENAI_KEY` | Chave da API Azure OpenAI |
| `AZURE_OPENAI_ENDPOINT` | Endpoint Azure (ex: `https://xxx.openai.azure.com`) |
| `AZURE_OPENAI_DEPLOYMENT` | Nome do deployment (ex: `gpt-4o`) |

---

## Desenvolvimento Local

Veja `SETUP_LOCAL.md` para instruções completas.

```bash
# Terminal 1 — Firebase Emulator (Firestore)
firebase emulators:start --project=gesproc2

# Terminal 2 — Servidor HTTP
python -m http.server 3000
```

Acesse: `http://localhost:3000/processos.html`

---

## Tecnologias

- **Firebase Firestore** — banco de dados NoSQL em tempo real
- **Firebase Hosting** — hospedagem estática com CDN
- **Firebase Auth** — autenticação de usuários
- **Azure OpenAI** — modelos de linguagem para análise e geração de conteúdo
- **BPMN.js** — modelagem de diagramas de processo
- **Chart.js** — gráficos de indicadores
- **EmailJS** — envio de notificações por e-mail
- **XLSX.js** — importação de planilhas
- **PptxGenJS** — exportação de apresentações PowerPoint
- **Mammoth.js** — leitura de documentos Word (.docx)

---

## Segurança

- Nenhuma credencial commitada no repositório
- Secrets gerenciados via GitHub Actions e Google Cloud Secret Manager
- `config/config.local.js` e `config/config.deploy.js` reais ignorados pelo Git
- CORS restrito às origens permitidas na Cloud Function
- Firebase ID token verificado no servidor antes de cada chamada de IA
- Firestore Rules restringem leitura/escrita por autenticação

---

Interno — CAGE/Sefaz-RS
