# SIGA 2.0 — Guia Técnico para a Equipe Receptora

**Sistema:** SIGA 2.0 — Sistema de Gestão de Processos Institucionais  
**Órgão de origem:** EP·CAGE / Sefaz-RS  
**Data:** Maio de 2026

---

## 1. O que o sistema faz

O SIGA 2.0 é uma aplicação web de gestão de processos institucionais com dois módulos:

**SIGA Processos** — o módulo principal. Cobre:
- Arquitetura organizacional (macroprocessos, processos, subprocessos)
- Mapeamento BPMN com editor visual (AS IS / TO BE)
- Solicitações de mapeamento e ciclo de aprovação
- Geração automática de POP (Procedimento Operacional Padrão) e PPT via IA
- Indicadores de desempenho (KPIs) com importação e relatórios
- Análise de aderência
- Publicações e documentos institucionais
- PAT — Plano Anual de Trabalho com metas estratégicas
- Auditoria de processos

**SIGA Projetos** — módulo complementar. Cobre:
- Portfólio de projetos e programas
- Cronogramas com marcos e entregas
- Reuniões e atas
- Indicadores de projeto
- Relatório executivo

### Perfis de usuário

| Perfil | Constante | Acesso |
|--------|-----------|--------|
| EP (admin) | `PERFIL.EP` | Acesso completo a tudo |
| Dono | `PERFIL.DONO` | Gerencia seus próprios processos |
| Gestor / Adjunto | `PERFIL.GESTOR` | Leitura + aprovação |
| Gerente de projeto | `PERFIL.GERENTE_PROJETO` | Módulo de projetos vinculados |

---

## 2. Infraestrutura

O sistema roda integralmente no Google Firebase, sem servidores próprios:

```
Usuário (navegador)
    │
    ▼
Firebase Hosting  ──  arquivos estáticos (HTML, JS, CSS)
    │
    ├── Firebase Auth  ──  autenticação por e-mail e senha
    │
    ├── Firestore  ──  banco de dados NoSQL (dados de negócio)
    │
    ├── Cloud Storage  ──  arquivos (diagramas BPMN, documentos)
    │
    └── Cloud Functions (Node.js 20)
            │
            └── Azure OpenAI  ──  IA para geração de POP, PPT, análises
```

**Deploy:** GitHub Actions dispara automaticamente ao fazer push em `main`. Não há etapa manual.

**Segredos:** chaves e credenciais estão no Google Cloud Secret Manager e no GitHub Secrets. Nenhuma credencial está no código-fonte.

**Análise estática:** CodeQL e SonarCloud rodam automaticamente a cada push.

---

## 3. Como o código está organizado

### 3.1 Estrutura de arquivos

```
raiz/
├── processos.html              ← módulo principal (monolito em migração)
├── projetos.html               ← módulo de projetos
├── projetos-logic.js           ← lógica do módulo de projetos
├── styles.css                  ← CSS compartilhado
│
├── src/
│   ├── shared/                 ← código reutilizável entre os dois módulos
│   │   ├── auth/               ← autenticação e login
│   │   ├── users/              ← estado e permissões do usuário
│   │   ├── navigation/         ← hub e roteamento entre módulos
│   │   ├── org-config.js       ← identidade institucional (nome, logo, domínio)
│   │   ├── tenant-config.js    ← configuração multi-organização
│   │   ├── firebase-helpers.js ← conexão Firebase
│   │   └── firestore-repositories.js  ← acesso centralizado ao banco
│   │
│   └── processos/              ← módulos já extraídos do monolito
│       ├── app-constants.js    ← enums, labels e cores (PERFIL, STATUS etc.)
│       ├── security-utils.js   ← sanitização HTML e validação de URLs
│       ├── storage-utils.js    ← acesso seguro ao localStorage
│       ├── org-branding.js     ← identidade institucional na UI
│       ├── module-hub-controller.js  ← hub de seleção de módulo
│       ├── concurrent-edit.js  ← detecção de edição simultânea
│       └── auto-logout.js      ← timeout de sessão por inatividade
│
├── functions/
│   └── index.js                ← Cloud Function: proxy para Azure OpenAI
│
├── config/
│   ├── config.example.js       ← template de configuração (versionar)
│   └── config.local.js         ← configuração local (NÃO versionar)
│
├── firestore.rules             ← regras de segurança do banco
├── storage.rules               ← regras de segurança de arquivos
├── firebase.json               ← configuração Firebase (hosting, functions)
│
├── docs/                       ← documentação técnica
│   ├── architecture/           ← arquitetura, modularização, roadmap
│   ├── security/               ← histórico e planos de segurança
│   └── deployment/             ← checklist de deploy
│
└── tests/e2e/                  ← testes Playwright
```

