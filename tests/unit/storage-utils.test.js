/**
 * Testes unitários — src/processos/storage-utils.js
 *
 * Usamos vm.runInNewContext para executar a IIFE com um localStorage mockado
 * em vez do localStorage real do browser. Cada chamada a loadModule() cria
 * um escopo isolado, garantindo independência entre os testes.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runInNewContext } from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(
  join(__dirname, '../../src/processos/storage-utils.js'),
  'utf8'
);

/**
 * Cria um mock de localStorage em memória, com store isolado por instância.
 */
function makeMockLocalStorage() {
  const store = Object.create(null);
  return {
    getItem:    (key) => (key in store ? store[key] : null),
    setItem:    (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    _store:     store,
  };
}

/**
 * Executa a IIFE de storage-utils com o localStorage informado e retorna
 * as funções expostas no globalScope.
 */
function loadModule(localStorage) {
  const scope = { console, localStorage };
  runInNewContext(code, scope);
  return {
    lsGet:               scope.lsGet,
    lsSet:               scope.lsSet,
    lsRemove:            scope.lsRemove,
    jsonArrayFromStorage: scope.jsonArrayFromStorage,
  };
}

// ---------------------------------------------------------------------------
// lsGet()
// ---------------------------------------------------------------------------

describe('lsGet()', () => {
  it('retorna o valor armazenado para a chave', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('modulo', 'processos');
    const { lsGet } = loadModule(ls);
    expect(lsGet('modulo')).toBe('processos');
  });

  it('retorna o fallback quando a chave não existe', () => {
    const { lsGet } = loadModule(makeMockLocalStorage());
    expect(lsGet('inexistente', 'padrão')).toBe('padrão');
  });

  it('retorna string vazia como fallback padrão', () => {
    const { lsGet } = loadModule(makeMockLocalStorage());
    expect(lsGet('inexistente')).toBe('');
  });

  it('retorna fallback quando localStorage lança exceção (ex: modo privado bloqueado)', () => {
    const ls = { getItem: () => { throw new Error('SecurityError'); } };
    const { lsGet } = loadModule(ls);
    expect(lsGet('chave', 'fallback')).toBe('fallback');
  });

  it('retorna o fallback informado quando localStorage lança, não a string vazia', () => {
    const ls = { getItem: () => { throw new Error('bloqueado'); } };
    const { lsGet } = loadModule(ls);
    expect(lsGet('chave', 'meu-fallback')).toBe('meu-fallback');
  });
});

// ---------------------------------------------------------------------------
// lsSet()
// ---------------------------------------------------------------------------

describe('lsSet()', () => {
  it('salva um valor string', () => {
    const ls = makeMockLocalStorage();
    const { lsSet, lsGet } = loadModule(ls);
    lsSet('chave', 'valor');
    expect(lsGet('chave')).toBe('valor');
  });

  it('converte número para string ao salvar', () => {
    const ls = makeMockLocalStorage();
    const { lsSet, lsGet } = loadModule(ls);
    lsSet('num', 42);
    expect(lsGet('num')).toBe('42');
  });

  it('converte booleano para string ao salvar', () => {
    const ls = makeMockLocalStorage();
    const { lsSet, lsGet } = loadModule(ls);
    lsSet('flag', true);
    expect(lsGet('flag')).toBe('true');
  });

  it('sobrescreve um valor existente', () => {
    const ls = makeMockLocalStorage();
    const { lsSet, lsGet } = loadModule(ls);
    lsSet('chave', 'v1');
    lsSet('chave', 'v2');
    expect(lsGet('chave')).toBe('v2');
  });

  it('não lança exceção quando localStorage está bloqueado', () => {
    const ls = { setItem: () => { throw new Error('bloqueado'); } };
    const { lsSet } = loadModule(ls);
    expect(() => lsSet('chave', 'valor')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// lsRemove()
// ---------------------------------------------------------------------------

describe('lsRemove()', () => {
  it('remove uma chave existente', () => {
    const ls = makeMockLocalStorage();
    const { lsSet, lsGet, lsRemove } = loadModule(ls);
    lsSet('chave', 'valor');
    lsRemove('chave');
    expect(lsGet('chave')).toBe('');
  });

  it('não lança exceção ao remover chave inexistente', () => {
    const { lsRemove } = loadModule(makeMockLocalStorage());
    expect(() => lsRemove('inexistente')).not.toThrow();
  });

  it('não afeta outras chaves ao remover uma', () => {
    const ls = makeMockLocalStorage();
    const { lsSet, lsGet, lsRemove } = loadModule(ls);
    lsSet('a', '1');
    lsSet('b', '2');
    lsRemove('a');
    expect(lsGet('b')).toBe('2');
  });

  it('não lança exceção quando localStorage está bloqueado', () => {
    const ls = { removeItem: () => { throw new Error('bloqueado'); } };
    const { lsRemove } = loadModule(ls);
    expect(() => lsRemove('chave')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// jsonArrayFromStorage()
// ---------------------------------------------------------------------------

describe('jsonArrayFromStorage()', () => {
  it('retorna array de primitivos armazenado como JSON', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('lista', '[1, 2, 3]');
    const { jsonArrayFromStorage } = loadModule(ls);
    expect(jsonArrayFromStorage('lista')).toEqual([1, 2, 3]);
  });

  it('retorna array de objetos armazenado como JSON', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('lista', '[{"id":1},{"id":2}]');
    const { jsonArrayFromStorage } = loadModule(ls);
    expect(jsonArrayFromStorage('lista')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('retorna array vazio quando a chave não existe', () => {
    const { jsonArrayFromStorage } = loadModule(makeMockLocalStorage());
    expect(jsonArrayFromStorage('inexistente')).toEqual([]);
  });

  it('retorna array vazio para JSON malformado', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('lista', 'isso não é json');
    const { jsonArrayFromStorage } = loadModule(ls);
    expect(jsonArrayFromStorage('lista')).toEqual([]);
  });

  it('retorna array vazio quando o JSON é um objeto (não array)', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('lista', '{"chave": "valor"}');
    const { jsonArrayFromStorage } = loadModule(ls);
    expect(jsonArrayFromStorage('lista')).toEqual([]);
  });

  it('retorna array vazio quando o JSON é null', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('lista', 'null');
    const { jsonArrayFromStorage } = loadModule(ls);
    expect(jsonArrayFromStorage('lista')).toEqual([]);
  });

  it('retorna array vazio quando o JSON é um número', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('lista', '42');
    const { jsonArrayFromStorage } = loadModule(ls);
    expect(jsonArrayFromStorage('lista')).toEqual([]);
  });

  it('retorna array vazio para string armazenada vazia', () => {
    const ls = makeMockLocalStorage();
    ls.setItem('lista', '');
    const { jsonArrayFromStorage } = loadModule(ls);
    expect(jsonArrayFromStorage('lista')).toEqual([]);
  });

  it('usa o fallback quando a chave não existe (padrão "[]" → array vazio)', () => {
    const { jsonArrayFromStorage } = loadModule(makeMockLocalStorage());
    expect(jsonArrayFromStorage('inexistente', '[]')).toEqual([]);
  });
});
