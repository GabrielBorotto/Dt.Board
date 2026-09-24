'use strict';
const { scan } = require('./dbf-reader');
const { parseBrDate, isoDate, parseNum } = require('./dbf-utils');


//essa linha de código vai ler e retornar um set com os códigos de CFPO (CODNOP) que são vendas
//Se revortar (TIPNOT = "V") é um número que representa uma nota válida para o nosso objetivo do gráfico de saída
//Se não é um número que o sistema deve entender e não considerar como uma nota válida para esse nosso objetivo
function lerCfopsValidos(path) {
  const validos = new Set();
  scan(path, ['CODNOP', 'TIPNOP'], (rec) => {
    if (rec.__deleted) return;
    if ((rec.TIPNOP || '').trim() ==='V') {
      validos.add((rec.CODNOP || '').trim());
    }
  });
  return validos;
}

// ---- Para FTNOTA / FTENTR: grafico (valor por dia) + impostos (ICMS/PIS/COFINS) ----
// opts: { dateField, valorField, icmsFields:[...], pisField, cofinsField, cancelField? }
// Retorna um Map 'YYYY-MM-DD' -> { fat, icms, pis, cofins, count }
function aggregateNotasPorDia(path, opts) {
  const wanted = [opts.dateField, opts.valorField, opts.pisField, opts.cofinsField, ...opts.icmsFields].filter(Boolean);
  if (opts.cancelField) wanted.push(opts.cancelField);
  if (opts.filtroValido) wanted.push(opts.filtroValido.campo);
  if (opts.filtroExcluido) wanted.push(opts.filtroExcluido.campo);
  if (opts.natopeWhitelist) wanted.push('NNATOPE');

  const daily = new Map();

  const meta = scan(path, wanted, function (rec) {
    if (rec.__deleted) return;
    if (opts.cancelField && rec[opts.cancelField] && rec[opts.cancelField].trim() !== '') return; // nota cancelada (regra antiga, por NDTCANC)
    if (opts.filtroValido && (rec[opts.filtroValido.campo] || '').trim() !== opts.filtroValido.valor) return; // so inclui se o campo bater com o valor esperado (ex: NSITPED="1")
    if (opts.filtroExcluido && (rec[opts.filtroExcluido.campo] || '').trim() === opts.filtroExcluido.valor) return; // exclui se o campo bater com o valor proibido (ex: NDEVNOT="S")
    if (opts.natopeWhitelist && !opts.natopeWhitelist.includes((rec.NNATOPE || '').trim())) return; // fora da lista de CFOPs "faturado"

    const d = parseBrDate(rec[opts.dateField]);
    if (!d) return;
    const key = isoDate(d);

    let b = daily.get(key);
    if (!b) { b = { fat: 0, icms: 0, pis: 0, cofins: 0, count: 0 }; daily.set(key, b); }

    b.fat += parseNum(rec[opts.valorField]);
    for (const f of opts.icmsFields) b.icms += parseNum(rec[f]);
    if (opts.pisField) b.pis += parseNum(rec[opts.pisField]);
    if (opts.cofinsField) b.cofins += parseNum(rec[opts.cofinsField]);
    b.count += 1;
  });

  return { daily, totalRegistros: meta.numRecords };
}

// Combina um mapa de "fat" (ex: total faturado, ja filtrado por CFOP) com um mapa de
// impostos (ex: ICMS/PIS/COFINS combinando varias fontes) - usado quando o valor exibido
// no grafico e os impostos exibidos no widget de Impostos vem de escopos diferentes.
function combineFatComImpostos(dailyFat, dailyImpostos) {
  const out = new Map();
  const allKeys = new Set([...dailyFat.keys(), ...dailyImpostos.keys()]);
  allKeys.forEach((k) => {
    const f = dailyFat.get(k) || { fat: 0 };
    const t = dailyImpostos.get(k) || { icms: 0, pis: 0, cofins: 0 };
    out.set(k, { fat: f.fat, icms: t.icms, pis: t.pis, cofins: t.cofins });
  });
  return out;
}

