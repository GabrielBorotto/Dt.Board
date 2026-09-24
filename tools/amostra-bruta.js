'use strict';
// Mostra os valores BRUTOS das primeiras N linhas de um .dbf, sem filtro nenhum de data ou
// cancelamento - util para descobrir se um campo especifico esta vazio ou num formato
// diferente do esperado.
//
// Uso:
//   node tools/amostra-bruta.js "<dbf>" <campos_separados_por_virgula> [quantidade=10]
//
// Exemplo:
//   node tools/amostra-bruta.js "G:\Zimmer\ftlnota.dbf" LNRNOTA,LCODPRO,LDTEMIS,LQUAPES,LVTOTAL 15

const { scan } = require('../src/dbf-reader');

const [, , dbfPath, camposArg, qtdArg] = process.argv;

if (!dbfPath || !camposArg) {
  console.log('Uso: node tools/amostra-bruta.js "<dbf>" <campos_separados_por_virgula> [quantidade=10]');
  console.log('Exemplo: node tools/amostra-bruta.js "G:\\Zimmer\\ftlnota.dbf" LNRNOTA,LCODPRO,LDTEMIS,LQUAPES,LVTOTAL 15');
  process.exit(1);
}

const campos = camposArg.split(',').map((s) => s.trim());
const qtd = Number(qtdArg) || 10;

console.log('Lendo ' + dbfPath + ' (primeiras ' + qtd + ' linhas, sem filtro) ...\n');

const header = campos.map((c) => c.padEnd(14)).join(' | ');
console.log(header);
console.log('-'.repeat(header.length));

let count = 0;
const meta = scan(dbfPath, campos, (rec) => {
  if (count >= qtd) return;
  count++;
  const linha = campos.map((c) => {
    const v = rec[c];
    const marcado = (v === undefined || v === null || v === '') ? '(VAZIO)' : v;
    return String(marcado).padEnd(14);
  }).join(' | ');
  console.log(linha);
});

console.log('\nTotal de registros no arquivo: ' + meta.numRecords);
