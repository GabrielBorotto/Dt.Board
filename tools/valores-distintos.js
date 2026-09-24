'use strict';
// Mostra os valores DISTINTOS de um campo, com a contagem de cada um - util para entender o
// significado de um codigo/status (ex: quais valores o NSITPED assume, e quantas notas tem
// cada valor).
//
// Uso:
//   node tools/valores-distintos.js "<dbf>" <campo> [quantidade_amostra_por_valor=3]
//
// Exemplo:
//   node tools/valores-distintos.js "G:\Zimmer\ftnota.dbf" NSITPED 3

const { scan } = require('../src/dbf-reader');

const [, , dbfPath, campoArg, amostraArg] = process.argv;
if (!dbfPath || !campoArg) {
  console.log('Uso: node tools/valores-distintos.js "<dbf>" <campo> [quantidade_amostra_por_valor=3]');
  console.log('Exemplo: node tools/valores-distintos.js "G:\\Zimmer\\ftnota.dbf" NSITPED 3');
  process.exit(1);
}
const amostraPorValor = Number(amostraArg) || 3;

// Pega tambem NNRNOTA e NDTCANC (se existirem) para cruzar com o que ja sabemos, quando o
// arquivo for o ftnota - ajuda a ver se o valor do campo novo bate com o que o NDTCANC ja
// indicava.
const camposExtras = ['NNRNOTA', 'NDTCANC'];

const contagem = {}; // valor -> { qtd, exemplos: [{nota, cancelada}] }

console.log('Lendo ' + dbfPath + ' (campo: ' + campoArg + ') ...\n');

const meta = scan(dbfPath, [campoArg, ...camposExtras], (rec) => {
  if (rec.__deleted) return;
  const v = (rec[campoArg] === undefined || rec[campoArg] === null) ? '(campo não existe)' : ('"' + rec[campoArg] + '"');
  if (!contagem[v]) contagem[v] = { qtd: 0, exemplos: [] };
  contagem[v].qtd++;
  if (contagem[v].exemplos.length < amostraPorValor) {
    const nota = rec.NNRNOTA !== undefined ? rec.NNRNOTA : '?';
    const cancelada = rec.NDTCANC !== undefined ? (rec.NDTCANC && rec.NDTCANC.trim() !== '' ? 'SIM (NDTCANC preenchido)' : 'não') : '(sem NDTCANC neste arquivo)';
    contagem[v].exemplos.push('nota ' + nota + ' | cancelada pelo NDTCANC? ' + cancelada);
  }
});

const valores = Object.keys(contagem).sort((a, b) => contagem[b].qtd - contagem[a].qtd);

console.log('Total de registros lidos: ' + meta.numRecords + '\n');
console.log('Valores distintos encontrados no campo ' + campoArg + ':\n');
valores.forEach((v) => {
  console.log(v + '  ->  ' + contagem[v].qtd + ' registros');
  contagem[v].exemplos.forEach((ex) => console.log('    ex: ' + ex));
});