// ---- Para FTCREC / FTCPAG: soma por dia de LIQUIDACAO (so entra se a data de pagamento for valida) ----
// opts: { valorField, dataPagamentoField }
// Retorna Map 'YYYY-MM-DD' -> valor
function aggregateLiquidadoPorDia(path, opts) {
  const wanted = [opts.valorField, opts.dataPagamentoField];
  const daily = new Map();

  const meta = scan(path, wanted, function (rec) {
    if (rec.__deleted) return;
    const d = parseBrDate(rec[opts.dataPagamentoField]);
    if (!d) return; // sem data de pagamento valida = nao liquidada, nao entra

    const key = isoDate(d);
    daily.set(key, (daily.get(key) || 0) + parseNum(rec[opts.valorField]));
  });

  return { daily, totalRegistros: meta.numRecords };
}

// Combina dois mapas de buckets diarios (ex: ftentr + ftcomp), somando os valores dos dias
// em comum e mantendo os dias exclusivos de cada um.
function mergeDailyMaps(a, b) {
  const out = new Map();
  for (const [k, v] of a) out.set(k, Object.assign({}, v));
  for (const [k, v] of b) {
    const existing = out.get(k);
    if (existing) {
      existing.fat += v.fat; existing.icms += v.icms; existing.pis += v.pis; existing.cofins += v.cofins;
    } else {
      out.set(k, Object.assign({}, v));
    }
  }
  return out;
}

// ---- Para FTCREC / FTCPAG: itens NAO liquidados, agrupados por atraso do vencimento ----
// opts: { valorField, dataPagamentoField, dataVencimentoField, hoje? }
// So entra quem NAO tem data de pagamento valida (ou seja, ainda nao foi liquidado).
// "ate30": vencimento ainda nao passou ou passou ha ate 30 dias (ainda considerado recebivel/pagavel).
// "mais30": vencimento passou ha mais de 30 dias (ou nao tem vencimento valido) - risco de nao entrar.
function aggregateAgingNaoLiquidado(path, opts) {
  const wanted = [opts.valorField, opts.dataPagamentoField, opts.dataVencimentoField];
  const hoje = opts.hoje || new Date();

  let ate30 = 0, mais30 = 0;

  const meta = scan(path, wanted, function (rec) {
    if (rec.__deleted) return;
    const pago = parseBrDate(rec[opts.dataPagamentoField]);
    if (pago) return; // ja liquidada, nao entra

    const valor = parseNum(rec[opts.valorField]);
    const venc = parseBrDate(rec[opts.dataVencimentoField]);
    if (!venc) { mais30 += valor; return; } // sem vencimento valido: trata como caso critico

    const diffDias = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
    if (diffDias <= 30) ate30 += valor; else mais30 += valor;
  });

  return { ate30, mais30, totalRegistros: meta.numRecords };
}

// ---- Utilitarios para consumir os buckets diarios ----

function sumRange(daily, fromDateStr, toDateStr) {
  let sum = 0;
  for (const [key, val] of daily) {
    if (key >= fromDateStr && key <= toDateStr) {
      sum += (typeof val === 'number') ? val : val.fat;
    }
  }
  return sum;
}

// Soma hoje / mes atual / ano atual a partir de um Map de buckets diarios (valor numerico simples,
// usado para ftcrec/ftcpag).
function hojeMesAno(daily, hoje) {
  hoje = hoje || new Date();
  const todayKey = isoDate(hoje);
  const monthKey = todayKey.slice(0, 7);
  const yearKey = todayKey.slice(0, 4);

  let today = 0, month = 0, year = 0;
  for (const [key, val] of daily) {
    if (key === todayKey) today += val;
    if (key.slice(0, 7) === monthKey) month += val;
    if (key.slice(0, 4) === yearKey) year += val;
  }
  return { hoje: today, mes: month, ano: year };
}

module.exports = { lerCfopsValidos, aggregateNotasPorDia, aggregateLiquidadoPorDia, aggregateAgingNaoLiquidado, mergeDailyMaps, combineFatComImpostos, sumRange, hojeMesAno };
