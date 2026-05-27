# Arquitetura-Alvo do SIGA 2.0

**Data:** 2026-05-27  
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
| D3 | Firestore rules sem validação de perfil para gestor/dono | Alto | Qualquer autenticado pode gravar KPIs, solicitações |
| D4 | Sem log de auditoria server-side | Médio | Rastreabilidade zero para ações sensíveis |
| D5 | `processos.html` usa `<script type="module">` isolado + IIFE globais em paralelo | Médio | Impossibilita tree-shaking e bundling sem quebrar handlers inline |
| D6 | TENANCY desligado em produção | Médio | Impossibilita cessão a outros órgãos sem migração manual |
| D7 | Sem testes unitários — só E2E | Médio | Regressões em utilitários não são detectadas |
| D8 | CSS inline em 95% dos componentes | Baixo | Impossibilita redesign sem varrer todo o HTML |

---

## 2. Arquitetura-alvo (visão de destino)

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENTE (Browser)                                              │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │ src/processos/  │  │  src/projetos/  │   ← ES modules       │
│  │   (módulos ES)  │  │   (módulos ES)  │     sem onclick       │
│  └────────┬────────┘  └────────┬────────┘     inline           │
│           └─────────┬──────────┘                               │
│              src/shared/  ← auth, repos, tenant, utils         │
│                    │                                           │
│              Firebase SDK (browser)                            │
└────────────────────┼────────────────────────────────────────────┘
                     │ HTTPS (Firebase Auth token)
┌────────────────────┼────────────────────────────────────────────┐
│  FIREBASE / GCP    │                                            │
│                    │                                            │
│  ┌─────────────────▼────────────────────────────────────────┐  │
│  │  Cloud Functions (Node 20)                               │  │
│  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │  │
│  │  │ /ai        │ │/actions  │ │/admin    │ │/reports  │  │  │
│  │  │ (IA proxy) │ │(negócio) │ │(usuários)│ │(exports) │  │  │
│  │  └────────────┘ └──────────┘ └──────────┘ └──────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Firestore   │  │   Storage    │  │  Secret Manager      │  │
│  │  (por tenant)│  │  (por tenant)│  │  (chaves externas)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Firebase Auth + Custom Claims                           │  │
│  │  {perfil: 'ep'|'gestor'|'dono', tenantId: 'cage-rs'}   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────────────────┐
│  EXTERNO                                                        │
│  Azure OpenAI  ·  EmailJS  ·  Google Docs (BPMN export)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Camadas do frontend (estado-alvo)

### 3.1 Hierarquia de camadas

```
config/                     ← injetada pelo CI antes do deploy
src/shared/
  ├── org-config.js          ← identidade institucional (já existe)
  ├── tenant-config.js       ← paths multi-tenant (já existe)
  ├── firebase-helpers.js    ← refs Firestore (já existe)
  ├── firestore-repositories.js  ← repositórios (já existe)
  ├── auth/
  │   ├── auth-controller.js     ← login/logout (já existe)
  │   └── auth-state.js          ← estado reativo do usuário logado
  ├── users/
  │   ├── users-permissions.js   ← isEP(), isDono() (já existe)
  │   └── users-state.js         ← cache de usuários (já existe)
  └── navigation/
      └── navigation-controller.js ← hub (já existe)
src/processos/
  ├── app-constants.js       ← enums, labels (já existe)
  ├── security-utils.js      ← esc(), safeUrl() (já existe)
  ├── storage-utils.js       ← localStorage seguro (já existe)
  ├── org-branding.js        ← branding na UI (já existe)
  ├── module-hub-controller.js
  ├── auto-logout.js
  ├── concurrent-edit.js
  ├── [módulos a extrair — ver seção 5]
src/projetos/               ← extração futura de projetos-logic.js
```

### 3.2 Regra de dependência entre camadas

```
config → shared → processos|projetos → HTML
```

- `src/shared/` não importa nada de `src/processos/` nem `src/projetos/`.
- Módulos de processos não importam módulos de projetos (e vice-versa).
- Comunicação entre módulos distintos só via event bus ou `globalThis` explícito.
- Nunca criar chamada Firestore direta fora de `firestore-repositories.js`.

### 3.3 Convenção de módulo

Cada módulo em `src/processos/{modulo}/` segue o padrão:

