# Plano de Modularização do SIGA 2.0

**Data:** 11/05/2026  
**Status:** Em planejamento  
**Abordagem:** Gradual, módulo por módulo, com testes E2E antes de cada extração

---

## 📊 Análise Atual

### Tamanho do monolito
- **Arquivo:** `processos.html`
- **Linhas totais:** ~18.000
- **Código JavaScript:** ~15.000 linhas
- **Variáveis globais:** 20+
- **Handlers inline (`onclick`):** 300+

---

## 🎯 Estratégia de Modularização

### Princípios
1. ✅ **Gradual:** Um módulo por vez
2. ✅ **Testado:** Criar testes E2E antes de extrair
3. ✅ **Reversível:** Cada commit pode ser revertido facilmente
4. ✅ **Compatível:** Manter funcionamento global durante transição
5. ✅ **Store por módulo:** Criar state manager específico ao extrair

### Ordem de prioridade
- **Baixo risco primeiro:** Módulos isolados, sem dependências críticas
- **Alto valor depois:** Módulos complexos que mais se beneficiam da modularização

---

## � Código Compartilhado (projetos.shared.js)

**Problema identificado:** ~300 linhas de código duplicado entre `processos.html` e `projetos.html`

### Conteúdo de `projetos.shared.js`:
- ✅ Autenticação e login (`doLogin`, `togglePrimeiroAcesso`)
- ✅ Gestão de perfis (`isEP`, `isDono`, `isGerenteProjeto`, `getPerfisUsuario`)
- ✅ Verificação de acesso (`hasProcessosAccess`, `hasProjetosAccess`)
- ✅ Navegação entre módulos (`mostrarHub`, `abrirModuloProcessos`, `abrirModuloProjetos`)
- ✅ Gestão de usuários (`USUARIOS`, `usuarioLogado`, `_carregarUsuariosFirebase`)
- ✅ Sistema de permissões (`aplicarPermissoes`)

**Este código precisa ser extraído PRIMEIRO** para evitar duplicação e facilitar manutenção.

---

## 📋 Módulos Identificados (22 módulos)

| # | Módulo | Linhas | Risco | Prioridade | Testes E2E | Depende de |
|---|--------|--------|-------|------------|------------|------------|
| **FASE 0: Código compartilhado (PRIORIDADE MÁXIMA)** |
| 1 | 🔐 Auth/Login | ~150 | ⚪ Baixo | 🔥🔥🔥 Crítica | ❌ Criar | Firebase Auth |
| 2 | 👤 Perfis/Usuários | ~80 | ⚪ Baixo | 🔥🔥🔥 Crítica | ❌ Criar | Firestore |
| 3 | 🧭 Navegação/Hub | ~70 | ⚪ Baixo | 🔥🔥🔥 Crítica | ❌ Criar | Auth |
| **FASE 1: Fundação (baixo risco, alto isolamento)** |
| 5 | 📢 Notificações/Email | ~600 | ⚪ Baixo | 🔥 Alta | ❌ Criar | EmailJS |
| 6 | 🔔 Avisos | ~400 | ⚪ Baixo | 🔥 Alta | ❌ Criar | - |
| 7 | 📊 Auditoria | ~1.500 | ⚪ Baixo | 🔥 Alta | ✅ Existe | BPMN |
| 8 | 💾 Backup/Restore | ~300 | ⚪ Baixo | 🟡 Média | ❌ Criar | - |
| **FASE 2: Gestão de dados (médio risco)** |
| 9 | 🏗️ Arquitetura | ~1.000 | 🟡 Médio | 🟡 Média | ❌ Criar | - |
| 10 | 📈 KPIs/Indicadores | ~2.000 | 🟡 Médio | 🔥 Alta | ❌ Criar | IA, Processos |
| 11 | 🎯 Metas/PAT | ~800 | 🟡 Médio | 🟡 Média | ❌ Criar | - |
| 12 | 📝 Solicitações | ~1.200 | 🟡 Médio | 🔥 Alta | ❌ Criar | Processos, Email |
| 13 | 👥 Admin Usuários | ~800 | 🟡 Médio | 🟡 Média | ❌ Criar | Auth, Firestore |
| **FASE 3: Mapeamento (alto risco, alto acoplamento)** |
| 14 | 🗺️ BPMN Editor | ~2.500 | 🔴 Alto | 🔥 Alta | ✅ Existe | BpmnJS |
| 15 | 📋 Ciclo de vida | ~800 | 🔴 Alto | 🔥 Alta | ✅ Existe | Processos |
| 16 | 🎭 Etapas: Abertura | ~600 | 🔴 Alto | 🟡 Média | ✅ Existe | BPMN |
| 17 | 🎭 Etapas: Modelagem | ~1.800 | 🔴 Alto | 🔥 Alta | ✅ Existe | BPMN, IA |
| 18 | 🎭 Etapas: Formalização | ~1.200 | 🔴 Alto | 🟡 Média | ✅ Existe | POP, PPT |
| 19 | 🎭 Etapas: Operação | ~400 | 🔴 Alto | 🟡 Média | ❌ Criar | - |
| 20 | 🎭 Etapas: Auditoria Proc | ~600 | 🔴 Alto | 🟡 Média | ❌ Criar | - |
| 21 | 📄 Geração de POP | ~1.500 | 🟡 Médio | 🔥 Alta | ❌ Criar | IA, BPMN |
| 22 | 📊 Geração de PPT | ~800 | 🟡 Médio | 🟡 Média | ❌ Criar | IA |
| 23 | 📊 Dashboard | ~1.000 | 🟡 Médio | 🟡 Média | ❌ Criar | KPIs, Processos |

