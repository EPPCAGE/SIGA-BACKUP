# Avaliação do Produto SIGA 2.0 — Maio 2026

Avaliação de qualidade de produto com foco em segurança, estrutura, organização e
entendibilidade. Não é uma auditoria formal — é um diagnóstico técnico honesto para
orientar as próximas decisões de desenvolvimento.

---

## Resumo executivo

O sistema está funcional, bem documentado para um sistema deste porte, e tem uma
estrutura de CI/CD e segredos sólida. O maior problema técnico é a concentração de
~18 mil linhas de código em um único arquivo HTML (`processos.html`), o que dificulta
manutenção, revisão e crescimento. Em segurança, o ponto crítico é que as regras do
Firestore não impõem restrições de perfil — qualquer usuário autenticado pode escrever
em qualquer coleção contornando a UI.

**Classificação geral por dimensão:**

| Dimensão          | Nota | Comentário                                          |
|-------------------|------|-----------------------------------------------------|
| Segurança         | 5/10 | Bom na camada de borda; fraco no Firestore server-side |
| Estrutura         | 4/10 | Monolito dominante; modularização iniciada mas incipiente |
| Organização       | 7/10 | Docs existem; CI/CD funciona; convenções parciais   |
| Entendibilidade   | 6/10 | README bom; código do monolito difícil de navegar   |

---

## 1. Segurança

### 1.1 O que está bom

- **Cloud Function `/ai`**: CORS restrito a origens explícitas, verificação de ID Token
  Firebase, limite de payload (20 KB), timeout de 30s, segredos via Secret Manager.
  Tudo correto.

- **CI/CD sem segredos no código**: `FIREBASE_API_KEY`, `AI_FUNCTION_URL` e
  `FIREBASE_SERVICE_ACCOUNT` injetados via GitHub Secrets. `AZURE_OPENAI_KEY` nunca
  sai do Secret Manager. Nenhuma credencial hardcoded no repositório.

- **Proteção contra prototype pollution**: `_fsClean()` em `projetos-logic.js` bloqueia
  chaves `__proto__`, `constructor`, `prototype` antes de escrever no Firestore.

- **Sanitização de HTML**: `esc()` em `security-utils.js` escapa os 5 caracteres
  HTML críticos (`&`, `<`, `>`, `"`, `'`).

- **Auto-logout por inatividade**: sessão encerrada após 5 min idle, com aviso de 30s.

- **CodeQL + SonarCloud**: análise estática automática a cada push.

### 1.2 Problemas identificados

#### CRÍTICO — Leitura pública da coleção `config/`

**Arquivo:** `firestore.rules` linha 13  
**Risco:** A regra `allow read: if true` expõe **sem autenticação**:
- `config/usuarios`: e-mails, perfis, flags de acesso de todos os usuários
- `config/ejs`: Service ID e Template ID do EmailJS (credenciais de envio de e-mail)
- `config/mapeados`, `config/criticos`: dados de negócio

Qualquer pessoa com o Project ID do Firebase (visível publicamente na URL do app)
pode listar esses documentos sem login.

**Causa:** o fluxo de auto-cadastro verifica se o e-mail já existe em
`config/usuarios` antes de completar o login Firebase.

**Solução recomendada:**
1. Criar uma Cloud Function pública (`checkEmail`) que recebe um e-mail e retorna
   apenas `{exists: boolean}` — sem expor o documento completo.
2. Mudar a regra `config/{docId}` para `allow read: if isAuth()`.

#### ALTO — Regras Firestore não impõem perfis

**Arquivo:** `firestore.rules`  
**Risco:** Qualquer usuário autenticado pode escrever em qualquer coleção diretamente
via SDK (Firebase Console, script de terceiro, extensão de browser). Um usuário com
perfil `dono` pode, por exemplo, deletar processos de outros donos ou modificar KPIs.

O controle de acesso por perfil existe apenas no JavaScript do cliente — que pode
ser contornado trivialmente por qualquer pessoa com uma conta no sistema.

**Solução recomendada (médio prazo):**
1. Usar Firebase Admin SDK para atribuir Custom Claims ao criar/editar usuários:
   ```js
   await admin.auth().setCustomUserClaims(uid, { perfil: 'ep' });
   ```
2. Usar o claim nas regras:
   ```
   allow write: if isAuth() && request.auth.token.perfil == 'ep';
   ```

#### MÉDIO — `safeUrl()` aceitava `http://` *(corrigido neste commit)*

