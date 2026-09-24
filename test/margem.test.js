'use strict';
// Testa o motor de calculo de margem (grupo > item), incluindo o caso mais importante:
// um produto comprado duas vezes por preços diferentes, e a venda deve usar sempre o custo
// da compra mais recente ANTES da data da venda (não a compra mais barata nem a mais cara).
// Rodar com: node test/margem.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const {
  lerGrupos, lerProdutos, construirHistoricoCompras,
  lerInfoNotas, calcularMargem,
} = require('../src/margem-aggregator');

function writeDbf(filePath, fields, records) {
  const recordLen = 1 + fields.reduce((a, f) => a + f.length, 0);
  const headerLen = 32 + 32 * fields.length + 1;
  const chunks = [];
  const header = Buffer.alloc(32);
  header[0] = 0x03;
  header.writeUInt32LE(records.length, 4);
  header.writeUInt16LE(headerLen, 8);
  header.writeUInt16LE(recordLen, 10);
  chunks.push(header);
  for (const f of fields) {
    const fd = Buffer.alloc(32);
    fd.write(f.name, 0, 'latin1');
    fd[11] = f.type.charCodeAt(0);
    fd[16] = f.length;
    fd[17] = f.dec || 0;
    chunks.push(fd);
  }
  chunks.push(Buffer.from([0x0d]));
  for (const rec of records) {
    const buf = Buffer.alloc(recordLen, 0x20);
    let pos = 1;
    fields.forEach((f, i) => {
      const raw = String(rec[i] === undefined ? '' : rec[i]);
      const text = f.type === 'N' ? raw.padStart(f.length, ' ') : raw.padEnd(f.length, ' ');
      buf.write(text.slice(0, f.length), pos, 'latin1');
      pos += f.length;
    });
    chunks.push(buf);
  }
  chunks.push(Buffer.from([0x1a]));
  fs.writeFileSync(filePath, Buffer.concat(chunks));
}

