'use strict';
// Para um produto especifico, mostra: o cadastro (nome/grupo), o historico de compras
// (ftlentr, ordenado por data, com custo unitario de cada compra) e todas as vendas do
// periodo (ftlnota, cruzado com ftnota pra pegar data/cancelamento) com o MESMO calculo que
// o app usa - linha a linha, para conferencia manual contra o proprio sistema FAT.
//
// Uso:
//   node tools/verificar-produto.js <codigo_produto> <ano> <mes>
//
// Exemplo:
//   node tools/verificar-produto.js P0001234 2026 8

const { scan } = require('../src/dbf-reader');
const { parseBrDate, isoDate, parseNum } = require('../src/dbf-utils');
const {
  lerGrupos, lerProdutos, construirHistoricoCompras, custoNaData, lerInfoNotas,
} = require('../src/margem-aggregator');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('../src/config-store');

// Le a configuracao salva do app. O nome da pasta pode variar dependendo de como o Electron
// nomeou o app (normalmente bate com o "name" do package.json, "painel-fiscal", mas por
// seguranca testamos as variantes mais comuns).
const roaming = path.join(os.homedir(), 'AppData', 'Roaming');
const candidatos = ['painel-fiscal', 'Painel Fiscal', 'Painel-Fiscal'];
let userDataDir = null;
for (const nome of candidatos) {
  const tentativa = path.join(roaming, nome);
  if (fs.existsSync(path.join(tentativa, 'config.json'))) { userDataDir = tentativa; break; }
}
if (!userDataDir) {
  console.log('Não encontrei o config.json em nenhuma destas pastas:');
  candidatos.forEach((nome) => console.log('  ' + path.join(roaming, nome)));
  console.log('\nAbra o app pelo menos uma vez e salve as Configurações antes de rodar esta ferramenta.');
  process.exit(1);
}
console.log('Usando configuração de: ' + path.join(userDataDir, 'config.json') + '\n');
const config = loadConfig(userDataDir);

const [, , codProdutoArg, anoArg, mesArg] = process.argv;
if (!codProdutoArg || !anoArg || !mesArg) {
  console.log('Uso: node tools/verificar-produto.js <codigo_produto> <ano> <mes>');
  console.log('Exemplo: node tools/verificar-produto.js P0001234 2026 8');
  process.exit(1);
}
const codProduto = codProdutoArg.trim();
const ano = Number(anoArg), mes = Number(mesArg);

function fmt(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

console.log('Lendo cadastros e histórico de compras...\n');
const grupos = lerGrupos(config.paths.ftgrup);
const produtos = lerProdutos(config.paths.ftmpri);
const historico = construirHistoricoCompras(config.paths.ftlentr);
const infoNotas = lerInfoNotas(config.paths.ftnota);

const produto = produtos.get(codProduto);
if (!produto) {
  console.log('Produto "' + codProduto + '" não encontrado no ftmpri.dbf. Confira o código (ele é sensível a espaços/zeros à esquerda).');
  process.exit(1);
}
console.log('=== Produto: ' + codProduto + ' - ' + produto.desc + ' ===');
console.log('Grupo: ' + produto.grupo + ' - ' + (grupos.get(produto.grupo) || '(desconhecido)'));

console.log('\n--- Histórico de compras (ftlentr), ordenado por data ---');
const compras = historico.get(codProduto) || [];
if (compras.length === 0) {
  console.log('  Nenhuma compra registrada para este produto em todo o histórico.');
} else {
  compras.forEach((c) => {
    console.log('  ' + isoDate(c.data) + '  custo unitário: R$ ' + fmt(c.custoUnitario));
  });
}

console.log('\n--- Vendas em ' + String(mes).padStart(2, '0') + '/' + ano + ' (ftlnota, cruzado com ftnota) ---');
let qtdTotal = 0, valorTotal = 0, custoTotal = 0, count = 0;

scan(config.paths.ftlnota, ['LNRNOTA', 'LCODPRO', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LQUAPES'], (rec) => {
  if (rec.__deleted) return;
  const cod = (rec.LCODPRO || '').trim();
  if (cod !== codProduto) return;

  const nota = (rec.LNRNOTA || '').trim();
  const infoNota = infoNotas.get(nota);
  if (!infoNota || infoNota.cancelada || !infoNota.data) return;
  if (infoNota.data.getFullYear() !== ano || (infoNota.data.getMonth() + 1) !== mes) return;

  const qtd = parseNum(rec.LQUAPES);
  const valorFinal = parseNum(rec.LVTOTAL) - parseNum(rec.LVALDES) + parseNum(rec.LVALACR) + parseNum(rec.LVALFRE);
  const custoUnitario = custoNaData(historico, cod, infoNota.data);
  const custo = custoUnitario == null ? 0 : custoUnitario * qtd;

  count++;
  qtdTotal += qtd; valorTotal += valorFinal; custoTotal += custo;

  console.log(
    '  nota ' + nota + '  ' + isoDate(infoNota.data) +
    '  qtd=' + qtd.toFixed(3) +
    '  valorFinal=R$ ' + fmt(valorFinal) +
    '  custoUnit=R$ ' + fmt(custoUnitario) +
    '  custo=R$ ' + fmt(custo)
  );
});

console.log('\n--- Resumo do mês (deve bater com a linha desse item no widget de Margem) ---');
console.log('Notas encontradas: ' + count);
console.log('Quantidade total : ' + qtdTotal.toFixed(3));
console.log('Valor final total: R$ ' + fmt(valorTotal));
console.log('Custo total       : R$ ' + fmt(custoTotal));
console.log('Margem            : R$ ' + fmt(valorTotal - custoTotal));