```
{modulo}-state.js        ← estado imutável/local (dados em memória)
{modulo}-repository.js   ← acesso Firestore (chama repositório central)
{modulo}-controller.js   ← lógica: recebe evento, chama repositório, emite resultado
{modulo}-renderer.js     ← gera HTML a partir do estado (sem efeitos colaterais)
{modulo}-types.js        ← constantes, labels, enums do módulo
```

O renderer não acessa Firestore. O controller não monta HTML. Essa separação
permite testar unitariamente cada peça.

---

## 4. Camadas do backend (estado-alvo)

### 4.1 Cloud Functions planejadas

| Endpoint | Função | Autenticação | Prioridade |
|---|---|---|---|
| `/ai` | Proxy Azure OpenAI | Token Firebase | ✅ Existe |
| `/actions/aprovar-solicitacao` | Aprovação de solicitação → mapeamento | EP ou gestor | 🔴 Alta |
| `/actions/converter-aderencia` | Solicitação → análise de aderência | EP | 🔴 Alta |
| `/actions/excluir-processo` | Exclusão com auditoria | EP | 🔴 Alta |
| `/actions/importar-planilha` | Import XLS de processos/KPIs | EP | 🟡 Média |
| `/admin/set-user-claims` | Definir perfil no Custom Claim | EP | 🟡 Média |
| `/admin/criar-usuario` | Provisionar conta + Firestore | EP | 🟡 Média |
| `/reports/exportar-relatorio` | Geração de PDF/XLSX no servidor | Autenticado | 🟡 Média |
| `/notifications/enviar` | Notificação por email c/ log | Autenticado | 🟢 Baixa |

### 4.2 Estrutura de functions/

```
functions/
  index.js           ← router principal (já existe)
  src/
    middleware/
      auth.js         ← verificar token + claims
      tenant.js       ← resolver tenantId do token
      rate-limit.js   ← proteção contra abuso
    actions/
      aprovar-solicitacao.js
      converter-aderencia.js
      excluir-processo.js
    admin/
      set-user-claims.js
      criar-usuario.js
    reports/
      exportar-relatorio.js
    notifications/
      enviar-email.js
    shared/
      audit-log.js    ← gravar em tenants/{id}/audit_logs/{id}
      firestore.js    ← admin SDK helpers
```

### 4.3 Padrão de audit log

Toda ação crítica grava em `tenants/{tenantId}/audit_logs/{auto-id}`:

```json
{
  "action": "aprovar_solicitacao",
  "uid": "uid-do-executor",
  "email": "executor@sefaz.rs.gov.br",
  "perfil": "ep",
  "targetId": "solicitacao-id",
  "targetCollection": "solicitacoes",
  "timestamp": "2026-05-27T10:00:00Z",
  "before": { /* snapshot anterior */ },
  "after":  { /* snapshot posterior */ },
  "ip": "...",
  "userAgent": "..."
}
```

---

## 5. Mapa de modularização do processos.html

Ordem de extração, da menor dependência para a maior. Cada fase requer
smoke test E2E antes de remover o código do monolito.

### FASE 0 — Código compartilhado ✅ Em andamento

| Módulo | Arquivo alvo | Status |
|---|---|---|
| Auth/Login | `src/shared/auth/auth-controller.js` | ✅ Extraído |
| Perfis/Permissões | `src/shared/users/users-permissions.js` | ✅ Extraído |
| Hub/Navegação | `src/shared/navigation/navigation-controller.js` | ✅ Extraído |
| Auto-logout | `src/processos/auto-logout.js` | ✅ Extraído |
| Edição concorrente | `src/processos/concurrent-edit.js` | ✅ Extraído |

### FASE 1 — Utilitários e conteúdo institucional

| Módulo | Linhas est. | Arquivo alvo | Risco |
|---|---|---|---|
| Avisos/Notificações | ~400 | `src/processos/avisos/` | ⚪ Baixo |
| Trilhas de capacitação | ~800 | `src/processos/trilhas/` | ⚪ Baixo |
| Backup/Restore JSON | ~300 | `src/processos/backup/` | ⚪ Baixo |
| Publicações/Metodologias | ~700 | `src/processos/publicacoes/` | ⚪ Baixo |

**Critério de conclusão:** `processos.html` abaixo de 15.000 linhas.

### FASE 2 — Gestão de dados

| Módulo | Linhas est. | Arquivo alvo | Risco |
|---|---|---|---|
| Arquitetura (árvore) | ~1.000 | `src/processos/arquitetura/` | 🟡 Médio |
| KPIs/Indicadores | ~2.000 | `src/processos/kpis/` | 🟡 Médio |
| PAT/Metas estratégicas | ~800 | `src/processos/pat/` | 🟡 Médio |
| Solicitações | ~1.200 | `src/processos/solicitacoes/` | 🟡 Médio |
| Admin de usuários | ~800 | `src/processos/admin-usuarios/` | 🟡 Médio |
| Dashboard/Painel | ~1.000 | `src/processos/dashboard/` | 🟡 Médio |