### 3.2 O monolito e por que ele existe

O arquivo `processos.html` tem aproximadamente 18.000 linhas e mistura HTML, CSS e JavaScript. Ele é a primeira versão do sistema — construída para validar funcionalidades rapidamente com os usuários antes de investir em estrutura.

A migração desse código para a estrutura em `src/` está em andamento. As camadas de infraestrutura, dados, segurança e configuração já estão separadas. O que falta é extrair a lógica de UI do monolito módulo a módulo.

### 3.3 O padrão dos módulos em `src/`

Todos os arquivos em `src/` seguem o mesmo padrão: uma IIFE (função executada imediatamente) que recebe `globalThis` como argumento e expõe no escopo global apenas o que o HTML monolítico precisa chamar.

```javascript
// Exemplo: src/processos/security-utils.js
(function initSecurityUtils(globalScope) {

  function esc(str) { /* sanitiza HTML */ }
  function safeUrl(url) { /* valida URLs */ }

  // Exposto globalmente porque processos.html chama diretamente
  globalScope.esc = esc;
  globalScope.safeUrl = safeUrl;

})(globalThis);
```

**Por que esse padrão?** O `processos.html` usa `onclick="nomeDaFuncao()"` em centenas de elementos. Enquanto isso existir, as funções precisam estar no escopo global (`window.*`). O padrão IIFE permite isolar o código em módulos sem quebrar esses handlers.

Quando um módulo for extraído completamente (seção 6), os `onclick` são substituídos por `addEventListener` e a exposição global pode ser removida.

### 3.4 Acesso ao banco de dados

Todo acesso ao Firestore deve passar pelos repositórios definidos em `src/shared/firestore-repositories.js`. Nunca chamar `doc()`, `collection()`, `setDoc()` ou `getDocs()` diretamente na UI.

```javascript
// Correto
const snap = await processosRepository.list();
const doc  = await kpisRepository.get('id-do-kpi');
await planoRepository.set('id', dados);

// Errado — não fazer isso em código novo
const snap = await getDocs(collection(db, 'processos'));
```

Os repositórios disponíveis são: `processosRepository`, `solicitacoesRepository`, `kpisRepository`, `publicacoesRepository`, `planoRepository`, `avisosRepository`, `relatoriosIndicadoresRepository`, `projetosRepository`, `programasRepository`, `configRepository`.

### 3.5 Coleções Firestore

| Coleção | Conteúdo |
|---------|----------|
| `processos` | Mapeamentos (todas as etapas) |
| `kpis` | Indicadores de desempenho |
| `publicacoes` | Metodologias publicadas |
| `plano` | PAT — Plano Anual de Trabalho |
| `plano_metas` | Metas estratégicas |
| `arquitetura` | Árvore: macroprocesso → subprocesso |
| `config/usuarios` | Cadastro de usuários e perfis |
| `config/ejs` | Credenciais EmailJS |
| `sessions/{uid}` | Sessão do usuário (idle timeout) |
| `projPROJETOS` | Portfólio de projetos |
| `projPROGRAMAS` | Programas |

---

## 4. Como trabalhar no sistema hoje

Antes da modularização estar completa, qualquer alteração no sistema deve seguir estas regras.

### 4.1 Regras obrigatórias

| Regra | Como aplicar |
|-------|-------------|
| Sanitizar saídas HTML | `esc(valor)` de `security-utils.js` |
| Validar URLs antes de renderizar | `safeUrl(url)` — aceita apenas `https://` |
| Acessar dados via repositórios | `processosRepository.list()`, nunca `getDocs(collection(...))` |
| Textos institucionais parametrizados | `ORG_CONFIG.nomeDoSistema`, nunca string fixa |
| Dados para o Firestore higienizados | `_fsClean(dados)` antes de `setDoc` |
| Sem logs de debug em produção | Não comitar `console.log` |

### 4.2 Como adicionar uma nova funcionalidade

1. **Se a funcionalidade é pequena** (novo campo, novo botão, ajuste de lógica): edite diretamente no `processos.html` ou `projetos-logic.js`. Siga as regras acima.

2. **Se a funcionalidade é um bloco novo** (nova tela, novo domínio de dados):
   - Crie o arquivo em `src/processos/nome-do-modulo.js` seguindo o padrão IIFE.
   - Exponha no `globalThis` apenas o que o HTML precisar chamar.
   - Adicione `<script src="src/processos/nome-do-modulo.js"></script>` no `processos.html`.
   - Execute `npm run test:e2e:smoke` antes de comitar.