**Arquivo:** `src/processos/security-utils.js`  
URLs `http://` (sem TLS) eram permitidas pela função `safeUrl()`. Um atacante com
acesso de escrita poderia injetar links que levassem usuários a origens não-seguras.
Corrigido para aceitar apenas `https://`.

#### MÉDIO — Storage: qualquer usuário autenticado pode fazer upload

**Arquivo:** `storage.rules`  
Qualquer usuário com login pode fazer upload em `projetos/`, `publicacoes/` e
`auditoria/`. Não há verificação de tamanho de arquivo, tipo MIME, ou perfil.

**Risco prático:** usuário `dono` pode fazer upload de um arquivo enorme em
`publicacoes/`, consumindo cota de Storage.

**Solução:** adicionar restrições de tamanho:
```
allow write: if isAuth() && request.resource.size < 20 * 1024 * 1024;
```

#### BAIXO — ID Token enviado no body (não no header)

**Arquivo:** `functions/index.js` linha 33  
O token Firebase é enviado no campo `_token` do corpo da requisição em vez do
header `Authorization: Bearer`. O motivo documentado é evitar preflight CORS.
Funcionalmente correto (o token é verificado via `admin.auth().verifyIdToken()`),
mas diverge da convenção HTTP padrão e dificulta o uso de proxies/WAFs que
inspecionam headers.

Risco real baixo, já que o CORS está configurado corretamente. Registrado para
conhecimento.

---

## 2. Estrutura

### 2.1 O que está bom

- **Camada `src/shared/`**: repositórios Firestore, tenant config, org config e
  Firebase helpers estão bem isolados e reutilizáveis.

- **`src/processos/`**: extração incremental em andamento com módulos coesos
  (`security-utils`, `storage-utils`, `app-constants`, `org-branding`).

- **`_fsClean()`**: camada de limpeza de dados antes de persistir no Firestore,
  com proteção contra tipos inválidos e prototype pollution.

- **Detecção de edição concorrente**: sentinel `config/last_modified` previne
  sobrescrita silenciosa de dados.

### 2.2 Problemas identificados

#### CRÍTICO — `processos.html` com ~18 mil linhas

O arquivo único mistura HTML estrutural, CSS inline, lógica de negócio, manipulação
de DOM, acesso a dados e renderização. Impossível revisar, difícil de testar
isoladamente, propenso a regressões invisíveis.

**Linha de corte para extração prioritária:**
- Módulo de Auditoria
- Módulo de Indicadores (KPIs)
- Lógica de mapeamento (pipeline AS-IS / TO-BE)

Cada módulo deve virar um arquivo `.js` em `src/processos/` e ser carregado via
`<script src="...">` no HTML, que passa a ser apenas o esqueleto estrutural.

#### ALTO — `projetos-logic.js` com nome enganoso

`projetos-logic.js` contém exclusivamente a lógica do **módulo de projetos** (4.9 mil linhas),
mas o nome sugere ser um arquivo utilitário genérico. Isso causará confusão ao
onboarding de novos desenvolvedores.

**Ação:** renomear para `projetos-logic.js` ou `src/projetos/projetos-logic.js`
como parte da próxima sessão de modularização.

#### ALTO — Repositório duplicado *(corrigido neste commit)*

`projetosUsuariosRepository` e `projetosRepository` apontavam para a mesma coleção
`projPROJETOS` via chamadas separadas a `collectionRepository()`, criando duas
instâncias distintas do mesmo repositório. Corrigido para usar alias.

#### MÉDIO — Nomenclatura inconsistente de coleções

Coleções do módulo de projetos usam `PascalCase` maiúsculo (`projPROJETOS`,
`projPROGRAMAS`) enquanto todas as demais usam `snake_case` minúsculo (`processos`,
`kpis`, `plano_metas`). Isso não é só estético — dificulta queries, buscas no código
e regras do Firestore.

Renomear coleções Firestore exige migração de dados. Planejar como parte de uma
release de manutenção.

#### BAIXO — Carregamento de config com fallback de compatibilidade

A config tenta carregar de dois caminhos (`config/config.local.js` e
`config.local.js`). Esse padrão de compatibilidade retroativa é frágil — erros de
carregamento falham silenciosamente.

---

## 3. Organização

### 3.1 O que está bom

- **CI/CD completo**: deploy automático ao `main` com injeção de segredos, publicação
  de regras Firestore, e análise CodeQL.

- **Documentação em `docs/`**: arquitetura, modularização, tenancy, roadmap e
  checklist de deploy documentados.

