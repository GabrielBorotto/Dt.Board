'use strict';
// Busca produtos no ftmpri.dbf pelo nome (busca parcial, sem diferenciar maiusculas de
// minusculas) - util para achar o codigo de um produto so sabendo o nome.
//
// Uso:
//   node tools/buscar-produto.js "<caminho do ftmpri.dbf>" "<termo de busca>"
//
// Exemplo:
//   node tools/buscar-produto.js "G:\Zimmer\ftmpri.dbf" "alho"

const { scan } = require('../src/dbf-reader');

const [, , dbfPath, termoArg] = process.argv;
if (!dbfPath || !termoArg) {
  console.log('Uso: node tools/buscar-produto.js "<caminho do ftmpri.dbf>" "<termo de busca>"');
  console.log('Exemplo: node tools/buscar-produto.js "G:\\Zimmer\\ftmpri.dbf" "alho"');
  process.exit(1);
}

const termo = termoArg.trim().toLowerCase();
let encontrados = 0;

scan(dbfPath, ['CODMPR', 'DESMPR', 'GRUMPR'], (rec) => {
  if (rec.__deleted) return;
  const desc = (rec.DESMPR || '').trim();
  if (!desc.toLowerCase().includes(termo)) return;
  encontrados++;
  console.log('Código: ' + (rec.CODMPR || '').trim() + '   Grupo: ' + (rec.GRUMPR || '').trim() + '   Nome: ' + desc);
});

console.log('\n' + encontrados + ' produto(s) encontrado(s) contendo "' + termoArg + '".');
