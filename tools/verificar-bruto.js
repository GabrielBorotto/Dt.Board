'use strict';
// Ferramenta de VERIFICACAO INDEPENDENTE - nao usa nenhuma funcao de calculo do app
// (nao importa margem-aggregator.js). So le os campos brutos direto dos arquivos e mostra
// cada componente separado, pra voce montar a conta na mao (ou no Excel) e confirmar se a
// formula que o app usa esta certa - sem confiar em nenhum codigo nosso pra fazer a conta.
//
// Uso (por mes inteiro):
//   node tools/verificar-bruto.js <codigo_produto> <ano> <mes>
//
// Uso (por intervalo de datas, igual a aba "Intervalo" do app):
//   node tools/verificar-bruto.js <codigo_produto> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplos:
//   node tools/verificar-bruto.js P0001234 2026 8
//   node tools/verificar-bruto.js P0001234 01/03/2026 30/04/2026

const os = require('os');
const path = require('path');
const fs = require('fs');
const { scan } = require('../src/dbf-reader');
const { loadConfig } = require('../src/config-store');

// --- acha o config.json (mesma logica de sempre) ---
const roaming = path.join(os.homedir(), 'AppData', 'Roaming');
const candidatos = ['painel-fiscal', 'Painel Fiscal', 'Painel-Fiscal', 'dt-board', 'Dt.Board', 'dt.board'];
let userDataDir = null;
for (const nome of candidatos) {
  const tentativa = path.join(roaming, nome);
  if (fs.existsSync(path.join(tentativa, 'config.json'))) { userDataDir = tentativa; break; }
}
if (!userDataDir) {
  console.log('Não encontrei o config.json. Abra o app e salve as Configurações primeiro.');
  process.exit(1);
}
const config = loadConfig(userDataDir);

// --- parse de data BR simples e proprio (NAO usa src/dbf-utils.js) ---
function parseData(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const dia = Number(m[1]), mesN = Number(m[2]), ano2 = Number(m[3]);
  if (dia < 1 || dia > 31 || mesN < 1 || mesN > 12) return null;
  return { dia, mes: mesN, ano: ano2, chave: ano2 * 10000 + mesN * 100 + dia };
}
function num(s) {
  const n = parseFloat(String(s || '0').trim());
  return isNaN(n) ? 0 : n;
}
function fmtData(d) { return String(d.dia).padStart(2, '0') + '/' + String(d.mes).padStart(2, '0') + '/' + d.ano; }