**Total:** ~20.400 linhas a serem extraídas

---

## 🗓️ Cronograma Sugerido

### **Fase 0: Código compartilhado** (1 semana) ⭐ **INÍCIO OBRIGATÓRIO**
Extrair código usado por AMBOS os módulos (processos e projetos)

**Semana 1:**
- ✅ Análise de duplicação (`projetos.shared.js` vs `processos.html`)
- 🔐 Módulo Auth/Login compartilhado (150 linhas)
- 👤 Módulo Perfis/Usuários compartilhado (80 linhas)
- 🧭 Módulo Navegação/Hub compartilhado (70 linhas)
- 📝 Atualizar ambos módulos para usar código compartilhado
- 🧪 Validar ambos módulos funcionando

**Resultado:** ~300 linhas extraídas para `src/shared/`, zero duplicação

---

### **Fase 1: Fundação** (3-4 semanas)
### **Fase 1: Fundação** (3-4 semanas)
Extrair módulos isolados e de baixo risco

**Semana 2:**
- ✅ Estrutura base de modularização
- 📢 Módulo Notificações (600 linhas)

**Semana 3:**
- 🔔 Módulo Avisos (400 linhas)
- 📊 Módulo Auditoria (1.500 linhas)

**Semana 4:**
- 💾 Módulo Backup (300 linhas)
- 📝 Documentação e validação

**Resultado:** ~3.600 linhas extraídas, sistema 20% mais modular

---

### **Fase 2: Gestão de dados** (4-5 semanas)

**Semana 5:**
- 🏗️ Módulo Arquitetura (1.000 linhas)

**Semana 6:**
- 📈 Módulo KPIs (2.000 linhas)

**Semana 7:**
- 🎯 Módulo Metas (800 linhas)
- 📝 Módulo Solicitações (1.200 linhas)

**Semana 8:**
- 👥 Módulo Admin Usuários (800 linhas)

**Semana 9:**
- 📝 Testes e validação

**Resultado:** ~5.800 linhas adicionais, sistema 50% mais modular

---

### **Fase 3: Mapeamento** (6-8 semanas)

**Semana 10-11:**
- 🗺️ Módulo BPMN Editor (2.500 linhas)

**Semana 12:**
- 📋 Módulo Ciclo de vida (800 linhas)

**Semana 13-14:**
- 🎭 Módulos de Etapas: Abertura, Modelagem (2.400 linhas)

**Semana 15:**
- 🎭 Módulos de Etapas: Formalização, Operação, Auditoria (2.200 linhas)

**Semana 16:**
- 📄 Módulo Geração POP (1.500 linhas)
- 📊 Módulo Geração PPT (800 linhas)

**Semana 17:**
- 📊 Módulo Dashboard (1.000 linhas)
- 📝 Validação final

**Resultado:** ~11.200 linhas adicionais, **sistema 100% modularizado!**

---

## 📁 Estrutura de diretórios proposta

```
src/
├── shared/                    # ⭐ FASE 0: Código compartilhado entre módulos
│   ├── firebase-helpers.js    # (já existe)
│   ├── firestore-repositories.js  # (já existe)
│   ├── org-config.js          # (já existe)
│   ├── tenant-config.js       # (já existe)
│   ├── auth/                  # ⭐ NOVO: Autenticação compartilhada
│   │   ├── auth-state.js      # Estado do usuário logado
│   │   ├── auth-controller.js # Login, logout, primeiro acesso
│   │   └── auth-ui.js         # UI de login
│   ├── users/                 # ⭐ NOVO: Gestão de usuários compartilhada
│   │   ├── users-repository.js   # Acesso ao Firestore config/usuarios
│   │   ├── users-permissions.js  # isEP(), isDono(), etc
│   │   └── users-types.js        # PERFIL_LABELS, tipos
│   └── navigation/            # ⭐ NOVO: Navegação compartilhada
│       ├── hub-controller.js  # Hub central de módulos
│       ├── module-router.js   # Roteamento entre processos/projetos
│       └── hub-ui.js          # Interface do hub
├── processos/
│   ├── core/
│   │   ├── state-manager.js       # Store centralizado (criado gradualmente)
│   │   ├── event-bus.js           # Sistema de eventos entre módulos
│   │   └── router.js              # Navegação entre telas
│   ├── notificacoes/
│   │   ├── notificacoes-state.js
│   │   ├── notificacoes-renderer.js
│   │   ├── notificacoes-controller.js
│   │   └── email-service.js
│   ├── avisos/
│   │   └── ...
│   ├── auditoria/
│   │   └── ...
│   ├── kpis/
│   │   └── ...
│   ├── solicitacoes/
│   │   └── ...
│   ├── bpmn/
│   │   ├── bpmn-editor.js
│   │   ├── bpmn-renderer.js
│   │   └── bpmn-validators.js
│   ├── etapas/
│   │   ├── abertura/
│   │   ├── modelagem/
│   │   ├── formalizacao/
│   │   ├── operacao/
│   │   └── auditoria/
│   ├── geracao/
│   │   ├── pop-generator.js
│   │   └── ppt-generator.js
│   └── dashboard/
│       └── ...
└── projetos/                  # Módulo de projetos (usa src/shared/)
    ├── core/
    │   └── ...
    ├── portfolio/
    │   └── ...
    └── programas/
        └── ...
```