function close(a, b, eps) { return Math.abs(a - b) < (eps || 0.01); }

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margem-test-'));

  // ---- ftgrup: 2 grupos ----
  writeDbf(path.join(dir, 'ftgrup.dbf'),
    [{ name: 'CODGRU', type: 'C', length: 4 }, { name: 'DESGRU', type: 'C', length: 30 }],
    [['G001', 'Laticinios'], ['G002', 'Bebidas']]);

  // ---- ftmpri: 3 produtos, P1 e P2 no grupo G001, P3 no G002 ----
  writeDbf(path.join(dir, 'ftmpri.dbf'),
    [{ name: 'CODMPR', type: 'C', length: 8 }, { name: 'DESMPR', type: 'C', length: 40 }, { name: 'GRUMPR', type: 'C', length: 4 }],
    [
      ['P0000001', 'Queijo Mussarela', 'G001'],
      ['P0000002', 'Leite Integral', 'G001'],
      ['P0000003', 'Suco de Laranja', 'G002'],
    ]);

  // ---- ftlentr: historico de compras ----
  // P1: comprado 2x - dia 01/01 a R$5/kg, depois reajuste dia 15/01 pra R$6/kg
  // P2: comprado 1x - R$4/kg
  // P3: comprado 1x - R$10/kg
  const fieldsEntr = [
    { name: 'LCODPRO', type: 'C', length: 8 }, { name: 'LNDTENT', type: 'C', length: 10 },
    { name: 'LVTOTAL', type: 'N', length: 14, dec: 2 }, { name: 'LVALDES', type: 'N', length: 14, dec: 2 },
    { name: 'LVALACR', type: 'N', length: 14, dec: 2 }, { name: 'LVALFRE', type: 'N', length: 14, dec: 2 },
    { name: 'LQUAPES', type: 'N', length: 14, dec: 3 },
  ];
  writeDbf(path.join(dir, 'ftlentr.dbf'), fieldsEntr, [
    ['P0000001', '01/01/2026', '500.00', '0.00', '0.00', '0.00', '100.000'], // custo unit = 5.00
    ['P0000001', '15/01/2026', '300.00', '0.00', '0.00', '0.00', '50.000'],  // custo unit = 6.00 (reajuste)
    ['P0000002', '01/01/2026', '800.00', '0.00', '0.00', '0.00', '200.000'], // custo unit = 4.00
    ['P0000003', '01/01/2026', '100.00', '0.00', '0.00', '0.00', '10.000'],  // custo unit = 10.00
  ]);

  const grupos = lerGrupos(path.join(dir, 'ftgrup.dbf'));
  const produtos = lerProdutos(path.join(dir, 'ftmpri.dbf'));
  const historico = construirHistoricoCompras(path.join(dir, 'ftlentr.dbf'));

  // ---- ftnota: cabeçalho de cada nota - é DAQUI que vem a data e a situação (NSITPED), já
  //      que o ftlnota (itens) não tem o próprio campo de data preenchido ----
  writeDbf(path.join(dir, 'ftnota.dbf'),
    [{ name: 'NNRNOTA', type: 'C', length: 8 }, { name: 'NDTEMIS', type: 'C', length: 10 }, { name: 'NSITPED', type: 'C', length: 1 }, { name: 'NDEVNOT', type: 'C', length: 1 }],
    [
      ['00000001', '10/01/2026', '1', ''],
      ['00000002', '20/01/2026', '1', ''],
      ['00000003', '12/01/2026', '1', ''],
      ['00000004', '12/01/2026', 'C', ''],  // ESTA e a nota invalida (NSITPED != "1")
      ['00000005', '05/12/2025', '1', ''],
      ['00000006', '15/01/2026', '1', 'S'], // NSITPED="1" mas NDEVNOT="S" -> tambem deve ser excluída
    ]);
  const infoNotas = lerInfoNotas(path.join(dir, 'ftnota.dbf'));

  // ---- ftlnota: vendas (SEM campo de data - a data vem do cruzamento com ftnota acima) ----
  // Venda A: nota 1 (10/01, antes do reajuste), P1, qtd 20kg -> deve usar custo 5.00 (compra de 01/01)
  // Venda B: nota 2 (20/01, depois do reajuste), P1, qtd 10kg -> deve usar custo 6.00 (compra de 15/01)
  // Venda C: nota 3 (12/01), P2, qtd 50kg -> custo 4.00
  // Venda D: nota 4, P3, MAS A NOTA 4 ESTA CANCELADA -> deve ser ignorada por completo
  // Venda E: nota 5 (05/12/2025, fora do periodo consultado, dez/2025) -> deve ficar fora
  const fieldsLnota = [
    { name: 'LNRNOTA', type: 'C', length: 8 }, { name: 'LCODPRO', type: 'C', length: 8 },
    { name: 'LVTOTAL', type: 'N', length: 13, dec: 2 }, { name: 'LVALDES', type: 'N', length: 13, dec: 2 },
    { name: 'LVALACR', type: 'N', length: 13, dec: 2 }, { name: 'LVALFRE', type: 'N', length: 13, dec: 2 },
    { name: 'LQUAPES', type: 'N', length: 14, dec: 3 },
  ];
  writeDbf(path.join(dir, 'ftlnota.dbf'), fieldsLnota, [
    ['00000001', 'P0000001', '200.00', '0.00', '0.00', '0.00', '20.000'],  // A
    ['00000002', 'P0000001', '150.00', '0.00', '0.00', '0.00', '10.000'],  // B
    ['00000003', 'P0000002', '700.00', '0.00', '0.00', '0.00', '50.000'],  // C
    ['00000004', 'P0000003', '150.00', '0.00', '0.00', '0.00', '15.000'],  // D (nota cancelada)
    ['00000005', 'P0000001', '999.00', '0.00', '0.00', '0.00', '99.000'],  // E (fora do periodo)
    ['00000006', 'P0000002', '888.00', '0.00', '0.00', '0.00', '88.000'],  // F (nota com NDEVNOT="S")
  ]);

  const resultado = calcularMargem(path.join(dir, 'ftlnota.dbf'), {
    produtos, grupos, historicoCompras: historico, infoNotas,
    from: '2026-01-01', to: '2026-01-31',
  });

  // ---- Conferências ----
  const grupoLaticinios = resultado.grupos.find((g) => g.codigo === 'G001');
  assert.ok(grupoLaticinios, 'grupo G001 (Laticinios) deveria existir no resultado');

  const itemP1 = grupoLaticinios.itens.find((i) => i.codigo === 'P0000001');
  const itemP2 = grupoLaticinios.itens.find((i) => i.codigo === 'P0000002');

  // P1: venda A (20kg * custo 5.00 = 100.00) + venda B (10kg * custo 6.00 = 60.00) = custo total 160.00
  assert.ok(close(itemP1.qtd, 30), `P1 qtd esperado 30, obtido ${itemP1.qtd}`);
  assert.ok(close(itemP1.valorFinal, 350), `P1 valorFinal esperado 350 (200+150), obtido ${itemP1.valorFinal}`);
  assert.ok(close(itemP1.custo, 160), `P1 custo esperado 160.00 (20*5 + 10*6), obtido ${itemP1.custo}`);
  assert.ok(close(itemP1.margem, 190), `P1 margem esperada 190.00, obtido ${itemP1.margem}`);
  console.log('OK: P1 usa o custo correto de cada compra conforme a data da venda (reajuste de preço respeitado).');

  // P2: venda C (50kg * custo 4.00 = 200.00). A venda F (nota com NDEVNOT="S") NAO deve contar.
  assert.ok(close(itemP2.custo, 200), `P2 custo esperado 200.00, obtido ${itemP2.custo}`);
  assert.ok(close(itemP2.valorFinal, 700), `P2 valorFinal esperado 700.00 (venda F com NDEVNOT="S" excluída), obtido ${itemP2.valorFinal}`);
  console.log('OK: P2 calculado corretamente, e venda com NDEVNOT="S" foi excluída.');

  // Grupo Laticinios = soma de P1 + P2
  assert.ok(close(grupoLaticinios.valorFinal, 350 + 700), 'total do grupo Laticinios deveria ser a soma de P1+P2');
  assert.ok(close(grupoLaticinios.custo, 160 + 200), 'custo do grupo Laticinios deveria ser a soma de P1+P2');
  console.log('OK: grupo agrega corretamente a soma dos itens dele.');

  // Grupo Bebidas (G002) NAO deveria aparecer, pois a unica venda de P3 (venda D) foi cancelada
  const grupoBebidas = resultado.grupos.find((g) => g.codigo === 'G002');
  assert.strictEqual(grupoBebidas, undefined, 'grupo Bebidas nao deveria aparecer (unica venda foi cancelada)');
  console.log('OK: venda de nota cancelada foi excluída corretamente (grupo Bebidas não aparece).');

  // Venda E (fora do periodo) nao deveria influenciar o total de P1
  assert.ok(close(itemP1.valorFinal, 350), 'venda fora do período (dezembro) não deveria contar em janeiro');
  console.log('OK: venda fora do período consultado foi excluída corretamente.');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nTodos os testes de margem passaram.');
}

run();