**Critério de conclusão:** `processos.html` abaixo de 9.000 linhas.

### FASE 3 — Mapeamento e IA (alto acoplamento)

| Módulo | Linhas est. | Arquivo alvo | Risco |
|---|---|---|---|
| BPMN Editor | ~2.500 | `src/processos/bpmn/` | 🔴 Alto |
| Etapa: Abertura | ~600 | `src/processos/etapas/abertura/` | 🔴 Alto |
| Etapa: Modelagem + IA | ~1.800 | `src/processos/etapas/modelagem/` | 🔴 Alto |
| Etapa: Formalização | ~1.200 | `src/processos/etapas/formalizacao/` | 🔴 Alto |
| Etapa: Operação | ~400 | `src/processos/etapas/operacao/` | 🔴 Alto |
| Etapa: Auditoria | ~600 | `src/processos/etapas/auditoria/` | 🔴 Alto |
| Geração de POP (PDF) | ~1.500 | `src/processos/geracao/pop/` | 🟡 Médio |
| Geração de PPT | ~800 | `src/processos/geracao/ppt/` | 🟡 Médio |
| Ciclo de vida | ~800 | `src/processos/ciclo-vida/` | 🔴 Alto |

**Critério de conclusão:** `processos.html` abaixo de 2.000 linhas (apenas bootstrap e HTML estrutural).

### FASE 4 — Módulo Projetos

| Módulo | Linhas est. | Arquivo alvo | Risco |
|---|---|---|---|
| Portfólio | ~800 | `src/projetos/portfolio/` | 🟡 Médio |
| Programas | ~500 | `src/projetos/programas/` | 🟡 Médio |
| Cronograma/EAP | ~1.200 | `src/projetos/cronograma/` | 🟡 Médio |
| Indicadores de projeto | ~600 | `src/projetos/indicadores/` | 🟡 Médio |
| Status Report (PDF) | ~1.800 | `src/projetos/relatorio/` | 🟡 Médio |
| Canvas/Reuniões | ~700 | `src/projetos/reunioes/` | 🟡 Médio |

**Critério de conclusão:** `projetos-logic.js` eliminado; `projetos.html` como bootstrap.

---

## 6. Modelo de dados Firestore (estado-alvo)

### 6.1 Estrutura multi-tenant

```
tenants/{tenantId}/
  config/
    usuarios                  ← cadastro de usuários e perfis
    ejs                        ← credenciais EmailJS
    institucional              ← textos e parâmetros do órgão
  processos/{procId}          ← mapeamentos completos
  solicitacoes/{solId}
  kpis/{kpiId}
  relatorios_ind/{relId}
  trilhas/{trilhaId}
  publicacoes/{pubId}
  plano/{planId}
  plano_metas/{metaId}
  arquitetura/{arqId}
  avisos/{avisoId}
  notifs/{notifId}
  sessions/{uid}
  audit_logs/{logId}          ← somente escrita via Cloud Function
  members/{uid}               ← membro do tenant com papel
    { perfil, email, ativo, criadoEm, criadoPor }
  projPROJETOS/{projId}
  projPROGRAMAS/{progId}
```

### 6.2 Firestore rules — modelo alvo

```
// Funções helpers
function isMember()    { return exists(/...tenants/$(tenantId)/members/$(request.auth.uid)); }
function memberData()  { return get(/...tenants/$(tenantId)/members/$(request.auth.uid)).data; }
function hasRole(role) { return isMember() && memberData().perfil == role; }
function isEP()        { return hasRole('ep'); }
function isGestor()    { return hasRole('gestor'); }
function isDono()      { return hasRole('dono'); }

// Audit logs: somente Cloud Function pode gravar (não autenticado de browser)
match /tenants/{tenantId}/audit_logs/{logId} {
  allow read: if isEP();
  allow write: if false;  // via Cloud Function com Admin SDK
}

// Members: EP lê todos; cada membro lê a si mesmo; EP escreve
match /tenants/{tenantId}/members/{uid} {
  allow read:  if isEP() || request.auth.uid == uid;
  allow write: if isEP();
}
```

### 6.3 Índices compostos necessários

