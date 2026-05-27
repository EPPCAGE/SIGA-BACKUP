# Arquitetura-Alvo do SIGA 2.0

**Data:** 2026-05-27  
**Revisão:** 2026-05-27 — incorpora migração para banco SQL  
**Status:** Referência oficial de evolução arquitetural  
**Leitura prévia recomendada:** `index.md`, `PLANO-MODULARIZACAO.md`, `frontend-backend-roadmap.md`

---

## 1. Diagnóstico do estado atual

### O que já funciona bem

| Aspecto | Situação |
|---|---|
| Hosting / Firestore / Auth | Firebase consolidado, sem débito |
| Proxy IA | Cloud Function autenticada, segredos no Secret Manager |
| Camada de repositórios | `src/shared/firestore-repositories.js` centraliza acessos |
| Tenant-config | Infraestrutura pronta, desligada por compatibilidade |
| Custom Claims | `isEP()` operacional nas regras Firestore (PR #508) |
| Branding institucional | `ORG_CONFIG` desacopla textos e logos do código |
| CI/CD | GitHub Actions com deploy automático e análise CodeQL |
| Testes E2E | Playwright cobrindo smoke, projetos e mapeamento |

### Débitos técnicos críticos

| # | Débito | Risco | Impacto |
|---|--------|-------|---------|
| D1 | `processos.html` monolítico (~18 mil linhas) | Alto | Onboarding lento, risco de regressão em qualquer mudança |
| D2 | Lógica de negócio crítica no cliente (aprovação, conversão, exclusão) | Alto | Bypass de regra possível via DevTools |
| D3 | Dados de negócio em Firestore (sem suporte a queries analíticas, joins, BI) | Alto | Relatórios complexos impossíveis; cessão exige ETL manual |
| D4 | Firestore rules sem validação de perfil para gestor/dono | Alto | Qualquer autenticado pode gravar KPIs, solicitações |
| D5 | Sem log de auditoria server-side | Médio | Rastreabilidade zero para ações sensíveis |
| D6 | `processos.html` usa `<script type="module">` isolado + IIFE globais em paralelo | Médio | Impossibilita tree-shaking e bundling sem quebrar handlers inline |
| D7 | TENANCY desligado em produção | Médio | Impossibilita cessão a outros órgãos sem migração |
| D8 | Sem testes unitários — só E2E | Médio | Regressões em utilitários não são detectadas |
| D9 | CSS inline em 95% dos componentes | Baixo | Impossibilita redesign sem varrer todo o HTML |

---

## 2. Arquitetura-alvo (visão de destino)

O banco de dados de negócio migra do **Firestore para Cloud SQL (PostgreSQL)**.
O Firestore permanece apenas para o que é genuinamente "tempo real":
sessões de login, notificações push e edição concorrente de BPMN.
Todo dado de negócio (processos, KPIs, projetos, metas etc.) vai para SQL.
O cliente nunca acessa o banco SQL diretamente — apenas via Cloud Functions (API).

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENTE (Browser)                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                         │
│  │  src/processos/  │  │  src/projetos/   │  ← ES modules           │
│  │   (módulos ES)   │  │   (módulos ES)   │    sem onclick inline   │
│  └────────┬─────────┘  └────────┬─────────┘                         │
│           └──────────┬──────────┘                                   │
│                 src/shared/                                         │
│          auth · api-client · tenant · utils                         │
│                      │                                              │
│         Firebase Auth SDK  (apenas autenticação)                    │
│         Firebase SDK       (apenas sessões + notifs em real-time)   │
└──────────────────────┼──────────────────────────────────────────────┘
                       │ HTTPS + Bearer token (Firebase Auth JWT)
┌──────────────────────┼──────────────────────────────────────────────┐
│  CLOUD FUNCTIONS (API REST — Node 20)                               │
│                      │                                              │
│   /api/processos     │  /api/kpis    /api/projetos  /api/solicit.  │
│   /api/arquitetura   │  /api/plano   /api/trilhas   /api/audit     │
│   /admin/*           │  /actions/*   /reports/*     /ai            │
│                      │                                              │
│   middleware: verificar token → resolver tenant → autorizar papel   │
│                      │                                              │
└──────────────────────┼──────────────────────────────────────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
┌────────▼────────┐        ┌──────────▼──────────┐
│  Cloud SQL      │        │  Firestore           │
│  (PostgreSQL)   │        │  (tempo real apenas) │
│                 │        │                      │
│  Dados de       │        │  sessions/{uid}      │
│  negócio por    │        │  notifs/{id}         │
│  tenant         │        │  bpmn_locks/{id}     │
│  (ver seção 6)  │        │  (edição concorrente)│
└─────────────────┘        └──────────────────────┘
         │
┌────────▼────────┐  ┌───────────────┐  ┌──────────────────────┐
│  Cloud Storage  │  │ Firebase Auth │  │  Secret Manager      │
│  (arquivos por  │  │ + Custom      │  │  (chaves externas)   │
│   tenant)       │  │   Claims      │  │                      │
└─────────────────┘  └───────────────┘  └──────────────────────┘
         │
┌────────▼────────────────────────────────────────┐
│  EXTERNO                                         │
│  Azure OpenAI · EmailJS · Google Docs (BPMN)    │
└──────────────────────────────────────────────────┘
```

### Por que Cloud SQL (PostgreSQL)?

| Critério | Firestore | Cloud SQL PostgreSQL |
|---|---|---|
| Queries analíticas (KPIs, dashboards) | Limitado — sem agregação nativa | Nativo — GROUP BY, window functions |
| Relatórios com joins | Impossível nativamente | Nativo |
| Ferramentas de BI (Metabase, Looker) | Conector limitado | Conector nativo |
| Exportação para órgãos (cessão) | JSON/API | Dump SQL padrão |
| LGPD — exclusão granular | Por documento | Por linha, com CASCADE |
| Transações entre coleções | Limitado | ACID completo |
| Custo em escala | Por leitura/escrita | Por hora de instância |
| Curva de aprendizado da equipe | Alta (NoSQL) | Baixa (SQL é universal) |
| Multi-tenant | Por prefixo de coleção | Por `tenant_id` + RLS |

---

## 3. Camadas do frontend (estado-alvo)

### 3.1 Hierarquia de camadas

```
config/                       ← injetada pelo CI antes do deploy
src/shared/
  ├── org-config.js            ← identidade institucional (já existe)
  ├── tenant-config.js         ← tenant ID e ambiente (já existe)
  ├── api-client.js            ← NOVO: cliente HTTP para a API REST
  │     fetch + token Firebase + retry + error handling
  ├── firebase-helpers.js      ← refs Firestore (apenas sessões/notifs)
  ├── auth/
  │   ├── auth-controller.js   ← login/logout (já existe)
  │   └── auth-state.js        ← estado reativo do usuário logado
  ├── users/
  │   ├── users-permissions.js ← isEP(), isDono() (já existe)
  │   └── users-state.js       ← cache de usuários (já existe)
  └── navigation/
      └── navigation-controller.js ← hub (já existe)
src/processos/
  ├── [módulos existentes — ver seção 5]
  └── [módulos a extrair — ver seção 5]
src/projetos/                 ← extração futura de projetos-logic.js
```

> **Mudança importante:** `firestore-repositories.js` é substituído
> progressivamente por `api-client.js` à medida que cada coleção migra
> para SQL. Ao final da migração, o Firestore é chamado apenas para
> sessões e notificações em tempo real.

### 3.2 api-client.js — contrato

```javascript
// src/shared/api-client.js
const API_BASE = CONFIG.API_BASE_URL; // e.g. https://api-xxx.a.run.app

async function apiGet(path, params = {}) { ... }
async function apiPost(path, body) { ... }
async function apiPut(path, body) { ... }
async function apiDelete(path) { ... }

// Injeta automaticamente:
// - Authorization: Bearer <Firebase ID token>
// - X-Tenant-Id: <tenantId do CONFIG>
// - Content-Type: application/json
```

### 3.3 Regra de dependência entre camadas

```
config → shared → processos|projetos → HTML
```

- `src/shared/` não importa nada de `src/processos/` nem `src/projetos/`.
- Módulos de processos não importam módulos de projetos (e vice-versa).
- Comunicação entre módulos distintos só via event bus ou `globalThis` explícito.
- **Nunca chamar Firestore diretamente para dados de negócio** — usar `api-client.js`.
- Firestore direto do cliente: apenas `sessions/` e `notifs/`.

### 3.4 Convenção de módulo

Cada módulo em `src/processos/{modulo}/` segue o padrão:

```
{modulo}-state.js        ← estado imutável/local (dados em memória)
{modulo}-api.js          ← chama api-client; retorna objetos do domínio
{modulo}-controller.js   ← lógica: recebe evento, chama api, emite resultado
{modulo}-renderer.js     ← gera HTML a partir do estado (sem efeitos colaterais)
{modulo}-types.js        ← constantes, labels, enums do módulo
```

O renderer não acessa API. O controller não monta HTML. Essa separação
permite testar unitariamente cada peça.

---

## 4. Camadas do backend — API REST via Cloud Functions

### 4.1 Endpoints planejados

| Grupo | Endpoint | Método | Papel mínimo | Prioridade |
|---|---|---|---|---|
| **IA** | `/ai` | POST | Autenticado | ✅ Existe |
| **Processos** | `/api/processos` | GET, POST | Autenticado | 🔴 Alta |
| | `/api/processos/:id` | GET, PUT, DELETE | EP/Dono | 🔴 Alta |
| **Arquitetura** | `/api/arquitetura` | GET, POST, PUT, DELETE | EP | 🔴 Alta |
| **KPIs** | `/api/kpis` | GET, POST, PUT, DELETE | Autenticado | 🔴 Alta |
| **Projetos** | `/api/projetos` | GET, POST, PUT, DELETE | Autenticado | 🔴 Alta |
| **Solicitações** | `/api/solicitacoes` | GET, POST | Autenticado | 🔴 Alta |
| **Ações críticas** | `/actions/aprovar-solicitacao` | POST | EP/Gestor | 🔴 Alta |
| | `/actions/converter-aderencia` | POST | EP | 🔴 Alta |
| | `/actions/excluir-processo` | POST | EP | 🔴 Alta |
| | `/actions/importar-planilha` | POST | EP | 🟡 Média |
| **Admin** | `/admin/set-user-claims` | POST | EP | 🟡 Média |
| | `/admin/criar-usuario` | POST | EP | 🟡 Média |
| | `/admin/usuarios` | GET, PUT, DELETE | EP | 🟡 Média |
| **Relatórios** | `/reports/exportar-pdf` | POST | Autenticado | 🟡 Média |
| | `/reports/exportar-xlsx` | POST | EP | 🟡 Média |
| **Conteúdo** | `/api/trilhas`, `/api/publicacoes` | GET, POST, PUT | EP | 🟡 Média |
| | `/api/plano`, `/api/metas` | GET, POST, PUT | EP | 🟡 Média |
| **Notificações** | `/notifications/enviar` | POST | Autenticado | 🟢 Baixa |

### 4.2 Estrutura de functions/

```
functions/
  index.js                  ← router principal (já existe)
  src/
    middleware/
      auth.js               ← verificar token Firebase + extrair uid/perfil
      tenant.js             ← resolver e validar tenantId
      authorize.js          ← guard por papel (isEP, isGestor...)
      rate-limit.js         ← proteção contra abuso
      validate.js           ← validação de body com esquema
    api/
      processos.js           ← CRUD de processos (lê/grava Cloud SQL)
      arquitetura.js
      kpis.js
      projetos.js
      solicitacoes.js
      trilhas.js
      publicacoes.js
      plano.js
    actions/
      aprovar-solicitacao.js ← lógica de negócio + audit log
      converter-aderencia.js
      excluir-processo.js
      importar-planilha.js
    admin/
      set-user-claims.js
      usuarios.js
    reports/
      exportar-pdf.js
      exportar-xlsx.js
    notifications/
      enviar-email.js
    shared/
      db.js                  ← pool de conexão Cloud SQL (pg)
      audit-log.js           ← INSERT em audit_logs
      repositories/          ← queries SQL por domínio
        processos-repo.js
        kpis-repo.js
        projetos-repo.js
        ...
```

### 4.3 Padrão de resposta da API

```json
// Sucesso
{ "data": { ... }, "meta": { "total": 42, "page": 1 } }

// Erro
{ "error": { "code": "NOT_AUTHORIZED", "message": "Perfil insuficiente" } }
```

### 4.4 Padrão de audit log

Toda ação crítica grava em `audit_logs` (SQL) via `audit-log.js`:

```json
{
  "id": "uuid",
  "tenant_id": "cage-rs",
  "action": "aprovar_solicitacao",
  "uid": "uid-do-executor",
  "email": "executor@sefaz.rs.gov.br",
  "perfil": "ep",
  "target_table": "solicitacoes",
  "target_id": "uuid-da-solicitacao",
  "before": { },
  "after":  { },
  "ip": "...",
  "created_at": "2026-05-27T10:00:00Z"
}
```

A tabela `audit_logs` é **append-only** — sem UPDATE, sem DELETE —
garantido pela ausência de permissão no usuário do banco usado pelas Functions.

---

## 5. Mapa de modularização do processos.html

A modularização do frontend e a migração para SQL são independentes e
paralelas. A sequência abaixo recomenda coordenar as duas frentes:
ao extrair um módulo do monolito, aproveitar para migrar seu repositório
de Firestore para a API REST.

### FASE 0 — Código compartilhado ✅ Em andamento

| Módulo | Arquivo alvo | Status |
|---|---|---|
| Auth/Login | `src/shared/auth/auth-controller.js` | ✅ Extraído |
| Perfis/Permissões | `src/shared/users/users-permissions.js` | ✅ Extraído |
| Hub/Navegação | `src/shared/navigation/navigation-controller.js` | ✅ Extraído |
| Auto-logout | `src/processos/auto-logout.js` | ✅ Extraído |
| Edição concorrente | `src/processos/concurrent-edit.js` | ✅ Extraído |
| **API client** | `src/shared/api-client.js` | 🔲 Próximo passo |

### FASE 1 — Utilitários e conteúdo institucional

Módulos simples, sem regra de negócio complexa. Migração de Firestore → SQL junto.

| Módulo | Linhas est. | Arquivo alvo | Tabela SQL alvo |
|---|---|---|---|
| Avisos | ~400 | `src/processos/avisos/` | `avisos` |
| Trilhas de capacitação | ~800 | `src/processos/trilhas/` | `trilhas` |
| Backup/Restore JSON | ~300 | `src/processos/backup/` | (export de SQL) |
| Publicações/Metodologias | ~700 | `src/processos/publicacoes/` | `publicacoes` |

**Critério de conclusão:** `processos.html` abaixo de 15.000 linhas.

### FASE 2 — Gestão de dados

| Módulo | Linhas est. | Arquivo alvo | Tabela SQL alvo |
|---|---|---|---|
| Arquitetura (árvore) | ~1.000 | `src/processos/arquitetura/` | `macroprocessos`, `processos_arq` |
| KPIs/Indicadores | ~2.000 | `src/processos/kpis/` | `kpis`, `relatorios_ind` |
| PAT/Metas estratégicas | ~800 | `src/processos/pat/` | `plano`, `plano_metas` |
| Solicitações | ~1.200 | `src/processos/solicitacoes/` | `solicitacoes` |
| Admin de usuários | ~800 | `src/processos/admin-usuarios/` | `usuarios` |
| Dashboard/Painel | ~1.000 | `src/processos/dashboard/` | (views SQL) |

**Critério de conclusão:** `processos.html` abaixo de 9.000 linhas.

### FASE 3 — Mapeamento e IA (alto acoplamento)

| Módulo | Linhas est. | Arquivo alvo | Tabela SQL alvo |
|---|---|---|---|
| BPMN Editor | ~2.500 | `src/processos/bpmn/` | `processos` (campo `bpmn_xml`) |
| Etapa: Abertura | ~600 | `src/processos/etapas/abertura/` | `processos` |
| Etapa: Modelagem + IA | ~1.800 | `src/processos/etapas/modelagem/` | `processos` |
| Etapa: Formalização | ~1.200 | `src/processos/etapas/formalizacao/` | `processos` |
| Etapa: Operação | ~400 | `src/processos/etapas/operacao/` | `processos` |
| Etapa: Auditoria | ~600 | `src/processos/etapas/auditoria/` | `processos` |
| Geração de POP (PDF) | ~1.500 | `src/processos/geracao/pop/` | `processos` |
| Geração de PPT | ~800 | `src/processos/geracao/ppt/` | `processos` |
| Ciclo de vida | ~800 | `src/processos/ciclo-vida/` | `processos` |

**Critério de conclusão:** `processos.html` abaixo de 2.000 linhas.

### FASE 4 — Módulo Projetos

| Módulo | Linhas est. | Arquivo alvo | Tabela SQL alvo |
|---|---|---|---|
| Portfólio | ~800 | `src/projetos/portfolio/` | `projetos` |
| Programas | ~500 | `src/projetos/programas/` | `programas` |
| Cronograma/EAP | ~1.200 | `src/projetos/cronograma/` | `projeto_tarefas` |
| Indicadores | ~600 | `src/projetos/indicadores/` | `projeto_indicadores` |
| Status Report | ~1.800 | `src/projetos/relatorio/` | (views SQL) |
| Canvas/Reuniões | ~700 | `src/projetos/reunioes/` | `projeto_reunioes` |

**Critério de conclusão:** `projetos-logic.js` eliminado; `projetos.html` como bootstrap.

---

## 6. Schema SQL — Cloud SQL PostgreSQL

### 6.1 Convenções gerais

- Todas as tabelas têm `tenant_id TEXT NOT NULL` — Row-Level Security (RLS) via PostgreSQL.
- Chaves primárias: `UUID` gerado no servidor (`gen_random_uuid()`).
- Timestamps: `TIMESTAMPTZ` sempre em UTC.
- Dados semi-estruturados (questionários, campos livres): `JSONB`.
- Soft delete: `deleted_at TIMESTAMPTZ` — nunca `DELETE` em dados de negócio.

### 6.2 Tabelas principais

```sql
-- ─── TENANTS ─────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,          -- 'cage-rs', 'outro-orgao'
  nome        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  ativo       BOOLEAN DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── USUÁRIOS ─────────────────────────────────────────────────────────────
CREATE TABLE usuarios (
  uid         TEXT PRIMARY KEY,          -- Firebase Auth UID
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  email       TEXT NOT NULL,
  nome        TEXT NOT NULL,
  perfil      TEXT NOT NULL CHECK (perfil IN ('ep','gestor','dono','gerente_projeto')),
  ativo       BOOLEAN DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  criado_por  TEXT REFERENCES usuarios(uid),
  deleted_at  TIMESTAMPTZ
);

-- ─── ARQUITETURA ──────────────────────────────────────────────────────────
CREATE TABLE macroprocessos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  nome        TEXT NOT NULL,
  codigo      TEXT,
  ordem       INT DEFAULT 0,
  ativo       BOOLEAN DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE processos_arq (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  macro_id    UUID REFERENCES macroprocessos(id),
  parent_id   UUID REFERENCES processos_arq(id),   -- subprocesso
  nome        TEXT NOT NULL,
  tipo        TEXT CHECK (tipo IN ('processo','subprocesso')),
  is_sub      BOOLEAN GENERATED ALWAYS AS (parent_id IS NOT NULL) STORED,
  ordem       INT DEFAULT 0,
  ativo       BOOLEAN DEFAULT TRUE,
  deleted_at  TIMESTAMPTZ
);

-- ─── PROCESSOS (MAPEAMENTOS) ──────────────────────────────────────────────
CREATE TABLE processos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  arq_id          UUID REFERENCES processos_arq(id),
  dono_uid        TEXT REFERENCES usuarios(uid),
  gestor_uid      TEXT REFERENCES usuarios(uid),
  etapa           TEXT NOT NULL DEFAULT 'abertura'
                    CHECK (etapa IN ('abertura','modelagem','formalizacao','operacao','auditoria','concluido')),
  status_ciclo    TEXT,
  bpmn_xml        TEXT,                              -- diagrama BPMN
  dados           JSONB NOT NULL DEFAULT '{}',       -- questionário, POP, outros campos livres
  revisao_em      TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW(),
  criado_por      TEXT REFERENCES usuarios(uid),
  deleted_at      TIMESTAMPTZ
);

-- ─── SOLICITAÇÕES ─────────────────────────────────────────────────────────
CREATE TABLE solicitacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('novo','aderencia','revisao')),
  status          TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','em_analise','aprovado','rejeitado','convertido')),
  solicitante_uid TEXT REFERENCES usuarios(uid),
  aprovador_uid   TEXT REFERENCES usuarios(uid),
  processo_id     UUID REFERENCES processos(id),
  dados           JSONB NOT NULL DEFAULT '{}',
  aprovado_em     TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- ─── KPIs ─────────────────────────────────────────────────────────────────
CREATE TABLE kpis (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  processo_id UUID REFERENCES processos(id),
  dono_uid    TEXT REFERENCES usuarios(uid),
  nome        TEXT NOT NULL,
  periodo     TEXT,                                 -- '2026-T1', '2026-01' etc.
  meta        NUMERIC,
  resultado   NUMERIC,
  dados       JSONB NOT NULL DEFAULT '{}',
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- ─── PUBLICAÇÕES / METODOLOGIAS ───────────────────────────────────────────
CREATE TABLE publicacoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  titulo      TEXT NOT NULL,
  categoria   TEXT,                                 -- 'POPs', 'Metodologias'...
  url         TEXT,
  versao      TEXT,
  responsavel TEXT,
  data_pub    DATE,
  arq_ids     UUID[],                               -- processos_arq vinculados
  dados       JSONB NOT NULL DEFAULT '{}',
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- ─── TRILHAS ──────────────────────────────────────────────────────────────
CREATE TABLE trilhas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  titulo      TEXT NOT NULL,
  dados       JSONB NOT NULL DEFAULT '{}',
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- ─── PLANO ANUAL DE TRABALHO ───────────────────────────────────────────────
CREATE TABLE plano (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  ano         INT NOT NULL,
  dados       JSONB NOT NULL DEFAULT '{}',
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, ano)
);

CREATE TABLE plano_metas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  plano_id    UUID REFERENCES plano(id),
  descricao   TEXT NOT NULL,
  dados       JSONB NOT NULL DEFAULT '{}',
  deleted_at  TIMESTAMPTZ
);

-- ─── PROJETOS ─────────────────────────────────────────────────────────────
CREATE TABLE programas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  nome        TEXT NOT NULL,
  dados       JSONB NOT NULL DEFAULT '{}',
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE projetos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  programa_id         UUID REFERENCES programas(id),
  nome                TEXT NOT NULL,
  gerente_uid         TEXT REFERENCES usuarios(uid),
  gerente_sub_uid     TEXT REFERENCES usuarios(uid),
  patrocinador        TEXT,
  percentual          INT DEFAULT 0 CHECK (percentual BETWEEN 0 AND 100),
  fase                TEXT,
  status_report_obs   TEXT,
  dados               JSONB NOT NULL DEFAULT '{}',
  criado_em           TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE projeto_tarefas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  projeto_id  UUID REFERENCES projetos(id),
  parent_id   UUID REFERENCES projeto_tarefas(id),
  nome        TEXT NOT NULL,
  dt_inicio   DATE,
  dt_fim      DATE,
  responsavel TEXT,
  status      TEXT,
  dados       JSONB NOT NULL DEFAULT '{}',
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE projeto_indicadores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  projeto_id  UUID REFERENCES projetos(id),
  nome        TEXT NOT NULL,
  meta        NUMERIC,
  resultado   NUMERIC,
  dados       JSONB NOT NULL DEFAULT '{}',
  deleted_at  TIMESTAMPTZ
);

-- ─── AUDIT LOGS (append-only) ─────────────────────────────────────────────
CREATE TABLE audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  action           TEXT NOT NULL,
  uid              TEXT,
  email            TEXT,
  perfil           TEXT,
  target_table     TEXT,
  target_id        TEXT,
  before_data      JSONB,
  after_data       JSONB,
  ip               INET,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
-- Sem UPDATE, sem DELETE: garantido por permissão restrita no usuário do banco.
```

### 6.3 Índices

```sql
-- Tenant isolation (todos os SELECTs filtram por tenant_id)
CREATE INDEX ON processos          (tenant_id);
CREATE INDEX ON solicitacoes       (tenant_id, status);
CREATE INDEX ON kpis               (tenant_id, processo_id);
CREATE INDEX ON projetos           (tenant_id, programa_id);
CREATE INDEX ON projeto_tarefas    (tenant_id, projeto_id);
CREATE INDEX ON audit_logs         (tenant_id, created_at DESC);
CREATE INDEX ON audit_logs         (uid, created_at DESC);

-- Buscas de negócio frequentes
CREATE INDEX ON processos          (arq_id, etapa);
CREATE INDEX ON processos          (dono_uid, etapa);
CREATE INDEX ON solicitacoes       (solicitante_uid, status);
CREATE INDEX ON kpis               (periodo);
```

### 6.4 Row-Level Security (RLS) — opcional fase futura

```sql
ALTER TABLE processos ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON processos
  USING (tenant_id = current_setting('app.current_tenant'));
-- A Cloud Function seta: SET LOCAL app.current_tenant = 'cage-rs'
```

RLS garante isolamento mesmo que um bug de código omita o filtro `tenant_id`.

---

## 7. Estratégia de migração Firestore → Cloud SQL

A migração segue o padrão **Strangler Fig**: cada coleção migra
individualmente, mantendo o sistema em produção durante todo o processo.

### 7.1 Fases da migração por coleção

```
Firestore                   Cloud SQL
    │                           │
    │── Fase A: dual-write ────▶│  nova escrita vai para SQL E Firestore
    │                           │
    │── Fase B: read from SQL ─▶│  leitura migra para SQL; Firestore como backup
    │                           │
    │── Fase C: desligar ──────▶│  Firestore dessa coleção deixa de ser usado
```

### 7.2 Sequência por coleção

| Prioridade | Coleção Firestore | Tabela SQL | Motivo |
|---|---|---|---|
| 1ª | `config/usuarios` | `usuarios` | Base para tudo; Custom Claims dependem disso |
| 2ª | `arquitetura` | `macroprocessos`, `processos_arq` | Dependência de processos |
| 3ª | `processos` | `processos` | Entidade central |
| 4ª | `solicitacoes` | `solicitacoes` | Ação crítica com auditoria |
| 5ª | `kpis`, `relatorios_ind` | `kpis` | Relatórios analíticos |
| 6ª | `plano`, `plano_metas` | `plano`, `plano_metas` | PAT |
| 7ª | `publicacoes` | `publicacoes` | Dependência de arquitetura |
| 8ª | `trilhas`, `avisos` | `trilhas`, `avisos` | Independentes |
| 9ª | `projPROJETOS` | `projetos` | Módulo separado |
| 10ª | `projPROGRAMAS` | `programas` | Módulo separado |
| Manter | `sessions/{uid}` | — | Real-time; permanece no Firestore |
| Manter | `notifs/{id}` | — | Real-time; permanece no Firestore |

### 7.3 Script de migração por coleção

Para cada coleção, o script faz:

```
1. Ler todos os documentos Firestore da coleção
2. Mapear campos para o schema SQL (incluindo transformações de tipo)
3. INSERT em batch no Cloud SQL (transação por lote de 500)
4. Comparar contagem Firestore vs SQL
5. Gerar relatório de divergências
6. NÃO apagar Firestore — manter como fallback por 30 dias
```

Localização: `tools/migrate-to-sql/`

```
tools/migrate-to-sql/
  migrate-usuarios.mjs
  migrate-arquitetura.mjs
  migrate-processos.mjs
  migrate-solicitacoes.mjs
  migrate-kpis.mjs
  migrate-projetos.mjs
  shared/
    sql-client.mjs
    firestore-admin.mjs
    report.mjs
```

### 7.4 Dual-write durante a migração

Enquanto uma coleção está na fase B (leitura SQL, escrita ainda duplicada),
a Cloud Function grava em ambos:

```javascript
// actions/criar-processo.js — durante fase dual-write
await db.query('INSERT INTO processos ...', params);
await firestoreAdmin.collection('processos').doc(id).set(data);
// Após validação em prod por 2 semanas → remover linha Firestore
```

### 7.5 Critérios para encerrar o Firestore de uma coleção

- [ ] Leitura vindo 100% do SQL por 2 semanas sem incidente
- [ ] Script de migração validou contagem e integridade
- [ ] Testes E2E passando contra dados do SQL
- [ ] Backup SQL agendado verificado
- [ ] Aprovação do responsável técnico

---

## 8. Autenticação e autorização

### 8.1 Custom Claims (Firebase Auth)

```json
{
  "perfil": "ep" | "gestor" | "dono" | "gerente_projeto",
  "tenantId": "cage-rs"
}
```

- Claims definidos pela Cloud Function `/admin/set-user-claims`.
- Token renovado com `getIdToken(true)` após mudança de perfil.
- A API valida o token em cada request via Firebase Admin SDK.
- O banco SQL consulta `usuarios.perfil` para validações adicionais.

### 8.2 Fluxo de autorização por camada

```
Browser (UX)        → isEP() / isDono() → oculta/mostra botões
Cloud Function API  → verifica token JWT → retorna 403 se não autorizado
Cloud SQL (RLS)     → filtra por tenant_id → dado de outro tenant nunca retorna
```

Três camadas independentes. O cliente pode ser manipulado, mas a API e
o banco garantem segurança real.

### 8.3 Firestore rules (pós-migração)

Após a migração, as Firestore rules cobrem apenas as coleções que permanecem:

```javascript
match /sessions/{uid} {
  allow read, write: if request.auth.uid == uid;
}
match /notifs/{id} {
  allow read: if isAuth();
  allow write: if false; // apenas via Cloud Function (Admin SDK)
}
// Todas as demais coleções: deny by default (já migradas para SQL)
```

---

## 9. Qualidade e testes

### 9.1 Pirâmide de testes alvo

```
         /\
        /  \   E2E (Playwright) — fluxos críticos completos
       /────\
      /      \  Integração — API + Cloud SQL emulado (pg-mem ou Docker)
     /────────\
    /          \  Unitários (Vitest) — renderers, utils, controllers, repos SQL
   /────────────\
```

### 9.2 Testes de integração para a API

```javascript
// tests/integration/processos.test.js
import { createTestDb, seedTenant } from '../helpers/db';
import { app } from '../../functions/src/app';

test('GET /api/processos retorna só dados do tenant', async () => {
  const { token } = await seedTenant('cage-rs');
  const res = await request(app)
    .get('/api/processos')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.data.every(p => p.tenant_id === 'cage-rs')).toBe(true);
});
```

### 9.3 Cobertura por fase

| Fase | Alvo E2E | Alvo Integração | Alvo Unitário |
|---|---|---|---|
| Atual | 40% | 0% | 0% |
| Fim Fase 1 | 55% | 20% | 20% |
| Fim Fase 2 | 70% | 50% | 45% |
| Fim Fase 3 | 85% | 70% | 65% |
| Produto final | 90% | 85% | 80% |

---

## 10. DevOps e CI/CD

### 10.1 Pipeline alvo

```
push → feature/*
  └─ lint + Vitest unitários (rápido, <2 min)

PR → dev
  ├─ lint
  ├─ Vitest unitários + integração (pg Docker)
  └─ Playwright smoke (Firebase emulador + Cloud SQL Docker)

merge → hml
  ├─ Vitest completo + integração
  ├─ Playwright completo
  ├─ Deploy Cloud Functions (hml)
  ├─ Deploy Firebase Hosting (hml)
  └─ Migrate Cloud SQL HML (migrations pendentes)

merge → main
  ├─ CodeQL + SonarCloud
  ├─ Vitest + Playwright
  ├─ Deploy Cloud Functions (prod)
  ├─ Deploy Firebase Hosting (prod)
  └─ Migrate Cloud SQL prod (migrations pendentes)
```

### 10.2 Ambientes

| Branch | Firebase Project | Cloud SQL | Observação |
|---|---|---|---|
| `dev` local | Emulador | Docker (pg) | Sem custo |
| `hml` | `gesproc2-hml` | Cloud SQL (hml) | Cópia da prod, dados anonimizados |
| `main` | `gesproc2` | Cloud SQL (prod) | Dados reais |

### 10.3 Migrations SQL

Usar ferramenta de migration versionada (ex: **node-pg-migrate** ou **Flyway**):

```
functions/migrations/
  V001__initial_schema.sql
  V002__add_projeto_indicadores.sql
  V003__add_rls_policies.sql
  ...
```

Cada deploy roda `migrate up` antes de subir o código novo.
Migrations são sempre incrementais — sem DOWN em produção.

---

## 11. Roadmap consolidado por prioridade

### Prioridade 1 — Fundação da API (desbloqueador de tudo)

| Item | Por quê | Entregável |
|---|---|---|
| Criar Cloud SQL (prod + hml) | Base para migração | Instância provisionada + usuário da CF |
| Schema SQL inicial (V001) | Estrutura para migrar | `migrations/V001__initial_schema.sql` |
| `api-client.js` no front | Todos os módulos futuros dependem | `src/shared/api-client.js` |
| Endpoint `/api/processos` (GET) | Primeira leitura do SQL | Cloud Function + repositório SQL |
| Migrar `config/usuarios` | Custom Claims dependem | Script + validação |

### Prioridade 2 — Segurança real (não postergável)

| Item | Por quê | Entregável |
|---|---|---|
| `/actions/aprovar-solicitacao` como CF | Aprovação hoje é client-side | CF com audit log |
| `/admin/set-user-claims` operacional | Perfil no token, não só no front | CF + renovação de token |
| RLS ativo no Cloud SQL | Isolamento garantido pelo banco | Policy + user de banco sem bypass |
| Audit log em toda ação crítica | Requisito de conformidade | Tabela + função `insertAuditLog()` |

### Prioridade 3 — Migração de dados (coleção por coleção)

| Coleção | Script | Fase dual-write | Desligar Firestore |
|---|---|---|---|
| `usuarios` | `migrate-usuarios.mjs` | 2 semanas | Após Fase 2 |
| `arquitetura` | `migrate-arquitetura.mjs` | 2 semanas | Após Fase 2 |
| `processos` | `migrate-processos.mjs` | 4 semanas | Após Fase 3 |
| `solicitacoes` | `migrate-solicitacoes.mjs` | 2 semanas | Após ações críticas em CF |
| Demais | ... | 2 semanas cada | Conforme Fase 2/3 |

### Prioridade 4 — Modularização do monolito

Executar em paralelo com a migração SQL. Ao extrair cada módulo do HTML,
apontar seu repositório para a API REST em vez do Firestore.

---

## 12. Decisões arquiteturais registradas (ADRs)

### ADR-01: Vanilla JS em vez de framework (React/Vue)
**Decisão:** Manter JavaScript puro com módulos ES.  
**Motivo:** Migrar 18.000 linhas para um framework seria uma reescrita completa,
de alto risco, sem ganho funcional imediato. A modularização por ES modules
permite progressão gradual com zero downtime.  
**Revisão:** Considerar framework apenas após o monolito estar 100% extraído e
cobertura de testes acima de 80%.

### ADR-02: Migrar de Firestore para Cloud SQL (PostgreSQL)
**Decisão:** Cloud SQL como banco principal; Firestore apenas para real-time.  
**Motivo:** Dados de negócio (processos, KPIs, projetos) requerem queries analíticas,
joins para relatórios, dump SQL para cessão a outros órgãos e ferramentas de BI.
Firestore não atende esses requisitos sem custo de ETL constante.  
**Trade-off aceito:** Maior complexidade operacional (instância gerenciada, migrations,
pool de conexão nas Cloud Functions). Mitigação: Cloud SQL no mesmo projeto GCP,
backups automáticos, pg-migrate para migrations.  
**O que permanece no Firestore:** `sessions/`, `notifs/`, `bpmn_locks/`.

### ADR-03: Cloud Functions como única porta de entrada para o SQL
**Decisão:** O browser nunca acessa Cloud SQL diretamente.  
**Motivo:** SQL exige credenciais de banco — não podem ser expostas ao cliente.
Cloud Functions validam o token Firebase, aplicam autorização e são a única
camada que conhece a string de conexão (via Secret Manager).

### ADR-04: Sem TypeScript por enquanto
**Decisão:** Manter JavaScript.  
**Motivo:** Custo de conversão alto. JSDoc com tipos parciais é suficiente para IDEs.  
**Revisão:** Reabrir após Fase 2 concluída — novos módulos e Cloud Functions
podem ser escritos em TS sem reescrever os antigos.

### ADR-05: Multi-tenant por coluna `tenant_id` + RLS
**Decisão:** Um projeto Firebase e uma instância Cloud SQL com RLS por tenant.  
**Motivo:** Projetos/instâncias separados por órgão multiplicam custo operacional.
`tenant_id` + RLS garante isolamento com custo único de infraestrutura.

### ADR-06: Padrão Strangler Fig para a migração Firestore → SQL
**Decisão:** Migrar coleção por coleção com dual-write.  
**Motivo:** Big-bang migration tem risco inaceitável em sistema de produção
sem janela de manutenção viável. Dual-write permite rollback por coleção
sem afetar todo o sistema.

---

## 13. Métricas de saúde arquitetural

Verificar mensalmente:

| Métrica | Hoje | Meta 6 meses | Meta 12 meses |
|---|---|---|---|
| Linhas em `processos.html` | ~18.000 | <12.000 | <4.000 |
| Linhas em `projetos-logic.js` | ~5.700 | <4.000 | <1.000 |
| Módulos independentes em `src/` | 11 | 20 | 35 |
| Variáveis globais (`window.*`) | 20+ | 12 | 4 |
| Handlers `onclick` inline | 300+ | 200 | 50 |
| Cloud Functions de negócio | 1 (IA) | 5 | 12 |
| Coleções ainda no Firestore (negócio) | 10 | 6 | 1 |
| Tabelas no Cloud SQL | 0 | 6 | 15 |
| Cobertura E2E | ~40% | 65% | 85% |
| Cobertura integração | 0% | 30% | 70% |
| Cobertura unitária | 0% | 25% | 60% |
| Tempo de onboarding de dev | 2-3 sem | 1 sem | 2-3 dias |

---

*Documento mantido pela equipe EP·CAGE. Revisão sugerida a cada trimestre
ou após conclusão de cada Fase de modularização/migração.*