---

## ✅ Checklist por módulo

Para cada módulo extraído:

### Antes de extrair
- [ ] Identificar todas as funções do módulo
- [ ] Mapear variáveis globais usadas
- [ ] Mapear handlers inline (`onclick`)
- [ ] Criar testes E2E cobrindo funcionalidade principal
- [ ] Documentar dependências externas

### Durante extração
- [ ] Criar arquivos em `src/processos/{modulo}/`
- [ ] Criar state manager local do módulo
- [ ] Substituir `onclick` por `addEventListener`
- [ ] Expor apenas o necessário em `globalThis` (transição)
- [ ] Adicionar comentários explicativos

### Após extração
- [ ] Rodar testes E2E (garantir que nada quebrou)
- [ ] Rodar `npm run test:e2e:smoke`
- [ ] Validar manualmente a funcionalidade
- [ ] Remover código do `processos.html`
- [ ] Commit individual com mensagem clara
- [ ] Atualizar documentação

---

## 📈 Métricas de sucesso

| Métrica | Início | Meta Fase 0 | Meta Fase 1 | Meta Fase 2 | Meta Fase 3 |
|---------|--------|-------------|-------------|-------------|-------------|
| Duplicação de código | ~300 linhas | 0 | 0 | 0 | 0 |
| Linhas em processos.html | 18.000 | 18.000 | 14.400 | 8.600 | <2.000 |
| Linhas em projetos.shared.js | 300 | 0 | 0 | 0 | 0 |
| Módulos independentes | 0 | 3 | 8 | 13 | 23 |
| Variáveis globais | 20+ | 18 | 13 | 6 | 0 |
| Handlers inline | 300+ | 300+ | 200 | 100 | 0 |
| Cobertura testes E2E | 40% | 45% | 55% | 75% | 95% |
| Tempo onboarding dev | 2-3 sem | 1.5-2 sem | 1-1.5 sem | 5-7 dias | 2-3 dias |

---

## 🚨 Riscos e mitigações

### Risco: Regressão funcional
**Mitigação:** Testes E2E obrigatórios antes e depois de cada extração

### Risco: Performance degradada
**Mitigação:** Medir tempo de carregamento antes/depois de cada módulo

### Risco: Conflitos de estado
**Mitigação:** State manager bem definido desde o início

### Risco: Dependências circulares
**Mitigação:** Event bus para comunicação entre módulos

---

## 🎯 Próximo passo imediato

**⭐ Iniciar FASE 0 extraindo código compartilhado:**

### Etapa 1: Análise de duplicação (2h)
1. Mapear todas as funções duplicadas entre `processos.html` e `projetos.shared.js`
2. Identificar dependências de cada função
3. Planejar ordem de extração

### Etapa 2: Módulo Auth/Login (1 dia)
1. Criar branch `feature/fase0-auth-compartilhado`
2. Criar `src/shared/auth/auth-controller.js`
3. Mover `doLogin()`, `togglePrimeiroAcesso()`, etc.
4. Atualizar `processos.html` e `projetos.html` para usar módulo compartilhado
5. Testar login em ambos módulos

### Etapa 3: Módulo Perfis/Usuários (1 dia)
1. Criar `src/shared/users/users-permissions.js`
2. Mover `isEP()`, `isDono()`, `getPerfisUsuario()`, etc.
3. Atualizar ambos módulos
4. Testar permissões em ambos módulos

### Etapa 4: Módulo Navegação/Hub (1 dia)
1. Criar `src/shared/navigation/hub-controller.js`
2. Mover `mostrarHub()`, `abrirModuloProcessos()`, etc.
3. Atualizar ambos módulos
4. Testar navegação entre módulos

### Etapa 5: Remover `projetos.shared.js` (2h)
1. Validar que todo código foi migrado
2. Remover arquivo `projetos.shared.js`
3. Remover `<script src="projetos.shared.js">` de `projetos.html`
4. Merge na main

**Tempo total estimado:** 3-4 dias  
**Linhas extraídas:** ~300  
**Linhas duplicadas removidas:** ~300  
**Risco:** ⚪ Baixo (código já testado em produção)

---

*Última atualização: 11/05/2026*