| Coleção | Campos | Uso |
|---|---|---|
| `processos` | `arq_id`, `etapa` | Filtro por subprocesso + etapa |
| `processos` | `dono_uid`, `etapa` | Processos do dono por etapa |
| `kpis` | `processo_id`, `periodo` | KPIs por processo e período |
| `solicitacoes` | `status`, `criadoEm` | Fila de aprovação ordenada |
| `audit_logs` | `uid`, `timestamp` | Auditoria por usuário |
| `audit_logs` | `action`, `timestamp` | Auditoria por tipo de ação |

---

## 7. Autenticação e autorização

### 7.1 Custom Claims (Firebase Auth)

```json
{
  "perfil": "ep" | "gestor" | "dono" | "gerente_projeto",
  "tenantId": "cage-rs"
}
```

- Claims definidos pela Cloud Function `/admin/set-user-claims` (chamada só pelo EP).
- Token renovado com `getIdToken(true)` após mudança de perfil.
- Rules Firestore verificam `request.auth.token.perfil` (server-side, não bypassável).
- Front-end usa `memberData()` para UX, rules para enforcement real.

### 7.2 Fluxo de autorização por camada

```
Browser (UX)    → isEP() / isDono() do users-permissions.js → oculta botões
Cloud Function  → verifica token + claims → retorna 403 se não autorizado
Firestore Rules → verifica claims do token → rejeita gravação não autorizada
```

As três camadas são independentes. O front-end pode ser ignorado, mas as
Functions e as Rules garantem segurança real.

---

## 8. Qualidade e testes

### 8.1 Pirâmide de testes alvo

```
        /\
       /  \  E2E (Playwright) — fluxos críticos completos
      /────\
     /      \  Integração — Functions + Firestore emulado
    /────────\
   /          \  Unitários (Vitest) — renderers, utils, controllers
  /────────────\
```

### 8.2 Cobertura por fase

| Fase | Alvo E2E | Alvo Unitário |
|---|---|---|
| Atual | 40% | 0% |
| Fim Fase 1 | 55% | 20% |
| Fim Fase 2 | 70% | 45% |
| Fim Fase 3 | 85% | 70% |
| Produto final | 90% | 80% |

### 8.3 Como introduzir testes unitários

Ao extrair cada módulo para `src/processos/{modulo}/`:

1. `{modulo}-renderer.js` deve ser uma função pura `(state) => string`.
2. Criar `tests/unit/{modulo}.test.js` com Vitest.
3. Testar: renderização com estado vazio, com dados válidos, com campos nulos.
4. Não testar Firestore — usar mocks via `vi.mock()`.

Configuração mínima (`vitest.config.js`):
```js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom' } });
```

---

## 9. DevOps e CI/CD

### 9.1 Pipeline atual (GitHub Actions)

```
push → main
  ├─ CodeQL (segurança)
  ├─ SonarCloud (qualidade)
  └─ Firebase Deploy (hosting + functions)
```

### 9.2 Pipeline alvo

```
push → feature/*
  └─ lint + type-check (se TS for adotado)

PR → dev
  ├─ lint
  ├─ Vitest (unitários)
  └─ Playwright smoke (emulador local)

merge → hml
  ├─ Vitest
  ├─ Playwright completo (emulador)
  └─ Deploy Firebase (projeto hml)

merge → main
  ├─ CodeQL
  ├─ SonarCloud
  ├─ Vitest + Playwright
  └─ Deploy Firebase (projeto prod)
```

### 9.3 Ambientes Firebase

| Branch | Projeto Firebase | Banco Firestore |
|---|---|---|
| `dev` (local) | emulador | local |
| `hml` | `gesproc2-hml` (criar) | cópia da prod |
| `main` | `gesproc2` | produção |

---

## 10. Estratégia de migração multi-tenant

### 10.1 Pré-condições para ativar

- [ ] Todos os acessos Firestore passam por `firestore-repositories.js`.
- [ ] Cloud Functions `/admin` operacionais.
- [ ] Documentos `tenants/cage-rs/members/{uid}` criados para todos os usuários ativos.
- [ ] Rules alvo validadas em emulador com dataset real.
- [ ] Migração executada e validada em `hml` (`npm run tenant:migration:validate`).

### 10.2 Sequência de ativação