- **README.md**: cobre módulos, perfis, pipeline, integrações e segurança.

- **Baseline funcional**: checkpoint com SHA de commit para rollback documentado.

- **Testes E2E**: cobertura de smoke, mapeamento, aderência e projetos.

### 3.2 Problemas identificados

#### MÉDIO — Sem ponto de entrada explícito (index.html)

O sistema começa em `processos.html`, que funciona tanto como hub quanto como módulo.
Não existe `index.html`. Isso é não-convencional e confunde ferramentas que assumem
`index.html` como raiz (Firebase Hosting redireciona automaticamente para
`processos.html` via `firebase.json`, mas esse comportamento não é óbvio).

#### MÉDIO — Ausência de CLAUDE.md *(criado neste commit)*

Sem um guia de entrada para o repositório, qualquer desenvolvedor novo precisa ler o
README inteiro antes de entender onde tocar. O `CLAUDE.md` criado neste commit supre
isso com um mapa direto das convenções, estrutura e dívidas conhecidas.

#### BAIXO — Separação entre `projetos.html`, `projetos.shared.js` e `projetos-logic.js`

O módulo de projetos está dividido em três arquivos sem separação clara de
responsabilidades entre eles. A convenção "o que vai em cada arquivo" não está
documentada.

---

## 4. Entendibilidade

### 4.1 O que está bom

- Uso de `Object.freeze()` para constantes (`PERFIL`, `STATUS_PLANO` etc.) deixa
  claro que são enumerações imutáveis.

- IIFEs em `src/` com nomes descritivos (`initSecurityUtils`, `initAppConstants`)
  deixam o escopo e propósito claro.

- `_fsClean` com nomes de função internos explícitos (`_fsCleanArray`,
  `_fsCleanObject`, `_fsCleanScalar`, `_fsCanCleanObject`, `_fsCleanKeyAllowed`).

### 4.2 Problemas identificados

#### ALTO — Handlers inline no HTML (`onclick="fn()"`)

`processos.html` usa extensivamente `onclick="nomeDeAlgumaFuncaoGlobal()"`. Isso
significa que todas as funções de UI precisam estar no escopo global — o que impede
o uso de módulos ES, dificulta rastrear quem chama o quê, e torna refatorações
arriscadas.

Durante a modularização, substituir handlers inline por `addEventListener` nos módulos
extraídos.

#### MÉDIO — Estado global implícito via `window.*`

Variáveis como `usuarioLogado`, `processoAtual`, `_projCurrentId` são globais.
Mudanças de estado em um módulo afetam silenciosamente outros. Isso é aceitável no
monolito atual, mas precisa ser endereçado antes de qualquer modularização séria.

---

## 5. Ações prioritárias (backlog de produto)

### Imediatas (sem risco de regressão)

| # | Ação | Impacto |
|---|------|---------|
| 1 | ✅ Restringir `safeUrl()` a `https://` | Segurança |
| 2 | ✅ Corrigir repositório duplicado `projetosUsuariosRepository` | Estrutura |
| 3 | ✅ Documentar dívida de segurança nas regras Firestore | Organização |
| 4 | ✅ Restringir escrita em `usuarios/{uid}` ao próprio usuário | Segurança |
| 5 | ✅ Criar `CLAUDE.md` como guia de entrada | Entendibilidade |
| 6 | Adicionar restrição de tamanho no `storage.rules` | Segurança |

### Curto prazo (requer planejamento e testes)

| # | Ação | Impacto |
|---|------|---------|
| 7 | Criar Cloud Function `checkEmail` e remover leitura pública de `config/` | Segurança crítica |
| 8 | Implementar Firebase Custom Claims para perfis | Segurança alta |
| 9 | Renomear `projetos-logic.js` → `projetos-logic.js` | Estrutura |
| 10 | Extrair 2-3 módulos de `processos.html` para `src/processos/` | Estrutura |

### Médio prazo (arquiteturais)

| # | Ação | Impacto |
|---|------|---------|
| 11 | Migrar handlers inline para `addEventListener` nos módulos extraídos | Estrutura/Manutenibilidade |
| 12 | Normalizar nomenclatura das coleções Firestore (`projPROJETOS` → `projetos`) | Organização |
| 13 | Criar `index.html` como entry point explícito | Organização |
| 14 | Ampliar cobertura de testes E2E para fluxos críticos (KPIs, auditoria) | Qualidade |

---

*Gerado em 2026-05-10. Revisitar após implementação das ações imediatas.*
