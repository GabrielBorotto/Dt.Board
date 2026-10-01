(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------- Formatação ----------
  function fmtFull(n) {
    n = Number(n) || 0;
    const sign = n < 0 ? '-' : '';
    return sign + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCompact(n) {
    n = Number(n) || 0;
    const abs = Math.abs(n);
    if (abs >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (abs >= 1e3) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  function daysInMonth(year, monthIdx0) { return new Date(year, monthIdx0 + 1, 0).getDate(); }
  function toDateInputValue(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseISODate(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function ehFimDeSemana(d) { const dow = d.getDay(); return dow === 0 || dow === 6; } // domingo=0, sábado=6

  //Calcula a data da Pascoa (domingo) de um ano - algoritmo de Meeus/Jones/Butcher,
  //Usado pra derivar os feriados moveis (Sexta-Feira Santa, Corpus Christi).
  function calcularPascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
  }
  const feriadosPorAno = {}; //cache: ano -> Set de "YYYY-MM-DD", para não recalcular sempre.

  // Feriados nacionais + Rio Grande do Sul, calculando para um ano específico.
  // Carnaval NAO entra - empresa vende os dias.
  function feriadosDoAno(ano) {
    if (feriadosPorAno[ano]) return feriadosPorAno[ano];
    const chave = (d) => toDateInputValue(d);
    const set = new Set();

    // fixos nacionais: contraternização, tiradentes, trabalho, independencia
    // aparecida, finados, proclamação da republica, consciencia negra, natal
    [[0, 1], [3, 21], [4, 1], [8, 7], [9, 12], [10, 2], [10, 15], [10, 20], [11, 25]].forEach(([mes, dia]) => set.add(chave(new Date(ano, mes, dia))));

    // moveis (a partir da Pascoa): Sexta-Feira Santa, Corpus Christi
    const pascoa = calcularPascoa(ano);
    [-47, -2, 60].forEach((offset) => {
      const d = new Date(pascoa);
      d.setDate(d.getDate() + offset);
      set.add(chave(d));
    });

    //Rio Grande do Sul: Revolução Farroupilha
    set.add(chave(new Date(ano, 8, 20)));

    feriadosPorAno[ano] = set;
    return set;
  }

  function ehFeriado(d) {
    return feriadosDoAno(d.getFullYear()).has(toDateInputValue(d));
  }

  // ---------- Cálculo de séries a partir dos buckets diários reais ----------
  // dailyArr: [{date:'YYYY-MM-DD', fat, icms, pis, cofins}, ...] ordenado
  function seriesFor12Meses(dailyArr) {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleDateString('pt-BR', { month: 'short' }) });
    }
    // mesma janela de 12 meses, mas exatamente um ano atras (ex: se hoje mostra out/25 a
    // set/26, essa lista vira out/24 a set/25) - assim "outubro" sempre compara com "outubro".
    const monthsAnoPassado = months.map((m) => {
      const [ano, mes] = m.key.split('-').map(Number);
      return { key: (ano - 1) + '-' + String(mes).padStart(2, '0') };
    });

    const sums = {};
    months.forEach((m) => { sums[m.key] = 0; });
    const sumsAnoPassado = {};
    monthsAnoPassado.forEach((m) => { sumsAnoPassado[m.key] = 0; });

    dailyArr.forEach((r) => {
      const k = r.date.slice(0, 7);
      if (sums[k] !== undefined) sums[k] += r.fat;
      if (sumsAnoPassado[k] !== undefined) sumsAnoPassado[k] += r.fat;
    });

    const values = months.map((m) => sums[m.key]);
    const valuesAnoPassado = monthsAnoPassado.map((m) => sumsAnoPassado[m.key]);
    return {
      labels: months.map((m) => m.label),
      values,
      valuesAnoPassado,
      total: values.reduce((a, b) => a + b, 0),
    };
  }

  // Soma o MES INTEIRO de um ano especifico (nunca corta no dia de hoje, mesmo que seja o
  // mes atual) - a meta sempre compara contra o total completo do mesmo mes, ano passado,
  // nao uma fatia parcial dele.
  function totalMesAnoPassado(dailyArr, year, monthIdx0) {
    const prefixAnoPassado = (year - 1) + '-' + String(monthIdx0 + 1).padStart(2, '0');
    let total = 0;
    dailyArr.forEach((r) => {if (r.date.startsWith(prefixAnoPassado)) total += r.fat; });
    return total;
  }

  // Mesma ideia, mas pra um intervalo de datas livre- desloca as duas datas um ano pra tras
  // e soma os dias desse intervalo deslocado.
  function totalRangeAnoPassado(dailyArr, fromStr, toStr) {
    const from = parseISODate(fromStr), to = parseISODate(toStr);
    if (!from || !to || from > to) return 0;
    const fromAnoPassado = new Date(from.getFullYear() - 1, from.getMonth(), from.getDate());
    const toAnoPassado = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
    const byDay = {};
    dailyArr.forEach((r) => { byDay[r.date] = r; });
    let total = 0;
    const cursor = new Date(fromAnoPassado);
    while (cursor <= toAnoPassado) {
      const r = byDay[toDateInputValue(cursor)];
      if (r) total += r.fat;
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  }

  // Ponto de entrada unico - espelha o computeSeries, mas so retorna o TOTAL do mesmo
  // periodo, um ano atras (usado pra calcular a meta).
  function totalAnoPassado(dailyArr, period, from, to) {
    const now = new Date();
    if (period === 'thisMonth') return totalMesAnoPassado(dailyArr, now.getFullYear(), now.getMonth());
    if (period === 'lastMonth') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return totalMesAnoPassado(dailyArr, d.getFullYear(), d.getMonth()); }
    if (period === 'range') return totalRangeAnoPassado(dailyArr, from, to);
    const s = seriesFor12Meses(dailyArr); // reaproveita o que a gente ja calcula pra 12 meses
    return (s.valuesAnoPassado || []).reduce((a, b) => a + b, 0);
  }
  

  function seriesForMonth(dailyArr, year, monthIdx0) {
    const prefix = year + '-' + String(monthIdx0 + 1).padStart(2, '0');
    const byDay = {};
    dailyArr.forEach((r) => { if (r.date.startsWith(prefix)) byDay[r.date] = r; });
    const totalDays = daysInMonth(year, monthIdx0);
    const now = new Date();
    const isCurrent = (year === now.getFullYear() && monthIdx0 === now.getMonth());
    const upto = isCurrent ? now.getDate() : totalDays;
    const labels = [], values = [];
    for (let d = 1; d <= upto; d++) {
      const key = prefix + '-' + String(d).padStart(2, '0');
      const r = byDay[key];
      const dataDia = new Date(year, monthIdx0, d);
      // pula fim de semana sem nenhuma venda, pra nao criar um "dente de serra" no gráfico -
      // se por acaso teve venda num sábado/domingo, esse dia continua aparecendo normalmente.
      if ((ehFimDeSemana(dataDia) || ehFeriado(dataDia)) && !r) continue;
      labels.push(String(d).padStart(2, '0') + '/' + String(monthIdx0 + 1).padStart(2, '0'));
      values.push(r ? r.fat : 0);
    }
    return { labels, values, total: values.reduce((a, b) => a + b, 0) };
  }

  // Intervalo livre entre duas datas (inclusive), um ponto por dia.
  function seriesForRange(dailyArr, fromStr, toStr) {
    const byDay = {};
    dailyArr.forEach((r) => { byDay[r.date] = r; });
    const from = parseISODate(fromStr), to = parseISODate(toStr);
    const labels = [], values = [];
    if (from && to && from <= to) {
      const cursor = new Date(from);
      while (cursor <= to) {
        const key = toDateInputValue(cursor);
        const r = byDay[key];
        // mesma regra: pula fim de semana sem venda, pra nao quebrar a visualizacao
        if ((ehFimDeSemana(cursor) || ehFeriado(cursor)) && !r) { cursor.setDate(cursor.getDate() + 1); continue; }
        labels.push(String(cursor.getDate()).padStart(2, '0') + '/' + String(cursor.getMonth() + 1).padStart(2, '0'));
        values.push(r ? r.fat : 0);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return { labels, values, total: values.reduce((a, b) => a + b, 0) };
  }

  function periodLabel(period, from, to) {
    if (period === 'thisMonth') return 'este mês (por dia)';
    if (period === 'lastMonth') return 'mês passado (por dia)';
    if (period === 'range') {
      if (!from || !to) return 'selecione o intervalo';
      return parseISODate(from).toLocaleDateString('pt-BR') + ' a ' + parseISODate(to).toLocaleDateString('pt-BR');
    }
    return 'últimos 12 meses';
  }

  function computeSeries(dailyArr, period, from, to) {
    const now = new Date();
    if (period === 'thisMonth') return seriesForMonth(dailyArr, now.getFullYear(), now.getMonth());
    if (period === 'lastMonth') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return seriesForMonth(dailyArr, d.getFullYear(), d.getMonth()); }
    if (period === 'range') return seriesForRange(dailyArr, from, to);
    return seriesFor12Meses(dailyArr);
  }

  // ---------- Estado ----------
  const state = {
    data: { saidas: [], entradas: [], receber: { ate30: 0, mais30: 0 }, pagar: { ate30: 0, mais30: 0 } },
    widgets: {
      saidas: { period: '12m', from: toDateInputValue(daysAgo(7)), to: toDateInputValue(yesterday()) },
      entradas: { period: '12m', from: toDateInputValue(daysAgo(7)), to: toDateInputValue(yesterday()) },
      impostos: { period: 'thisMonth', month: toMonthInputValue(new Date()) },
      margem: { period: 'thisMonth', from: toDateInputValue(daysAgo(30)), to: toDateInputValue(yesterday()), sort: 'padrao' },
    },
  };
  let margemData = [];
  let margemExpanded = new Set();
  let metaConfig = { metaCrescimentoPct: 10, metaFixaSaidas: '' };

  function yesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return d; }
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
  function toMonthInputValue(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  const charts = {};

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      gold: cs.getPropertyValue('--gold').trim() || '#e0a941',
      muted: cs.getPropertyValue('--muted').trim() || '#8b95a8',
      line: cs.getPropertyValue('--line').trim() || '#232c3d',
      compare: cs.getPropertyValue('--compare').trim() || '#7fc4c9',
    };
  }

    // Faz as duas linhas do grafico (este ano / ano passado) se misturarem de verdade (modo
  // aditivo) onde se cruzam, em vez de uma simplesmente tampar a outra por cima.
  const blendPlugin = {
    id: 'blend',
    beforeDatasetsDraw(chart) { chart.ctx.save(); chart.ctx.globalCompositeOperation = 'lighter'; },
    afterDatasetsDraw(chart) { chart.ctx.restore(); },
  };

  function ensureChart(canvasId) {
    if (charts[canvasId]) return charts[canvasId];
    const ctx = $(canvasId).getContext('2d');
    const c = themeColors();
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, hexToRgba(c.gold, 0.35));
    gradient.addColorStop(1, hexToRgba(c.gold, 0.02));
    charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Este ano',
            data: [],
            borderColor: c.gold,
            backgroundColor: gradient,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHitRadius: 12,
            borderWidth: 2,
          },
          {
            // segunda linha (mesmo periodo do ano passado) - so recebe dado quando for
            // Saidas + aba "12 meses"; nos outros casos fica com data:[] (vazia) e nao
            // desenha nada, nem aparece no tooltip.
            label: 'Ano passado',
            data: [],
            borderColor: c.compare,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHitRadius: 12,
            borderWidth: 2,
          },
        ],
      },
      plugins: [blendPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: (ctx) => {
            const brutos = ctx.datasetIndex === 1 ? charts[canvasId]._valoresReaisAnoPassado : charts[canvasId]._valoresReais;
            const v = (brutos && brutos[ctx.dataIndex] !== undefined) ? brutos[ctx.dataIndex] : ctx.parsed.y;
            const temComparacao = ctx.chart.data.datasets[1] && ctx.chart.data.datasets[1].data.length > 0;
            return temComparacao ? (ctx.dataset.label + ': ' + fmtFull(v)) : fmtFull(v);
          } },
        } },
        scales: {
          x: { ticks: { color: c.muted, font: { size: 10 } }, grid: { color: c.line } },
          y: { ticks: { color: c.muted, font: { size: 10 }, callback: (v) => fmtCompact(v) }, grid: { color: c.line } },
        },
      },
    });
    return charts[canvasId];
  }
  
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // Recria os graficos ja existentes com as cores do tema atual (chamado ao trocar de tema).
  function restyleChartsForTheme() {
    ['saidasChart', 'entradasChart'].forEach((id) => {
      if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    });
    if (state.data.saidas.length || state.data.entradas.length) {
      renderChartWidget('saidas');
      renderChartWidget('entradas');
    }
  }

    function renderChartWidget(target) {
    const w = state.widgets[target];
    const s = computeSeries(state.data[target], w.period, w.from, w.to);
    const chart = ensureChart(target + 'Chart');
    chart.data.labels = s.labels;
    chart.data.datasets[0].data = s.values;
    chart._valoresReais = s.values; // o tooltip usa esse array pra mostrar o valor real do dia

    // segunda linha (ano passado) so aparece nas Saidas, na aba "12 meses"
    const mostrarAnoPassado = target === 'saidas' && w.period === '12m' && s.valuesAnoPassado;
    chart.data.datasets[1].data = mostrarAnoPassado ? s.valuesAnoPassado : [];
    chart._valoresReaisAnoPassado = mostrarAnoPassado ? s.valuesAnoPassado : [];

    chart.update();
    $(target + 'PeriodLabel').textContent = periodLabel(w.period, w.from, w.to);
    $(target + 'Total').textContent = 'Total: ' + fmtFull(s.total);

    if (target === 'saidas') renderMetaSaidas(s.total, w.period, w.from, w.to);
  }

  // Calcula e desenha a meta de faturamento das Saidas. Usa o valor fixo das Configuracoes
  // quando preenchido (e a aba for "Este mes"); caso contrario, calcula automaticamente como
  // o mesmo periodo do ano passado + a % de crescimento configurada.
  function renderMetaSaidas(totalAtual, period, from, to) {
    const usaFixa = period === 'thisMonth' && metaConfig.metaFixaSaidas !== '' && !isNaN(Number(metaConfig.metaFixaSaidas));
    let meta;
    if (usaFixa) {
      meta = Number(metaConfig.metaFixaSaidas);
    } else {
      const anoPassado = totalAnoPassado(state.data.saidas, period, from, to);
      meta = anoPassado * (1 + (Number(metaConfig.metaCrescimentoPct) || 0) / 100);
    }

    const pct = meta > 0 ? (totalAtual / meta * 100) : null;
    $('saidasMetaValor').textContent = fmtFull(meta);
    $('saidasMetaPct').textContent = pct === null ? '—' : Math.round(pct) + '%';
    $('saidasProgressoFill').style.width = (pct === null ? 0 : Math.min(100, pct)) + '%';
  }

  function renderAgingWidget(prefix, aging) {
    const a = aging || { ate30: 0, mais30: 0 };
    $(prefix + 'Ate30').textContent = fmtFull(a.ate30);
    $(prefix + 'Mais30').textContent = fmtFull(a.mais30);
  }

  // ---------- Widget de impostos (saída x entrada x resultado) ----------
  function sumTaxesByPrefix(dailyArr, prefix) {
    let icms = 0, pis = 0, cofins = 0;
    dailyArr.forEach((r) => { if (r.date.startsWith(prefix)) { icms += r.icms; pis += r.pis; cofins += r.cofins; } });
    return { icms, pis, cofins };
  }

  function impostosPrefixForPeriod(period, month) {
    const now = new Date();
    if (period === 'year') return String(now.getFullYear());
    if (period === 'lastMonth') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return toMonthInputValue(d); }
    if (period === 'month') return month || toMonthInputValue(now);
    return toMonthInputValue(now); // thisMonth
  }

  function impostosPeriodLabel(period, month) {
    const now = new Date();
    if (period === 'year') return 'este ano (' + now.getFullYear() + ')';
    if (period === 'lastMonth') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
    if (period === 'month') {
      if (!month) return 'escolha um mês';
      const [y, m] = month.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    }
    return 'este mês';
  }

  function setTaxCell(id, value) {
    const el = $(id);
    el.textContent = fmtFull(value);
    el.classList.toggle('negative', value < 0);
    el.classList.toggle('positive', value > 0);
  }

  function renderImpostosWidget() {
    const w = state.widgets.impostos;
    const prefix = impostosPrefixForPeriod(w.period, w.month);
    const saida = sumTaxesByPrefix(state.data.saidas, prefix);
    const entrada = sumTaxesByPrefix(state.data.entradas, prefix);

    setTaxCell('impIcmsSaida', saida.icms);
    setTaxCell('impIcmsEntrada', entrada.icms);
    setTaxCell('impIcmsResultado', saida.icms - entrada.icms);

    setTaxCell('impPisSaida', saida.pis);
    setTaxCell('impPisEntrada', entrada.pis);
    setTaxCell('impPisResultado', saida.pis - entrada.pis);

    setTaxCell('impCofinsSaida', saida.cofins);
    setTaxCell('impCofinsEntrada', entrada.cofins);
    setTaxCell('impCofinsResultado', saida.cofins - entrada.cofins);

    const totalSaida = saida.icms + saida.pis + saida.cofins;
    const totalEntrada = entrada.icms + entrada.pis + entrada.cofins;
    setTaxCell('impTotalSaida', totalSaida);
    setTaxCell('impTotalEntrada', totalEntrada);
    setTaxCell('impTotalResultado', totalSaida - totalEntrada);

    $('impostosPeriodLabel').textContent = impostosPeriodLabel(w.period, w.month);
  }

  // ---------- Widget de margem por grupo (tabela expansível, sob demanda) ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function fmtQtd(n) {
    n = Number(n) || 0;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }
  function fmtPct(margem, valorFinal) {
    if (!valorFinal) return '—';
    return (margem / valorFinal * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function margemPeriodRange(period, from, to) {
    const now = new Date();
    if (period === 'thisMonth') {
      return { fromISO: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)), toISO: toDateInputValue(now) };
    }
    if (period === 'lastMonth') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { fromISO: toDateInputValue(start), toISO: toDateInputValue(end) };
    }
    return { fromISO: from, toISO: to };
  }

  function margemPeriodLabel(period, from, to) {
    if (period === 'thisMonth') return 'este mês';
    if (period === 'lastMonth') return 'mês passado';
    if (!from || !to) return 'selecione o intervalo';
    return parseISODate(from).toLocaleDateString('pt-BR') + ' a ' + parseISODate(to).toLocaleDateString('pt-BR');
  }

  // Calcula a margem % como numero (nao formatado) - usado so pra ordenar a tabela.
  // Retorna null quando nao da pra calcular (valorFinal=0), pra esses casos sempre
  // irem pro final da lista, independente da direcao escolhida.
  function margemPctValue(margem, valorFinal) {
    return valorFinal ? margem / valorFinal : null;
  }

  function compararPorMargemPct(sortMode) {
    return (a, b) => {
      const pa = margemPctValue(a.margem, a.valorFinal);
      const pb = margemPctValue(b.margem, b.valorFinal);
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return sortMode === 'maiorPct' ? pb - pa : pa - pb;
    };
  }

  function renderMargemTable() {
    const tbody = $('margemBody');
    if (!margemData || margemData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="margem-loading">Nenhuma venda no período selecionado.</td></tr>';
      return;
    }
    const sortMode = state.widgets.margem.sort || 'padrao';
    const grupos = sortMode === 'padrao' ? margemData : [...margemData].sort(compararPorMargemPct(sortMode));

    let html = '';
    grupos.forEach((g) => {
      const expanded = margemExpanded.has(g.codigo);
      const gCor = g.margem < 0 ? 'negative' : 'positive';
      html += '<tr class="margem-row-grupo' + (expanded ? ' expanded' : '') + '" data-grupo="' + escapeHtml(g.codigo) + '">' +
        '<td><span class="margem-arrow">&#9656;</span></td>' +
        '<td>' + escapeHtml(g.desc) + '</td>' +
        '<td class="num">' + fmtQtd(g.qtd) + '</td>' +
        '<td class="num">' + fmtFull(g.valorFinal) + '</td>' +
        '<td class="num">' + fmtFull(g.custo) + '</td>' +
        '<td class="num ' + gCor + '">' + fmtFull(g.margem) + '</td>' +
        '<td class="num ' + gCor + '">' + fmtPct(g.margem, g.valorFinal) + '</td>' +
        '</tr>';
      if (expanded) {
        const itens = sortMode === 'padrao' ? g.itens : [...g.itens].sort(compararPorMargemPct(sortMode));
        itens.forEach((it) => {
          const iCor = it.margem < 0 ? 'negative' : 'positive';
          html += '<tr class="margem-row-item">' +
            '<td></td>' +
            '<td class="margem-item-nome">' + escapeHtml(it.desc) + ' <span class="margem-codigo">' + escapeHtml(it.codigo) + '</span></td>' +
            '<td class="num">' + fmtQtd(it.qtd) + '</td>' +
            '<td class="num">' + fmtFull(it.valorFinal) + '</td>' +
            '<td class="num">' + fmtFull(it.custo) + '</td>' +
            '<td class="num ' + iCor + '">' + fmtFull(it.margem) + '</td>' +
            '<td class="num ' + iCor + '">' + fmtPct(it.margem, it.valorFinal) + '</td>' +
            '</tr>';
        });
      }
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('.margem-row-grupo').forEach((tr) => {
      tr.addEventListener('click', () => {
        const cod = tr.dataset.grupo;
        if (margemExpanded.has(cod)) margemExpanded.delete(cod); else margemExpanded.add(cod);
        renderMargemTable();
      });
    });
  }

  let margemRequestId = 0;

  function loadMargemData() {
    const meuId = ++margemRequestId; // marca esta chamada como a mais recente
    const w = state.widgets.margem;
    const { fromISO, toISO } = margemPeriodRange(w.period, w.from, w.to);
    $('margemPeriodLabel').textContent = margemPeriodLabel(w.period, w.from, w.to);
    if (w.period === 'range' && (!w.from || !w.to)) return;
    $('margemBody').innerHTML = '<tr><td colspan="7" class="margem-loading">Carregando…</td></tr>';
    window.api.getMargemData(fromISO, toISO).then((result) => {
      if (meuId !== margemRequestId) return; // uma chamada mais nova ja foi feita - ignora esta resposta atrasada
      if (result && result.error) {
        $('margemBody').innerHTML = '<tr><td colspan="7" class="margem-loading">' + escapeHtml(result.error) + '</td></tr>';
        margemData = [];
        return;
      }
      margemData = (result && result.grupos) || [];
      renderMargemTable();
    }).catch((err) => {
      if (meuId !== margemRequestId) return;
      $('margemBody').innerHTML = '<tr><td colspan="7" class="margem-loading">Erro: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }

  function renderAll() {
    renderChartWidget('saidas');
    renderChartWidget('entradas');
    renderAgingWidget('receber', state.data.receber);
    renderAgingWidget('pagar', state.data.pagar);
    renderImpostosWidget();
  }

  // ---------- Abas de período ----------
  document.querySelectorAll('.period-tabs').forEach((group) => {
    const target = group.dataset.target;
    group.querySelectorAll('.period-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.period-tab').forEach((b) => b.classList.toggle('active', b === btn));
        state.widgets[target].period = btn.dataset.period;

        if (target === 'saidas' || target === 'entradas' || target === 'margem') {
          const rangeEl = $(target + 'Range');
          if (btn.dataset.period === 'range') {
            rangeEl.classList.add('visible');
            $(target + 'From').value = state.widgets[target].from;
            $(target + 'To').value = state.widgets[target].to;
          } else {
            rangeEl.classList.remove('visible');
          }
          if (target === 'margem') loadMargemData(); else renderChartWidget(target);
        } else if (target === 'impostos') {
          const monthWrap = $('impostosMonthWrap');
          if (btn.dataset.period === 'month') {
            monthWrap.classList.add('visible');
            $('impostosMonth').value = state.widgets.impostos.month;
          } else {
            monthWrap.classList.remove('visible');
          }
          renderImpostosWidget();
        }
      });
    });
  });
  document.querySelectorAll('.sort-tabs').forEach((group) => {
    const target = group.dataset.target;
    group.querySelectorAll('.sort-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.sort-tab').forEach((b) => b.classList.toggle('active', b === btn));
        state.widgets[target].sort = btn.dataset.sort;
        if (target === 'margem') renderMargemTable();
      });
    });
  });
  ['saidas', 'entradas', 'margem'].forEach((target) => {
    const fromEl = $(target + 'From'), toEl = $(target + 'To');
    function onRangeChange() {
      if (fromEl.value) state.widgets[target].from = fromEl.value;
      if (toEl.value) state.widgets[target].to = toEl.value;
      if (state.widgets[target].period === 'range') {
        if (target === 'margem') loadMargemData(); else renderChartWidget(target);
      }
    }
    fromEl.addEventListener('change', onRangeChange);
    toEl.addEventListener('change', onRangeChange);
  });
  $('impostosMonth').addEventListener('change', () => {
    state.widgets.impostos.month = $('impostosMonth').value || state.widgets.impostos.month;
    if (state.widgets.impostos.period === 'month') renderImpostosWidget();
  });

  // ---------- Layout ajustável (mover e redimensionar widgets) ----------
  const GRID_COLS = 12, GRID_ROWS = 40, GAP = 12, MIN_SPAN = 2;

  const DEFAULT_LAYOUT = {
    saidas:   { col: 1, colSpan: 12, row: 1,  rowSpan: 8 }, // 1 - prioridade maxima, bem grande
    margem:   { col: 1, colSpan: 12, row: 9, rowSpan: 9 }, // 2 - tambem grande, mais alta ainda (tabela densa)
    entradas: { col: 1, colSpan: 8, row: 18, rowSpan: 9 },  // 3
    impostos: { col: 9, colSpan: 4, row: 18, rowSpan: 5 },  // 4
    receber:  { col: 9, colSpan: 4,  row: 23, rowSpan: 2 },  // 5 - menor prioridade, embaixo de tudo
    pagar:    { col: 9, colSpan: 4,  row: 25, rowSpan: 2 },  // 5
  };

  let layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  let widgetEls = {};

  function applyWidgetLayoutPos(id, pos) {
    const el = widgetEls[id];
    if (!el || !pos) return;
    el.style.gridColumn = pos.col + ' / span ' + pos.colSpan;
    el.style.gridRow = pos.row + ' / span ' + pos.rowSpan;
  }
  function applyWidgetLayout(id) { applyWidgetLayoutPos(id, layout[id]); }
  function applyAllLayout() { Object.keys(layout).forEach(applyWidgetLayout); }

  function resizeCharts() {
    if (charts.saidasChart) charts.saidasChart.resize();
    if (charts.entradasChart) charts.entradasChart.resize();
  }

  function toggleEditMode() {
    const grid = $('dashboardGrid');
    const active = grid.classList.toggle('edit-mode');
    document.body.classList.toggle('edit-mode', active);
    $('editLayoutBtn').classList.toggle('active', active);
    $('copyLayoutBtn').style.display = active ? '' : 'none';
  }

  // Gera o layout atual no MESMO formato usado no codigo (DEFAULT_LAYOUT) e copia pra area
  // de transferencia - assim da pra colar direto no renderer.js sem digitar numero nenhum.
  function copyLayoutAsCode() {
    const ids = Object.keys(layout);
    const maiorNome = Math.max(...ids.map((id) => id.length));
    const linhas = ids.map((id) => {
      const l = layout[id];
      const nome = (id + ':').padEnd(maiorNome + 2);
      return '    ' + nome + '{ col: ' + l.col + ', colSpan: ' + l.colSpan + ', row: ' + l.row + ', rowSpan: ' + l.rowSpan + ' },';
    });
    const codigo = '  const DEFAULT_LAYOUT = {\n' + linhas.join('\n') + '\n  };';

    navigator.clipboard.writeText(codigo).then(() => {
      const btn = $('copyLayoutBtn');
      const original = btn.innerHTML;
      btn.innerHTML = '&#10003;'; // check
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    }).catch(() => {
      // fallback: mostra numa caixa de texto pra copiar na mao, caso a area de transferencia falhe
      window.prompt('Copie o texto abaixo (Ctrl+C):', codigo);
    });
  }

  function resetLayout() {
    layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    applyAllLayout();
    resizeCharts();
  }

  function rectsOverlap(a, b) {
    const aColEnd = a.col + a.colSpan - 1, bColEnd = b.col + b.colSpan - 1;
    const aRowEnd = a.row + a.rowSpan - 1, bRowEnd = b.row + b.rowSpan - 1;
    return a.col <= bColEnd && aColEnd >= b.col && a.row <= bRowEnd && aRowEnd >= b.row;
  }
  function hasCollision(widgetId, pos) {
    return Object.keys(layout).some((id) => id !== widgetId && rectsOverlap(pos, layout[id]));
  }

  function startResize(e, widgetId) {
    e.preventDefault(); e.stopPropagation();
    const grid = $('dashboardGrid');
    const rect = grid.getBoundingClientRect();
    const cellW = (rect.width - GAP * (GRID_COLS - 1)) / GRID_COLS;
    const cellH = (grid.scrollHeight - GAP * (GRID_ROWS - 1)) / GRID_ROWS; // scrollHeight, nao a altura visivel - o grid pode ser mais alto que a tela (rolagem)
    const startX = e.clientX, startY = e.clientY;
    const start = Object.assign({}, layout[widgetId]);
    const maxColSpan = GRID_COLS - start.col + 1;
    const maxRowSpan = GRID_ROWS - start.row + 1;

    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let colSpan = Math.round(start.colSpan + dx / (cellW + GAP));
      let rowSpan = Math.round(start.rowSpan + dy / (cellH + GAP));
      colSpan = Math.max(MIN_SPAN, Math.min(maxColSpan, colSpan));
      rowSpan = Math.max(MIN_SPAN, Math.min(maxRowSpan, rowSpan));
      const candidate = { col: start.col, row: start.row, colSpan, rowSpan };
      while (candidate.colSpan > MIN_SPAN && hasCollision(widgetId, candidate)) candidate.colSpan--;
      while (candidate.rowSpan > MIN_SPAN && hasCollision(widgetId, candidate)) candidate.rowSpan--;
      layout[widgetId].colSpan = candidate.colSpan;
      layout[widgetId].rowSpan = candidate.rowSpan;
      applyWidgetLayout(widgetId);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      resizeCharts();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function startDrag(e, widgetId) {
    e.preventDefault(); e.stopPropagation();
    const grid = $('dashboardGrid');
    const rect = grid.getBoundingClientRect();
    const cellW = (rect.width - GAP * (GRID_COLS - 1)) / GRID_COLS;
    const cellH = (grid.scrollHeight - GAP * (GRID_ROWS - 1)) / GRID_ROWS; // idem: scrollHeight, nao a altura visivel
    const startX = e.clientX, startY = e.clientY;
    const start = Object.assign({}, layout[widgetId]);
    const el = widgetEls[widgetId];
    el.classList.add('dragging');
    let lastValid = Object.assign({}, start);

    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let col = start.col + Math.round(dx / (cellW + GAP));
      let row = start.row + Math.round(dy / (cellH + GAP));
      col = Math.max(1, Math.min(GRID_COLS - start.colSpan + 1, col));
      row = Math.max(1, Math.min(GRID_ROWS - start.rowSpan + 1, row));
      const candidate = { col, row, colSpan: start.colSpan, rowSpan: start.rowSpan };
      if (!hasCollision(widgetId, candidate)) {
        lastValid = candidate;
        applyWidgetLayoutPos(widgetId, candidate);
      }
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      layout[widgetId] = lastValid;
      applyWidgetLayout(widgetId);
      resizeCharts();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function initLayoutSystem() {
    document.querySelectorAll('.widget').forEach((el) => { widgetEls[el.dataset.widget] = el; });
    applyAllLayout();
    document.querySelectorAll('.drag-handle').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        if (!$('dashboardGrid').classList.contains('edit-mode')) return;
        startDrag(e, h.closest('.widget').dataset.widget);
      });
    });
    document.querySelectorAll('.resize-handle').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        if (!$('dashboardGrid').classList.contains('edit-mode')) return;
        startResize(e, h.closest('.widget').dataset.widget);
      });
    });
    $('editLayoutBtn').addEventListener('click', toggleEditMode);
    $('copyLayoutBtn').addEventListener('click', copyLayoutAsCode);
    $('resetLayoutBtn').addEventListener('click', resetLayout);
  }
  initLayoutSystem();

  // ---------- Relógio ----------
  function tickClock() {
    const now = new Date();
    $('clockTime').textContent = now.toLocaleTimeString('pt-BR');
    $('clockDate').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- Status / dados vindos do processo principal ----------
  function setStatus(kind, text) {
    const dot = $('statusDot');
    dot.className = 'status-dot' + (kind ? ' ' + kind : '');
    $('statusText').textContent = text;
  }

  function applyData(data) {
    if (!data) return;
    state.data.saidas = data.saidas || [];
    state.data.entradas = data.entradas || [];
    state.data.receber = data.receber || { ate30: 0, mais30: 0 };
    state.data.pagar = data.pagar || { ate30: 0, mais30: 0 };
    renderAll();
    const when = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('pt-BR') : '--';
    setStatus('ok', 'atualizado às ' + when);
    const errBar = $('errorBar');
    if (data.errors && data.errors.length) {
      errBar.style.display = 'block';
      errBar.textContent = 'Alguns arquivos não puderam ser lidos: ' + data.errors.join(' | ');
    } else {
      errBar.style.display = 'none';
    }
  }

  window.api.onDashboardUpdated((data) => applyData(data));
  window.api.onDashboardScanning((isScanning) => { if (isScanning) setStatus('scanning', 'atualizando…'); });
  window.api.onDashboardError((msg) => setStatus('error', 'erro: ' + msg));

  let updateProntoParaInstalar = false;

  window.api.onUpdateAvailable((version) => {
    $('updateBadgeText').textContent = 'Baixando atualização v' + version + '...';
    $('updateBadge').style.display = 'flex';
  });

  window.api.onUpdateDownloaded((version) => {
    updateProntoParaInstalar = true;
    $('updateBadgeText').textContent = 'Reiniciar para atualizar (v' + version +')';
    $('updateBadge').style.display = 'flex';
  });

  $('updateBadge').addEventListener('click', () => {
    if (!updateProntoParaInstalar) return; // ainda baixando, clicar nao faz nada ainda
    window.api.installUpdateNow();
  });

  function applyLogo(dataUrl) {
    const img = $('companyLogo');
    const diamond = $('brandDiamond');
    if (dataUrl) {
      img.src = dataUrl;
      img.style.display = 'inline-block';
      diamond.style.display = 'none';
    } else {
      img.style.display = 'none';
      img.removeAttribute('src');
      diamond.style.display = 'inline';
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  window.api.getConfig().then((cfg) => {
    $('companyName').textContent = cfg.companyName || 'Minha Empresa';
    applyLogo(cfg.logoDataUrl);
    applyTheme(cfg.theme);
    metaConfig.metaCrescimentoPct = cfg.metaCrescimentoPct != null ? cfg.metaCrescimentoPct : 10;
    metaConfig.metaFixaSaidas = cfg.metaFixaSaidas || '';
    if (state.data.saidas.length) renderChartWidget('saidas'); 
  });
  window.api.getAppVersion().then((v) => { $('appVersion').textContent = 'v' + v; });
  window.api.getDashboardData().then((data) => { if (data) applyData(data); });
  loadMargemData();

  $('refreshBtn').addEventListener('click', () => {
    setStatus('scanning', 'atualizando…');
    window.api.refreshNow();
    loadMargemData();
  });

  // ---------- Configurações ----------
  let pendingLogoDataUrl = '';
  const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB no arquivo original

  function updateLogoPreview() {
    const preview = $('cfgLogoPreview');
    const removeBtn = $('cfgLogoRemove');
    if (pendingLogoDataUrl) {
      preview.src = pendingLogoDataUrl;
      preview.style.display = 'inline-block';
      removeBtn.style.display = 'inline-block';
    } else {
      preview.style.display = 'none';
      removeBtn.style.display = 'none';
    }
  }

  let pendingTheme = 'dark';
  let originalTheme = 'dark';

  function updateThemeButtons() {
    $('themeLightBtn').classList.toggle('active', pendingTheme === 'light');
    $('themeDarkBtn').classList.toggle('active', pendingTheme === 'dark');
  }

  function openSettings() {
    window.api.getConfig().then((cfg) => {
      $('cfgCompanyName').value = cfg.companyName || '';
      pendingLogoDataUrl = cfg.logoDataUrl || '';
      updateLogoPreview();
      originalTheme = cfg.theme || 'dark';
      pendingTheme = originalTheme;
      updateThemeButtons();
      $('cfgFtnota').value = cfg.paths.ftnota || '';
      $('cfgFtentr').value = cfg.paths.ftentr || '';
      $('cfgFtcomp').value = cfg.paths.ftcomp || '';
      $('cfgFtcrec').value = cfg.paths.ftcrec || '';
      $('cfgFtcpag').value = cfg.paths.ftcpag || '';
      $('cfgFtlnota').value = cfg.paths.ftlnota || '';
      $('cfgFtgrup').value = cfg.paths.ftgrup || '';
      $('cfgFtmpri').value = cfg.paths.ftmpri || '';
      $('cfgFtlentr').value = cfg.paths.ftlentr || '';
      $('cfgFtnope').value = cfg.paths.ftnope || '';
      $('cfgRefreshMinutes').value = cfg.refreshMinutes || 5;
      $('cfgMetaCrescimentoPct').value = cfg.metaCrescimentoPct != null ? cfg.metaCrescimentoPct : 10;
      $('cfgMetaFixaSaidas').value = cfg.metaFixaSaidas || '';
      $('settingsOverlay').style.display = 'flex';
    });
  }
  $('settingsBtn').addEventListener('click', openSettings);
  $('cfgCancel').addEventListener('click', () => {
    applyTheme(originalTheme); // desfaz qualquer pré-visualização de tema não salva
    $('settingsOverlay').style.display = 'none';
  });

  $('themeLightBtn').addEventListener('click', () => { pendingTheme = 'light'; applyTheme('light'); updateThemeButtons(); });
  $('themeDarkBtn').addEventListener('click', () => { pendingTheme = 'dark'; applyTheme('dark'); updateThemeButtons(); });

  $('cfgLogoChoose').addEventListener('click', () => { $('cfgLogoFile').click(); });
  $('cfgLogoRemove').addEventListener('click', () => {
    pendingLogoDataUrl = '';
    $('cfgLogoFile').value = '';
    updateLogoPreview();
  });
  $('cfgLogoFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Escolha um arquivo de imagem (PNG, JPG, SVG...).');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      alert('Imagem muito grande (máximo 2 MB). Escolha um arquivo menor.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingLogoDataUrl = reader.result;
      updateLogoPreview();
    };
    reader.readAsDataURL(file);
  });

  $('cfgSave').addEventListener('click', () => {
    const newConfig = {
      companyName: $('cfgCompanyName').value.trim() || 'Minha Empresa',
      logoDataUrl: pendingLogoDataUrl,
      theme: pendingTheme,
      paths: {
        ftnota: $('cfgFtnota').value.trim(),
        ftentr: $('cfgFtentr').value.trim(),
        ftcomp: $('cfgFtcomp').value.trim(),
        ftcrec: $('cfgFtcrec').value.trim(),
        ftcpag: $('cfgFtcpag').value.trim(),
        ftlnota: $('cfgFtlnota').value.trim(),
        ftgrup: $('cfgFtgrup').value.trim(),
        ftmpri: $('cfgFtmpri').value.trim(),
        ftlentr: $('cfgFtlentr').value.trim(),
        ftnope: $('cfgFtnope').value.trim(),
      },
      refreshMinutes: Math.max(1, Number($('cfgRefreshMinutes').value) || 5),
      metaCrescimentoPct: Math.max(0, Number($('cfgMetaCrescimentoPct').value) || 0),
      metaFixaSaidas: $('cfgMetaFixaSaidas').value.trim(),
    };
    window.api.saveConfig(newConfig).then((cfg) => {
      $('companyName').textContent = cfg.companyName;
      applyLogo(cfg.logoDataUrl);
      applyTheme(cfg.theme);
      restyleChartsForTheme();
      $('settingsOverlay').style.display = 'none';
      setStatus('scanning', 'atualizando…');
      window.api.refreshNow();
      loadMargemData();
      metaConfig.metaCrescimentoPct = cfg.metaCrescimentoPct != null ? cfg.metaCrescimentoPct : 10;
      metaConfig.metaFixaSaidas = cfg.metaFixaSaidas || '';
      renderChartWidget('saidas');
    });
  });
})();