3. **Acesso a dados novo:** se precisar de uma nova coleção, adicione o repositório correspondente em `src/shared/firestore-repositories.js` e atualize as regras em `firestore.rules`.

### 4.3 Como rodar localmente

```bash
# 1. Criar configuração local (só na primeira vez)
cp config/config.example.js config/config.local.js
# Preencher as chaves do ambiente de desenvolvimento

# 2. Iniciar o emulador Firebase
firebase emulators:start

# 3. Servir os arquivos estáticos
npx serve .
```

### 4.4 Como rodar os testes

```bash
# Variáveis necessárias
export TEST_EMAIL="usuario@dominio.gov.br"
export TEST_PASSWORD="senha"

npm run test:e2e:smoke       # Navegação básica e login — rodar sempre
npm run test:e2e:projetos    # Módulo de projetos
```

O smoke test deve passar após qualquer alteração. Se falhar, não comitar.

---

## 5. Segurança

### O que já está implementado

- **Autenticação obrigatória** — Firebase Auth em todas as rotas. Sem login, sem acesso.
- **Proxy de IA autenticado** — a Cloud Function valida o token Firebase antes de chamar o Azure OpenAI. A chave da IA nunca sai do Secret Manager.
- **Sanitização de HTML** — `esc()` escapa os 5 caracteres críticos em toda saída dinâmica.
- **Sanitização de URLs** — `safeUrl()` rejeita `http://`, `javascript:` e qualquer esquema que não seja `https://`.
- **Proteção contra prototype pollution** — `_fsClean()` bloqueia `__proto__`, `constructor` e `prototype` antes de gravar no Firestore.
- **Auto-logout** — sessão encerrada após 5 minutos de inatividade, com aviso de 30 segundos.
- **CI/CD sem segredos** — nenhuma credencial no código; tudo via Secret Manager e GitHub Secrets.
- **Análise estática** — CodeQL + SonarCloud automáticos a cada push.

### Dívidas de segurança conhecidas e priorizadas

| Problema | Risco | O que fazer |
|----------|-------|------------|
| `config/usuarios` legível sem autenticação — expõe e-mails e perfis de todos os usuários | **Alto** | Criar Cloud Function `checkEmail(email)` que retorna apenas `{exists: boolean}` e mudar a regra para exigir autenticação |
| Regras Firestore não impõem perfis server-side — qualquer usuário autenticado pode escrever em qualquer coleção via SDK | **Alto** | Implementar Firebase Custom Claims e atualizar as regras Firestore para verificar `request.auth.token.perfil` |
| Cloud Storage sem restrição de tamanho | Médio | Adicionar `request.resource.size < 20 * 1024 * 1024` nas regras de escrita |

Essas três dívidas estão documentadas, priorizadas e com solução planejada. A primeira é a mais urgente.

---

## 6. Como transformar o sistema em manutenível

O caminho é extrair gradualmente o código do monolito `processos.html` para módulos em `src/processos/`. A cada extração, o arquivo fica menor e o código novo fica testável de forma isolada.

### 6.1 Como fazer uma extração (passo a passo)

Este é o processo para extrair qualquer módulo do monolito:

**Antes de começar:**
1. Identificar todas as funções relacionadas ao módulo dentro de `processos.html`.
2. Mapear as variáveis globais que essas funções leem ou escrevem.
3. Mapear todos os `onclick="..."` que chamam essas funções.
4. Criar testes E2E cobrindo os fluxos principais do módulo.
5. Rodar `npm run test:e2e:smoke` — deve passar.

**Durante a extração:**
1. Criar `src/processos/nome-do-modulo.js` com o padrão IIFE.
2. Mover as funções para o novo arquivo.
3. Expor no `globalThis` apenas as funções chamadas por `onclick` no HTML.
4. Adicionar `<script src="src/processos/nome-do-modulo.js"></script>` no `processos.html` antes do bloco onde as funções eram definidas.
5. Remover as funções do `processos.html`.

**Depois de extrair:**
1. Rodar `npm run test:e2e:smoke` — deve continuar passando.
2. Testar manualmente o módulo extraído no navegador.
3. Comitar com mensagem descritiva (`feat: extrair módulo X para src/processos/`).
4. Atualizar a tabela de progresso na seção 6.3 deste documento.

Quando o módulo estiver completamente extraído e com testes dedicados, substituir os `onclick` por `addEventListener` dentro do arquivo do módulo e remover a exposição global desnecessária.

### 6.2 Fases do plano

#### Fase 1 — Módulos isolados (baixo risco)