const [, , codProdutoArg, arg2, arg3] = process.argv;
if (!codProdutoArg || !arg2 || !arg3) {
  console.log('Uso (mes inteiro):  node tools/verificar-bruto.js <codigo_produto> <ano> <mes>');
  console.log('Uso (intervalo):    node tools/verificar-bruto.js <codigo_produto> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const codProduto = codProdutoArg.trim();

let dataInicio, dataFim, labelPeriodo;
if (arg2.includes('/')) {
  // modo intervalo de datas, igual a aba "Intervalo" do app
  dataInicio = parseData(arg2);
  dataFim = parseData(arg3);
  if (!dataInicio || !dataFim) {
    console.log('Datas inválidas. Use o formato DD/MM/AAAA.');
    process.exit(1);
  }
  labelPeriodo = fmtData(dataInicio) + ' até ' + fmtData(dataFim);
} else {
  // modo mes inteiro (compatibilidade com o uso anterior)
  const ano = Number(arg2), mes = Number(arg3);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  dataInicio = { dia: 1, mes, ano, chave: ano * 10000 + mes * 100 + 1 };
  dataFim = { dia: ultimoDia, mes, ano, chave: ano * 10000 + mes * 100 + ultimoDia };
  labelPeriodo = String(mes).padStart(2, '0') + '/' + ano;
}

console.log('=== VERIFICAÇÃO INDEPENDENTE - produto ' + codProduto + ' - ' + labelPeriodo + ' ===');
console.log('(esta ferramenta NÃO usa nenhuma função de cálculo do app - só lê os campos crus)\n');

// --- 1) le o ftnota inteiro, guardando so numero->data/valida (loop proprio, sem lerInfoNotas) ---
console.log('Lendo ftnota.dbf (datas e situação de cada nota) ...');
const notas = {}; // nota -> {chave, cancelada}
scan(config.paths.ftnota, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT'], (rec) => {
  if (rec.__deleted) return;
  const nota = (rec.NNRNOTA || '').trim();
  const data = parseData(rec.NDTEMIS);
  const situacaoValida = (rec.NSITPED || '').trim() === '1';
  const ehDevolucao = (rec.NDEVNOT || '').trim() === 'S';
  notas[nota] = { data, cancelada: !situacaoValida || ehDevolucao };
});

// --- 2) le TODAS as compras (ftlentr) desse produto, sem calcular nada alem do que ta aqui na tela ---
console.log('Lendo ftlentr.dbf (compras deste produto) ...\n');
console.log('--- COMPRAS (ftlentr) deste produto, na ordem em que aparecem no arquivo ---');
console.log('data       | LVTOTAL   | LVALDES  | LVALACR  | LVALFRE  | LQUAPES');
let numCompras = 0;
scan(config.paths.ftlentr, ['LCODPRO', 'LNDTENT', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LQUAPES'], (rec) => {
  if (rec.__deleted) return;
  if ((rec.LCODPRO || '').trim() !== codProduto) return;
  numCompras++;
  console.log(
    (rec.LNDTENT || '').padEnd(10) + ' | ' +
    num(rec.LVTOTAL).toFixed(2).padStart(9) + ' | ' +
    num(rec.LVALDES).toFixed(2).padStart(8) + ' | ' +
    num(rec.LVALACR).toFixed(2).padStart(8) + ' | ' +
    num(rec.LVALFRE).toFixed(2).padStart(8) + ' | ' +
    num(rec.LQUAPES).toFixed(3)
  );
});
if (numCompras === 0) console.log('  (nenhuma compra encontrada para este produto)');
console.log('\nCalcule você mesmo o custo de cada linha: (LVTOTAL - LVALDES + LVALACR + LVALFRE) / LQUAPES');
console.log('E identifique qual é a compra mais recente ANTES de cada data de venda abaixo.\n');

// --- 3) le TODAS as vendas (ftlnota) desse produto no periodo pedido ---
console.log('--- VENDAS (ftlnota) deste produto em ' + labelPeriodo + ', na ordem do arquivo ---');
console.log('nota     | data (do ftnota) | cancelada | LVTOTAL   | LVALDES  | LVALACR  | LVALFRE  | LQUAPES');
let numVendas = 0;
scan(config.paths.ftlnota, ['LNRNOTA', 'LCODPRO', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LQUAPES'], (rec) => {
  if (rec.__deleted) return;
  if ((rec.LCODPRO || '').trim() !== codProduto) return;

  const nota = (rec.LNRNOTA || '').trim();
  const infoNota = notas[nota];
  if (!infoNota || !infoNota.data) return;
  if (infoNota.data.chave < dataInicio.chave || infoNota.data.chave > dataFim.chave) return;

  numVendas++;
  console.log(
    nota.padEnd(8) + ' | ' +
    fmtData(infoNota.data).padEnd(16) + ' | ' +
    (infoNota.cancelada ? 'SIM' : 'não').padEnd(9) + ' | ' +
    num(rec.LVTOTAL).toFixed(2).padStart(9) + ' | ' +
    num(rec.LVALDES).toFixed(2).padStart(8) + ' | ' +
    num(rec.LVALACR).toFixed(2).padStart(8) + ' | ' +
    num(rec.LVALFRE).toFixed(2).padStart(8) + ' | ' +
    num(rec.LQUAPES).toFixed(3)
  );
});
if (numVendas === 0) console.log('  (nenhuma venda encontrada para este produto neste período)');

console.log('\nLinhas com "cancelada = SIM" NÃO devem entrar na sua soma manual.');
console.log('Para cada linha não cancelada: Valor Final = LVTOTAL - LVALDES + LVALACR + LVALFRE');
console.log('Some os Valores Finais e as LQUAPES de todas as linhas não canceladas, e compare com o app.');
