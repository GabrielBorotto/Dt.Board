'use strict';
// Lista todos os campos (nome, tipo, tamanho) de um .dbf. Le so o cabecalho, entao e
// praticamente instantaneo mesmo em arquivos grandes.
//
// Uso:
//   node tools/listar-campos.js "<caminho do dbf>"

const { readMeta } = require('../src/dbf-reader');

const [, , dbfPath] = process.argv;
if (!dbfPath) {
  console.log('Uso: node tools/listar-campos.js "<caminho do dbf>"');
  process.exit(1);
}

const meta = readMeta(dbfPath);
console.log('Arquivo: ' + dbfPath);
console.log('Registros: ' + meta.numRecords + ' | Tamanho do registro: ' + meta.recordSize + ' bytes | Campos: ' + meta.fields.length + '\n');
meta.fields.forEach((f) => {
  console.log('  ' + f.name.padEnd(14) + ' tipo=' + f.type + '  tamanho=' + String(f.length).padStart(3) + '  decimais=' + f.dec);
});