```
1. Executar migração em HML  →  node tools/migrate-firestore-tenant.mjs --tenant=cage-rs --execute
2. Validar integridade       →  npm run tenant:migration:validate
3. Publicar rules alvo em HML (sem ativar tenant no config)
4. Testar login, solicitações, mapeamento, KPIs, projetos
5. Ativar TENANCY.enabled:true no config de HML
6. Retestar todos os fluxos críticos
7. Repetir passos 1–6 em PROD em horário de baixo uso
8. Atualizar rules de PROD para o modelo alvo
9. Monitorar por 48h antes de remover coleções legadas
```

---

## 11. Roadmap consolidado por prioridade

### Prioridade 1 — Segurança (não postergável)

| Item | Por quê | Como |
|---|---|---|
| Cloud Function `/actions/aprovar-solicitacao` | Aprovação hoje é client-side, bypassável | Mover validação para CF |
| Custom Claim `tenantId` no token | Rules não verificam tenant ainda | Adicionar ao set-user-claims |
| Rules: gestor só lê, não grava sem validação | `isAuth()` é muito permissivo | Adicionar `isMember()` nas rules |
| Audit log de ações críticas | Zero rastreabilidade hoje | Implementar junto com cada CF |

### Prioridade 2 — Manutenibilidade

| Item | Por quê | Como |
|---|---|---|
| Extrair FASE 1 do monolito | Avisos, trilhas, publicações são simples e independentes | Seguir PLANO-MODULARIZACAO.md |
| Testes unitários nos renderers extraídos | Zero cobertura unitária hoje | Vitest desde o primeiro renderer extraído |
| Projeto Firebase de homologação | Só há prod e emulador local | Criar `gesproc2-hml` no Firebase |

### Prioridade 3 — Evolução e cessão

| Item | Por quê | Como |
|---|---|---|
| Ativar multi-tenant | Cessão a outros órgãos | Sequência seção 10.2 |
| Extrair FASE 2 e 3 do monolito | Onboarding de devs hoje ~2-3 semanas | Extrair módulo por módulo |
| FASE 4: modularizar projetos | `projetos-logic.js` repetindo padrões | Após consolidar arquitetura de processos |
| Testes E2E acima de 85% | Cessão exige qualidade verificável | Junto com cada extração de fase |

---

## 12. Decisões arquiteturais registradas (ADRs)

### ADR-01: Vanilla JS em vez de framework (React/Vue)
**Decisão:** Manter JavaScript puro com módulos ES.  
**Motivo:** Migrar 18.000 linhas para um framework seria uma reescrita completa,
de alto risco, sem ganho funcional imediato. A modularização por IIFE/ES modules
permite progressão gradual com zero downtime.  
**Revisão:** Considerar framework apenas após o monolito estar 100% extraído e
com cobertura de testes acima de 80%.

### ADR-02: Firestore como banco principal (sem SQL)
**Decisão:** Não migrar para banco relacional.  
**Motivo:** O modelo de dados é hierárquico (macroprocesso → subprocesso → etapas),
sem joins complexos. Firestore + Security Rules é o menor custo de manutenção
para equipe pequena.  
**Trade-off aceito:** Queries analíticas complexas precisam de Cloud Functions
que façam agregação no servidor.

### ADR-03: Cloud Functions só para ações críticas
**Decisão:** Não mover toda lógica para o servidor; apenas ações sensíveis.  
**Motivo:** Simplicidade operacional. Leituras públicas (dashboard, listagens)
continuam no cliente. Só escritas com permissão ou impacto irreversível vão para CF.

### ADR-04: Sem TypeScript por enquanto
**Decisão:** Manter JavaScript.  
**Motivo:** Custo de conversão alto para benefício difuso dado o tamanho do
monolito. JSDoc com tipos parciais é suficiente para IDEs.  
**Revisão:** Reabrir após Fase 2 concluída — novos módulos podem ser escritos
em TS sem reescrever os antigos.

### ADR-05: Multi-tenant por prefixo de coleção (não por projeto Firebase)
**Decisão:** Um projeto Firebase com coleções `tenants/{tenantId}/...`.  
**Motivo:** Projetos separados por órgão multiplicam custo de operação e
dificultam atualizações. Prefixo de coleção com rules robustas é suficiente
para isolamento de dados.

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
| Cloud Functions de negócio | 1 (IA) | 4 | 9 |
| Cobertura E2E | ~40% | 60% | 85% |
| Cobertura unitária | 0% | 25% | 60% |
| Tempo de onboarding de dev | 2-3 sem | 1 sem | 2-3 dias |

---

*Documento mantido pela equipe EP·CAGE. Revisão sugerida a cada trimestre ou
após conclusão de cada Fase de modularização.*
