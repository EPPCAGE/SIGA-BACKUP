const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const ALLOWED_ORIGINS = new Set([
  "https://eppcage.com.br",
  "https://www.eppcage.com.br",
  "https://eppcage.github.io",
  "https://sigaepp.web.app",
  "https://sigaepp.firebaseapp.com",
]);

const AZURE_KEY      = defineSecret("AZURE_OPENAI_KEY");
const AZURE_ENDPOINT = defineSecret("AZURE_OPENAI_ENDPOINT");
const AZURE_DEPLOY   = defineSecret("AZURE_OPENAI_DEPLOYMENT");

const MAX_PAYLOAD_BYTES = 20 * 1024; // 20 KB

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Vary", "Origin");
}

async function verifyToken(req, res) {
  // Aceitar token do body (_token) ou do header Authorization
  let idToken = req.body?._token;
  
  // Se não veio no body, tentar pegar do header Authorization
  if (!idToken) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      idToken = authHeader.substring(7); // Remove "Bearer "
    }
  }
  
  if (!idToken) {
    res.status(401).json({ error: "Autenticação necessária" });
    return null;
  }
  
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: "Token inválido ou expirado" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// checkEmail — verifica se um e-mail está cadastrado em config/usuarios.
// Endpoint público (sem auth): elimina a necessidade de leitura pública do
// Firestore para o fluxo de Primeiro Acesso.
// Retorna apenas {exists: boolean} — nunca expõe o documento completo.
// ---------------------------------------------------------------------------
exports.checkEmail = onRequest(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const email = req.body?.email;
  if (!email || typeof email !== "string" || email.length > 254) {
    res.status(400).json({ error: "Campo obrigatório: email" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const doc = await admin.firestore().doc("config/usuarios").get();
    if (!doc.exists) { res.status(200).json({ exists: false }); return; }
    const rawData = doc.data()?.data;
    const usuarios = typeof rawData === "string" ? JSON.parse(rawData) : [];
    const exists = Array.isArray(usuarios) && usuarios.some(u => u?.email === normalizedEmail);
    res.status(200).json({ exists });
  } catch (e) {
    console.error("checkEmail error:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// setUserClaims — atribui Custom Claim {perfil} ao token do usuário autenticado.
// Deve ser chamado logo após o login. O cliente precisa renovar o ID Token
// (getIdToken(true)) após a resposta para que as regras do Firestore recebam
// o claim atualizado.
// ---------------------------------------------------------------------------
exports.setUserClaims = onRequest(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const decoded = await verifyToken(req, res);
  if (!decoded) return;

  try {
    const doc = await admin.firestore().doc("config/usuarios").get();
    const rawData = doc.exists ? doc.data()?.data : null;
    const usuarios = typeof rawData === "string" ? JSON.parse(rawData) : [];
    const user = Array.isArray(usuarios)
      ? usuarios.find(u => u?.email === decoded.email)
      : null;

    const perfil = user?.perfil || "dono";
    await admin.auth().setCustomUserClaims(decoded.uid, { perfil });
    res.status(200).json({ ok: true, perfil });
  } catch (e) {
    console.error("setUserClaims error:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// ai — proxy autenticado para Azure OpenAI.
// ---------------------------------------------------------------------------
exports.ai = onRequest(
  { secrets: [AZURE_KEY, AZURE_ENDPOINT, AZURE_DEPLOY] },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const decoded = await verifyToken(req, res);
    if (!decoded) return;

    // Validate payload size
    if (JSON.stringify(req.body).length > MAX_PAYLOAD_BYTES) {
      res.status(413).json({ error: "Payload muito grande" });
      return;
    }

    const { mode, payload } = req.body || {};
    if (!mode || !payload) {
      res.status(400).json({ error: "Campos obrigatórios: mode, payload" });
      return;
    }

    const SYSTEM = {
      analisar_bpmn: `Você é um especialista em BPM (Business Process Management) e análise de processos.\nAnalise o processo fornecido e retorne um JSON com:\n{\n  "gargalos": ["..."],\n  "retrabalhos": ["..."],\n  "gaps": ["..."],\n  "oportunidades": ["..."],\n  "complexidade": "Baixa|Media|Alta|Muito alta",\n  "resumo": "..."\n}\n\nINSTRUÇÕES PARA O CAMPO "resumo":\n- Escreva 2 a 3 frases em tom construtivo, encorajador e diplomático.\n- Comece reconhecendo o propósito ou o valor do processo para a organização.\n- Aponte 1 ou 2 oportunidades de melhoria, sempre enquadrando como potencial a explorar — nunca como falha ou problema grave.\n- Evite palavras negativas diretas como "falha", "ruim", "precário", "sério problema" ou "grave". Prefira "oportunidade", "ponto de atenção", "pode ser aprimorado", "há espaço para evoluir".\n- O dono do processo deve terminar de ler o resumo sentindo que seu trabalho é valorizado e que há caminhos claros de melhoria.\n\nResponda APENAS com o JSON, sem markdown, sem texto adicional.`,

      gerar_pop: `Você é especialista em redação de Procedimentos Operacionais Padrão (POP) no padrão da administração pública brasileira.\nCom base nas etapas do processo fornecidas, gere um texto estruturado para o POP com as seções:\n1.0 Objetivo, 1.1 Definições, 1.2 Entradas, 1.3 Saídas, 2.0 Atividades (por responsável), 3.0 Documentos correlatos.\nSe o payload incluir "gargalos_confirmados", "oportunidades_confirmadas" ou "solucoes_confirmadas", incorpore essas informações de forma natural no texto do POP: mencione os gargalos como pontos de atenção nas atividades relevantes, inclua as soluções e oportunidades como orientações ou boas práticas dentro das seções pertinentes. Não crie seções separadas para esses itens — integre-os ao corpo do POP.\nSeja objetivo, use linguagem formal e imperativa. Retorne como texto simples sem markdown.`,

      assistente: `Você é um assistente especializado em gestão de processos do Escritório de Processos da CAGE/Sefaz-RS.\nResponda de forma clara, objetiva e em português brasileiro. Contexto do sistema: EP·CAGE é um sistema de mapeamento e gestão de processos institucionais seguindo metodologia BPM.\nLimite suas respostas a 300 palavras.`,

      analisar_indicadores: `Você é especialista em análise de desempenho e indicadores de processos da administração pública.\nO payload pode conter um campo "nota_sisplan" com instruções sobre a convenção de preenchimento, e um array "indicadores".\nANTES de analisar, descarte COMPLETAMENTE os seguintes tipos de indicadores — não os mencione de forma alguma, nem positiva nem negativamente:\n1. Indicadores com "aguardando_fechamento": true (estão nos 2 primeiros meses de um trimestre; o SISPLAN só registra resultados no último mês do trimestre).\n2. Indicadores cujo campo "realizado" é null, undefined, vazio ou igual a zero E que não possuem nenhum dado histórico preenchido — esses indicadores ainda não foram alimentados e não devem ser interpretados como desempenho ruim.\nAnalise APENAS os indicadores que possuem dados válidos. Com base neles, gere um comentário analítico conciso (máximo 150 palavras) destacando:\n- Indicadores que merecem atenção (abaixo da meta)\n- Tendências positivas\n- Recomendação principal\nSe não houver nenhum indicador com dados válidos, retorne apenas: "Nenhum indicador com dados disponíveis para análise neste período."\nRetorne APENAS o texto do comentário, sem título, sem markdown.`,

      gerar_ppt: `Você é especialista em gestão de processos e criação de apresentações executivas.\nCom base nas informações do processo fornecidas, gere um JSON com o conteúdo para uma apresentação PowerPoint executiva sobre o mapeamento deste processo. Seja direto, profissional e conciso.\nRetorne APENAS o JSON válido, sem markdown, sem texto adicional.`,

      extrair_pop: `Você é especialista em análise de documentos de gestão pública.\nAnalise o POP (Procedimento Operacional Padrão) fornecido e extraia as informações no formato JSON exato:\n{"nome":"nome do processo","area":"área responsável","objetivo":"objetivo em uma frase","atores":["ator1","ator2"],"etapas":["etapa 1","etapa 2"]}\nRetorne APENAS o JSON, sem texto adicional.`,

      relatorio_auditoria: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base nos dados da análise de aderência fornecidos, elabore um Relatório Executivo de Análise de Aderência completo e profissional.\nUse sempre os termos "análise de aderência", "processo analisado", "equipe de análise" e "trabalho de análise" — nunca use "auditoria", "auditado" ou "auditor".\nRetorne APENAS um JSON válido (sem markdown, sem bloco de código) com a estrutura:\n{\n  "sumario": "Sumário executivo em 2-3 parágrafos descrevendo o processo analisado, o período e os principais resultados",\n  "conformidade_justificativa": "Justificativa objetiva para a conformidade geral atribuída",\n  "achados_resumo": ["achado resumido 1", "achado resumido 2"],\n  "recomendacoes": ["recomendação 1", "recomendação 2", "recomendação 3"],\n  "conclusao": "Parágrafo de conclusão com avaliação final e próximos passos"\n}`,

      gerar_questoes: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base no objetivo, escopo, critérios da análise de aderência e no conteúdo do processo mapeado fornecidos, gere uma lista de questões de análise relevantes e objetivas.\nUse sempre os termos "análise de aderência", "processo analisado" e "equipe de análise" — nunca use "auditoria", "auditado" ou "auditor".\nCada questão deve ser verificável, diretamente ligada a um critério e adequada ao contexto do processo.\nRetorne APENAS um JSON válido (sem markdown, sem bloco de código) com a estrutura:\n[\n  {"questao": "texto da questão", "criterio": "critério relacionado"},\n  ...\n]\nGere entre 8 e 15 questões cobrindo conformidade, desempenho, controles internos e evidências documentais.`,

      sugerir_achados: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base nas questões de análise e suas respectivas respostas fornecidas, identifique potenciais achados que possam ser confirmados pelo analista.\nUse sempre os termos "análise de aderência" e "processo analisado" — nunca use "auditoria" ou "auditado".\nGere achados APENAS para respostas que indiquem problema, lacuna ou oportunidade de melhoria. Se todas indicarem conformidade plena, retorne no máximo um achado do tipo Conformidade.\nRetorne APENAS um JSON válido (sem markdown) com a estrutura:\n[\n  {\n    "titulo": "título objetivo e direto do achado",\n    "tipo": "Não conformidade|Observação|Ponto de melhoria|Conformidade",\n    "descricao": "descrição da situação encontrada e possível causa (2-3 frases)",\n    "evidencia": "tipo de evidência documental ou observacional que sustenta o achado",\n    "criterio": "critério, norma ou boa prática relacionada, com recomendação de melhoria"\n  }\n]\nGere entre 1 e 6 achados. Seja preciso e objetivo — cada achado deve ser diretamente rastreável a uma ou mais respostas fornecidas.`,

      descrever_achado: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base no título e tipo do achado fornecidos, gere uma descrição técnica completa e profissional do apontamento.\nUse sempre os termos "análise de aderência" e "processo analisado" — nunca use "auditoria" ou "auditado".\nRetorne APENAS um JSON válido (sem markdown) com a estrutura:\n{\n  "descricao": "descrição detalhada da situação encontrada e possível causa (2-3 frases técnicas e objetivas)",\n  "evidencia": "sugestão de evidência documental ou observacional que poderia sustentar este achado",\n  "criterio": "critério, norma, regulamento ou boa prática relacionada, seguido de recomendação de melhoria"\n}`,

      gerar_faq: `Você é especialista em gestão de processos e comunicação institucional da administração pública brasileira.\nCom base nas informações do processo fornecidas, gere entre 5 e 8 perguntas frequentes (FAQ) com suas respectivas respostas.\nAs perguntas devem refletir dúvidas reais de cidadãos ou servidores sobre o processo.\nFormato de saída: apenas o texto puro, sem markdown, sem numeração extra, no padrão:\nP: [pergunta]\nR: [resposta objetiva em até 3 frases]\n\nRepita o bloco P/R para cada item.`,
    };

    const systemPrompt = SYSTEM[mode];
    if (!systemPrompt) {
      res.status(400).json({ error: `Mode inválido: ${mode}` });
      return;
    }

    const userMessage = typeof payload === "string" ? payload : JSON.stringify(payload);

    try {
      const endpoint = AZURE_ENDPOINT.value();
      const deploy   = AZURE_DEPLOY.value();
      const apiKey   = AZURE_KEY.value();

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploy}/chat/completions?api-version=2024-12-01-preview`;

      const fetch = (await import("node-fetch")).default;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userMessage  },
            ],
            max_completion_tokens: 1500,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!resp.ok) {
        const err = await resp.text();
        console.error("Azure error:", err);
        res.status(502).json({ error: "Erro na API Azure OpenAI" });
        return;
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "";
      res.status(200).json({ result: text });

    } catch (e) {
      console.error("Function error:", e);
      res.status(500).json({ error: "Erro interno ao processar a requisição." });
    }
  }
);

// ---------------------------------------------------------------------------
// migrateAllUserClaims — Migra perfis de TODOS os usuários para Custom Claims.
// Esta função deve ser executada UMA VEZ após o primeiro deploy da Fase 1.
// Requer autenticação e perfil EP.
// ---------------------------------------------------------------------------
exports.migrateAllUserClaims = onCall(async (request) => {
  // Verificar autenticação (onCall faz automaticamente)
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado');
  }

  try {
    const db = admin.firestore();
    const doc = await db.doc("config/usuarios").get();
    const rawData = doc.exists ? doc.data()?.data : null;
    const usuarios = typeof rawData === "string" ? JSON.parse(rawData) : [];
    
    // Verificar se quem está chamando é EP
    const caller = Array.isArray(usuarios)
      ? usuarios.find(u => u?.email === request.auth.token.email)
      : null;

    if (caller?.perfil !== 'ep') {
      throw new HttpsError(
        'permission-denied',
        'Apenas usuários EP podem executar migração'
      );
    }

    // Processar todos os usuários
    const resultados = {
      total: usuarios.length,
      sucesso: 0,
      erros: 0,
      detalhes: []
    };

    for (const usuario of usuarios) {
      try {
        const { perfil, email } = usuario;
        
        if (!email) {
          resultados.erros++;
          resultados.detalhes.push({
            nome: usuario.nome || 'N/A',
            erro: 'E-mail ausente'
          });
          continue;
        }

        if (!perfil) {
          resultados.erros++;
          resultados.detalhes.push({
            email: email,
            erro: 'Perfil ausente'
          });
          continue;
        }

        // Buscar UID do Firebase Auth pelo e-mail
        let uid;
        try {
          const userRecord = await admin.auth().getUserByEmail(email);
          uid = userRecord.uid;
        } catch (authError) {
          resultados.erros++;
          resultados.detalhes.push({
            email: email,
            erro: `Usuário não encontrado no Firebase Auth: ${authError.message}`
          });
          continue;
        }

        // Setar Custom Claim
        await admin.auth().setCustomUserClaims(uid, { perfil });
        resultados.sucesso++;
        
        console.log(`Claim migrado: uid=${uid}, email=${email}, perfil=${perfil}`);
        
      } catch (error) {
        resultados.erros++;
        resultados.detalhes.push({
          email: usuario.email || 'N/A',
          erro: error.message
        });
        console.error(`Erro ao migrar usuário ${usuario.email}:`, error);
      }
    }

    console.log('Migração concluída:', resultados);
    
    // onCall retorna diretamente o objeto (não precisa de res.json)
    return {
      ok: true,
      resultados
    };
    
  } catch (error) {
    console.error('Erro na migração de claims:', error);
    throw new HttpsError(
      'internal',
      `Erro interno durante migração: ${error.message}`
    );
  }
});
