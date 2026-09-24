'use strict';
const { parentPort, workerData } = require('worker_threads');
const {
  lerGrupos, lerProdutos, construirHistoricoCompras,
  lerInfoNotas, calcularMargem,
} = require('./margem-aggregator');
const { lerCfopsValidos } = require('./aggregator');

function run() {
  const { config, from, to } = workerData;
  const p = config.paths;

  const faltando = ['ftlnota', 'ftgrup', 'ftmpri', 'ftlentr'].filter((k) => !p[k]);
  if (faltando.length) {
    parentPort.postMessage({ error: 'Faltam caminhos configurados: ' + faltando.join(', ') });
    return;
  }

  try {
    const grupos = lerGrupos(p.ftgrup);
    const produtos = lerProdutos(p.ftmpri);
    const historico = construirHistoricoCompras(p.ftlentr);

    let cfopsValidos = null;
    if (p.ftnope) {
      try {
        cfopsValidos = lerCfopsValidos(p.ftnope);
      } catch (eNope) {
        // se o ftnope falhar, segue sem o filtro extra em vez de travar a Margem inteira
      }
    }

    const infoNotas = lerInfoNotas(p.ftnota, cfopsValidos);

    const resultado = calcularMargem(p.ftlnota, {
      produtos, grupos, historicoCompras: historico, infoNotas, from, to,
    });

    parentPort.postMessage({ grupos: resultado.grupos, generatedAt: new Date().toISOString() });
  } catch (e) {
    parentPort.postMessage({ error: e.message });
  }
}

run();