Módulos com poucas dependências externas. Começar aqui.

| Módulo | Tamanho estimado | Testes E2E |
|--------|-----------------|------------|
| Notificações / e-mail | ~600 linhas | Criar antes de extrair |
| Avisos | ~400 linhas | Criar antes de extrair |
| Auditoria de processos | ~1.500 linhas | Já existem |
| Backup e restauração | ~300 linhas | Criar antes de extrair |

Meta: `processos.html` com ~14.000 linhas ao final.

#### Fase 2 — Gestão de dados (médio risco)

Módulos com acesso a Firestore e dependências de outros módulos.

| Módulo | Tamanho estimado |
|--------|-----------------|
| Arquitetura organizacional | ~1.000 linhas |
| KPIs / Indicadores | ~2.000 linhas |
| Metas / PAT | ~800 linhas |
| Solicitações | ~1.200 linhas |
| Administração de usuários | ~800 linhas |

Meta: `processos.html` com ~8.000 linhas ao final.

#### Fase 3 — Núcleo do mapeamento (alto risco)

O core do sistema. Extrair por último, quando os módulos periféricos já estiverem fora.

| Módulo | Tamanho estimado |
|--------|-----------------|
| Editor BPMN | ~2.500 linhas |
| Ciclo de vida do processo | ~800 linhas |
| Etapas: Abertura, Modelagem, Formalização | ~3.600 linhas |
| Geração de POP e PPT | ~2.300 linhas |
| Dashboard | ~1.000 linhas |

Meta: `processos.html` com menos de 2.000 linhas — apenas estrutura HTML, sem lógica.

### 6.3 Estado atual da extração

| Módulo já extraído | Arquivo | Linhas |
|--------------------|---------|--------|
| Autenticação e login | `src/shared/auth/auth-controller.js` | ~150 |
| Estado do usuário logado | `src/shared/users/users-state.js` | ~80 |
| Permissões por perfil | `src/shared/users/users-permissions.js` | ~80 |
| Navegação / Hub central | `src/shared/navigation/navigation-controller.js` | ~70 |
| Constantes do domínio | `src/processos/app-constants.js` | ~120 |
| Sanitização HTML e URLs | `src/processos/security-utils.js` | ~60 |
| Acesso ao localStorage | `src/processos/storage-utils.js` | ~80 |
| Branding institucional | `src/processos/org-branding.js` | ~100 |
| Controller do hub | `src/processos/module-hub-controller.js` | ~70 |
| Edição concorrente | `src/processos/concurrent-edit.js` | ~90 |
| Auto-logout por inatividade | `src/processos/auto-logout.js` | ~120 |
| Repositórios Firestore (11 domínios) | `src/shared/firestore-repositories.js` | ~300 |

**Total extraído:** ~1.300 linhas. **Restante no monolito:** ~16.700 linhas.

### 6.4 Métricas para acompanhar o progresso

| Métrica | Hoje | Meta Fase 1 | Meta Fase 2 | Meta Final |
|---------|------|-------------|-------------|------------|
| Linhas em `processos.html` | ~18.000 | ~14.400 | ~8.600 | < 2.000 |
| Módulos independentes em `src/` | 11 | 16 | 21 | 34 |
| Variáveis globais (`window.*`) | 20+ | 15 | 8 | 0 |
| Handlers `onclick` inline | 300+ | 200 | 100 | 0 |
| Cobertura testes E2E | ~40% | ~55% | ~75% | ~95% |
| Tempo estimado de onboarding | 2–3 semanas | 1–2 semanas | 5–7 dias | 2–3 dias |

---

## 7. Documentação adicional

| Documento | Onde encontrar | Conteúdo |
|-----------|---------------|---------- |
| Arquitetura geral | `docs/architecture/index.md` | Visão geral das camadas e regras |
| Plano detalhado de modularização | `docs/architecture/PLANO-MODULARIZACAO.md` | Checklist por módulo e cronograma |
| Camadas do front-end | `docs/architecture/frontend-layers.md` | Responsabilidade de cada camada |
| Roadmap backend | `docs/architecture/frontend-backend-roadmap.md` | Cloud Functions, APIs e segurança |
| Multi-tenant | `docs/architecture/tenancy.md` | Plano para múltiplos órgãos |
| Avaliação de produto | `docs/avaliacao-produto-2026-05.md` | Diagnóstico técnico completo (maio/2026) |
| Checklist de deploy | `docs/deployment/checklist.md` | Passos para publicar em produção |
| Histórico de segurança | `docs/security/CHANGELOG-FASE1.md` | O que foi corrigido e quando |
