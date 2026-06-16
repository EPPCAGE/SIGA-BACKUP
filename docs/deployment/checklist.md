# Checklist de Implantacao

Este checklist orienta a preparacao de uma nova instalacao do SIGA para outra organizacao.

## 1. Configuracao institucional

- Copiar `config/config.example.js` para `config/config.deploy.js`.
- Preencher `ORG.systemName`, `ORG.systemBrand`, `ORG.organizationName` e `ORG.institutionName`.
- Ajustar `ORG.epProfileLabel`, `ORG.supportTeamLabel`, `ORG.epTeamName` e `ORG.epTeamEmail`.
- Configurar `ORG.allowedDomains` com os dominios de e-mail autorizados.
- Configurar `ORG.domainProfiles` para definir o perfil padrao por dominio.
- Ajustar `ORG.logos.app` e `ORG.logos.organization` para os arquivos de imagem do cliente.

## 2. Credenciais e servicos

- Preencher `FIREBASE_API_KEY`.
- Preencher `AI_FUNCTION_URL`, caso a IA esteja habilitada.
- Configurar Firebase Auth para os dominios autorizados.
- Configurar Firestore e regras de seguranca.
- Configurar Storage, caso arquivos ou imagens de fluxo sejam usados.
- Configurar EmailJS ou substituir por backend proprio de e-mail.

## 3. Dados iniciais

- Revisar arquitetura de processos inicial.
- Revisar usuarios administradores iniciais.
- Revisar publicacoes, indicadores e plano anual padrao.
- Remover dados de exemplo que sejam especificos da CAGE, se a instalacao for para outro cliente.

## 4. Validacao funcional

- Testar login com usuario administrador.
- Testar primeiro acesso de usuario comum.
- Testar criacao de solicitacao.
- Testar conversao de solicitacao em mapeamento.
- Testar conversao de solicitacao em analise de aderencia.
- Testar envio de notificacao.
- Testar relatorios PDF/PPT.
- Testar permissoes por perfil.

## 5. Entrega

- Garantir que `config/config.local.js` e `config/config.deploy.js` reais nao foram versionados.
- Registrar versao entregue e data de publicacao.
- Documentar URL de acesso, responsavel tecnico e responsavel funcional.
- Definir rotina de backup, suporte e atualizacao.
