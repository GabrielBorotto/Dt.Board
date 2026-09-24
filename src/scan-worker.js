'use strict';
const { parentPort, workerData } = require('worker_threads');
const { lerCfopsValidos, aggregateNotasPorDia, aggregateAgingNaoLiquidado, mergeDailyMaps, combineFatComImpostos } = require('./aggregator');

// CFOPs de compra "de verdade" dentro do ftentr - e o que o relatorio do FAT considera
// "Faturado" (movimentacoes como retorno de armazenagem e bonificacao recebida ficam de
// fora, mesmo tendo valor em TotalNota). Confirmado comparando 3 meses (mar/jul/dez) contra
// o relatorio "Resumo Impostos Entrada x Saida" do proprio sistema.
const FATURADO_NATOPE_WHITELIST = ['1.102', '1.403', '2.102', '2.403'];

function dailyMapToArray(daily) {
  const out = [];
  const keys = Array.from(daily.keys()).sort();
  for (const k of keys) {
    const v = daily.get(k);
    if (typeof v === 'number') out.push({ date: k, valor: v });
    else out.push({ date: k, fat: v.fat, icms: v.icms, pis: v.pis, cofins: v.cofins });
  }
  return out;
}

function run() {
  const cfg = workerData.config;
  const result = { generatedAt: new Date().toISOString(), errors: [] };

  let cfopsValidos = null;
  if (cfg.paths.ftnope) {
    try {
      cfopsValidos = lerCfopsValidos(cfg.paths.ftnope);
    } catch (eNope) {
      result.errors.push('ftnope: ' + eNope.message);
    }
  }

  try {
    if (cfg.paths.ftnota) {
      const opcoesFtnota = {
        dateField: 'NDTEMIS',
        valorField: 'NTOTFAT',
        icmsFields: ['NVALICM', 'NVALICM1'],
        pisField: 'NPISNOT',
        cofinsField: 'NCOFNOT',
        filtroValido: { campo: 'NSITPED', valor: '1' },
        filtroExcluido: { campo: 'NDEVNOT', valor: 'S' },
      };
      if (cfopsValidos) opcoesFtnota.natopeWhitelist = Array.from(cfopsValidos);
      const { daily } = aggregateNotasPorDia(cfg.paths.ftnota, opcoesFtnota);
      result.saidas = dailyMapToArray(daily);
    } else {
      result.saidas = [];
    }
  } catch (e) {
    result.errors.push('ftnota: ' + e.message);
    result.saidas = [];
  }

  try {
    if (cfg.paths.ftentr) {
      // "Faturado" (o total exibido no grafico/topo do widget): so as CFOPs de compra de
      // verdade, sem devolucao/movimentacao/bonificacao, e sem o ftcomp (que e so devolucao).
      const { daily: dailyFat } = aggregateNotasPorDia(cfg.paths.ftentr, {
        dateField: 'NDTENTR',
        valorField: 'NTOTNOT',
        icmsFields: [],
        pisField: null,
        cofinsField: null,
        cancelField: null,
        natopeWhitelist: FATURADO_NATOPE_WHITELIST,
      });

      // Impostos (ICMS/PIS/COFINS exibidos no widget de Impostos): ftentr inteiro (todas as
      // CFOPs) + ftcomp (devolucoes), sem filtro de NNATOPE - ja validado exato contra o
      // relatorio do FAT.
      const { daily: dailyImpEntr } = aggregateNotasPorDia(cfg.paths.ftentr, {
        dateField: 'NDTENTR',
        valorField: 'NTOTNOT',
        icmsFields: ['NVALICM'],
        pisField: 'NVALPIS',
        cofinsField: 'NVALFIN',
        cancelField: null,
      });

      let dailyImpFinal = dailyImpEntr;
      if (cfg.paths.ftcomp) {
        try {
          const { daily: dailyComp } = aggregateNotasPorDia(cfg.paths.ftcomp, {
            dateField: 'NDTEMIS',
            valorField: 'NTOTNOT',
            icmsFields: ['NVALICM', 'NVALICM1'],
            pisField: 'NPISNOT',
            cofinsField: 'NCOFNOT',
            filtroValido: { campo: 'NSITPED', valor: '1' },
          });
          dailyImpFinal = mergeDailyMaps(dailyImpEntr, dailyComp);
        } catch (eComp) {
          result.errors.push('ftcomp: ' + eComp.message);
        }
      }

      result.entradas = dailyMapToArray(combineFatComImpostos(dailyFat, dailyImpFinal));
    } else {
      result.entradas = [];
    }
  } catch (e) {
    result.errors.push('ftentr: ' + e.message);
    result.entradas = [];
  }

  try {
    if (cfg.paths.ftcrec) {
      result.receber = aggregateAgingNaoLiquidado(cfg.paths.ftcrec, {
        valorField: 'VALDUP',
        dataPagamentoField: 'DPGDUP',
        dataVencimentoField: 'VCTDUP',
      });
    } else {
      result.receber = { ate30: 0, mais30: 0 };
    }
  } catch (e) {
    result.errors.push('ftcrec: ' + e.message);
    result.receber = { ate30: 0, mais30: 0 };
  }

  try {
    if (cfg.paths.ftcpag) {
      result.pagar = aggregateAgingNaoLiquidado(cfg.paths.ftcpag, {
        valorField: 'VALCPG',
        dataPagamentoField: 'DPGCPG',
        dataVencimentoField: 'VCTCPG',
      });
    } else {
      result.pagar = { ate30: 0, mais30: 0 };
    }
  } catch (e) {
    result.errors.push('ftcpag: ' + e.message);
    result.pagar = { ate30: 0, mais30: 0 };
  }

  parentPort.postMessage(result);
}

run();
