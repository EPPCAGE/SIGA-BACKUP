(function initFormRenderer(globalScope) {
  'use strict';

  /**
   * Renderiza um formulário dinâmico a partir de um schema JSON.
   * @param {object} schema - FormularioModelo
   * @param {object} valoresIniciais - Dados pré-preenchidos (somente leitura ou edição)
   * @param {boolean} somenteLeitura - true para exibir dados sem permitir edição
   * @returns {HTMLElement}
   */
  function renderizarFormulario(schema, valoresIniciais = {}, somenteLeitura = false) {
    const form = document.createElement('div');
    form.className = 'wf-form';
    form.dataset.formularioId = schema.id || '';

    if (schema.titulo) {
      const titulo = document.createElement('h4');
      titulo.className = 'wf-form-titulo';
      titulo.textContent = schema.titulo;
      form.appendChild(titulo);
    }

    const grid = document.createElement('div');
    grid.className = 'wf-form-campos';
    form.appendChild(grid);

    (schema.campos || []).forEach(campo => {
      const grupo = _renderizarCampo(campo, valoresIniciais[campo.id], somenteLeitura);
      if (campo.tipo === 'textarea' || campo.tipo === 'anexo' || campo.tipo === 'checkbox') {
        grupo.classList.add('wf-campo-grupo--full');
      }
      grid.appendChild(grupo);
    });

    return form;
  }

  function _renderizarCampo(campo, valor, somenteLeitura) {
    const grupo = document.createElement('div');
    grupo.className = 'wf-campo-grupo';
    grupo.dataset.campoId = campo.id;

    const label = document.createElement('label');
    label.className = 'wf-campo-label';
    label.htmlFor = `wf-campo-${campo.id}`;
    label.textContent = campo.label;
    if (campo.obrigatorio) {
      const asterisco = document.createElement('span');
      asterisco.className = 'wf-obrigatorio';
      asterisco.textContent = '*';
      label.appendChild(asterisco);
    }
    grupo.appendChild(label);

    let input;

    if (somenteLeitura) {
      input = _renderizarLeitura(campo, valor);
    } else {
      switch (campo.tipo) {
        case 'texto':     input = _inputTexto(campo, valor);    break;
        case 'textarea':  input = _inputTextarea(campo, valor); break;
        case 'numero':    input = _inputNumero(campo, valor);   break;
        case 'data':      input = _inputData(campo, valor);     break;
        case 'select':    input = _inputSelect(campo, valor);   break;
        case 'checkbox':  input = _inputCheckbox(campo, valor); break;
        case 'anexo':     input = _inputAnexo(campo, valor);    break;
        default:          input = _inputTexto(campo, valor);
      }
    }

    grupo.appendChild(input);

    const erro = document.createElement('span');
    erro.className = 'wf-campo-erro';
    erro.id = `wf-erro-${campo.id}`;
    grupo.appendChild(erro);

    return grupo;
  }

  function _renderizarLeitura(campo, valor) {
    const span = document.createElement('div');
    span.className = 'wf-campo-leitura';

    if (campo.tipo === 'checkbox') {
      if (Array.isArray(valor)) {
        span.textContent = valor.length ? valor.join(', ') : '—';
      } else {
        span.textContent = valor ? 'Sim' : 'Não';
      }
    } else if (campo.tipo === 'anexo') {
      if (valor) {
        const link = document.createElement('a');
        link.href = globalScope.safeUrl ? globalScope.safeUrl(valor.url) : '#';
        link.textContent = valor.nome || 'Anexo';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        span.appendChild(link);
      } else {
        span.textContent = '—';
      }
    } else {
      span.textContent = valor != null && valor !== '' ? String(valor) : '—';
    }
    return span;
  }

  function _base(campo, tipo) {
    const el = document.createElement('input');
    el.type = tipo;
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input';
    if (campo.obrigatorio) el.required = true;
    if (campo.placeholder) el.placeholder = campo.placeholder;
    return el;
  }

  function _inputTexto(campo, valor) {
    const el = _base(campo, 'text');
    if (valor != null) el.value = String(valor);
    if (campo.validacao?.regex) el.pattern = campo.validacao.regex;
    return el;
  }

  function _inputTextarea(campo, valor) {
    const el = document.createElement('textarea');
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input wf-campo-textarea';
    el.rows = 4;
    if (campo.obrigatorio) el.required = true;
    if (campo.placeholder) el.placeholder = campo.placeholder;
    if (valor != null) el.value = String(valor);
    return el;
  }

  function _inputNumero(campo, valor) {
    const el = _base(campo, 'number');
    if (valor != null) el.value = String(valor);
    if (campo.validacao?.min != null) el.min = String(campo.validacao.min);
    if (campo.validacao?.max != null) el.max = String(campo.validacao.max);
    return el;
  }

  function _inputData(campo, valor) {
    const el = _base(campo, 'text');
    el.placeholder = 'DD/MM/AAAA';
    el.inputMode = 'numeric';
    el.maxLength = 10;
    el.autocomplete = 'off';

    // Converte valor armazenado (ISO YYYY-MM-DD ou DD/MM/AAAA) para exibição
    if (valor) {
      const s = String(valor);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, d] = s.substring(0, 10).split('-');
        el.value = `${d}/${m}/${y}`;
      } else {
        el.value = s.substring(0, 10);
      }
    }

    // Auto-máscara: insere '/' conforme o usuário digita
    el.addEventListener('input', function () {
      let digits = this.value.replace(/\D/g, '').substring(0, 8);
      let masked = '';
      if (digits.length > 4) masked = `${digits.substring(0, 2)}/${digits.substring(2, 4)}/${digits.substring(4)}`;
      else if (digits.length > 2) masked = `${digits.substring(0, 2)}/${digits.substring(2)}`;
      else masked = digits;
      this.value = masked;
    });

    return el;
  }

  function _inputSelect(campo, valor) {
    const el = document.createElement('select');
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input wf-campo-select';
    if (campo.obrigatorio) el.required = true;

    const vazio = document.createElement('option');
    vazio.value = '';
    vazio.textContent = 'Selecione…';
    el.appendChild(vazio);

    (campo.opcoes || []).forEach(opcao => {
      const opt = document.createElement('option');
      opt.value = opcao;
      opt.textContent = opcao;
      if (opcao === valor) opt.selected = true;
      el.appendChild(opt);
    });

    return el;
  }

  function _inputCheckbox(campo, valor) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wf-campo-checkbox-wrapper';

    const opcoes = Array.isArray(campo.opcoes) && campo.opcoes.length ? campo.opcoes : null;

    if (opcoes) {
      // Múltiplas opções: array de checkboxes
      const selecionados = Array.isArray(valor) ? valor : (valor ? [valor] : []);
      wrapper.id = `wf-campo-${campo.id}`;
      wrapper.dataset.multiCheckbox = '1';
      opcoes.forEach((op, i) => {
        const row = document.createElement('label');
        row.className = 'wf-campo-checkbox-label';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';
        row.style.marginBottom = '4px';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'wf-campo-checkbox';
        cb.name = campo.id;
        cb.value = op;
        cb.checked = selecionados.includes(op);
        if (campo.obrigatorio && i === 0) cb.required = true;
        row.appendChild(cb);
        row.appendChild(document.createTextNode(op));
        wrapper.appendChild(row);
      });
    } else {
      // Sem opções: Sim/Não simples
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.id = `wf-campo-${campo.id}`;
      el.name = campo.id;
      el.className = 'wf-campo-checkbox';
      el.checked = Boolean(valor);
      if (campo.obrigatorio) el.required = true;

      const lbl = document.createElement('label');
      lbl.htmlFor = el.id;
      lbl.textContent = campo.label;
      lbl.className = 'wf-campo-checkbox-label';

      wrapper.appendChild(el);
      wrapper.appendChild(lbl);
    }
    return wrapper;
  }

  function _inputAnexo(campo, valor) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wf-campo-anexo-wrapper';

    const el = document.createElement('input');
    el.type = 'file';
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input';
    el.accept = '.pdf,.png,.jpg,.jpeg,.doc,.docx';
    if (campo.obrigatorio) el.required = true;

    if (valor?.nome) {
      const existente = document.createElement('div');
      existente.className = 'wf-campo-anexo-existente';
      existente.textContent = `Arquivo atual: ${valor.nome}`;
      wrapper.appendChild(existente);
    }

    wrapper.appendChild(el);
    return wrapper;
  }

  /**
   * Coleta os valores de um formulário renderizado.
   * @param {HTMLElement} formEl - Container gerado por renderizarFormulario
   * @param {object[]} campos - Lista de campos do schema
   * @returns {{ valido: boolean, dados: object, erros: object }}
   */
  function coletarDados(formEl, campos) {
    const dados = {};
    const erros = {};

    campos.forEach(campo => {
      const grupo = formEl.querySelector(`[data-campo-id="${campo.id}"]`);
      if (!grupo) return;

      const input = grupo.querySelector(`#wf-campo-${campo.id}`);
      if (!input) return;

      let valor;
      if (campo.tipo === 'checkbox') {
        if (grupo.querySelector('[data-multi-checkbox]') || input?.dataset?.multiCheckbox) {
          // multi-checkbox: coleta array de valores marcados
          valor = Array.from(grupo.querySelectorAll(`input[name="${campo.id}"]:checked`)).map(cb => cb.value);
        } else {
          valor = input.checked;
        }
      } else if (campo.tipo === 'anexo') {
        valor = input.files?.[0] ?? null;
      } else {
        valor = input.value.trim();
      }

      if (campo.obrigatorio && (valor === '' || valor === null || valor === undefined || (Array.isArray(valor) && !valor.length))) {
        erros[campo.id] = `${campo.label} é obrigatório.`;
      } else if (campo.tipo === 'data' && valor && !/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
        erros[campo.id] = `${campo.label}: use o formato DD/MM/AAAA.`;
      }

      dados[campo.id] = valor;
      _exibirErro(grupo, campo.id, erros[campo.id] || '');
    });

    return {
      valido: Object.keys(erros).length === 0,
      dados,
      erros,
    };
  }

  function _exibirErro(grupo, campoId, mensagem) {
    const erroEl = grupo.querySelector(`#wf-erro-${campoId}`);
    if (erroEl) erroEl.textContent = mensagem;
  }

  Object.assign(globalScope, {
    wfRenderizarFormulario: renderizarFormulario,
    wfColetarDadosFormulario: coletarDados,
  });
})(globalThis);
