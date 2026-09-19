(() => {
  const STORAGE_KEY = 'jp225-ftmo-cadre-v1';
  const INSTALL_HINT_KEY = 'jp225-ftmo-install-hint-dismissed';

  const defaults = {
    balance: 100000,
    currentLevel: 65000,
    direction: 1,
    stopLoss: 64500,
    simLevel: 65500,
    usdJpy: 156.5,
    leverage: 15,
    contractSize: 10,
    lotStep: 0.01,
    riskLimitPct: 1,
    spreadPts: 0,
    commissionSide: 0,
    swapPerLotNight: 0,
    nights: 0,
    converterMargin: 1000,
    converterLots: 0,
    converterMode: 'margin',
    entries: [
      { id: 1, price: 65000, lots: 3.50, margin: 0 }
    ]
  };

  let state = loadState();
  let nextEntryId = Math.max(0, ...state.entries.map(e => Number(e.id) || 0)) + 1;

  const $ = id => document.getElementById(id);

  const els = {
    balance: $('balance'), currentLevel: $('currentLevel'), buyBtn: $('buyBtn'), sellBtn: $('sellBtn'),
    marginWanted: $('marginWanted'), lotsWanted: $('lotsWanted'), converterLotsOut: $('converterLotsOut'),
    marginPerLotOut: $('marginPerLotOut'), pointPerLotOut: $('pointPerLotOut'), converterExposureOut: $('converterExposureOut'),
    addConverterPosition: $('addConverterPosition'), addEntry: $('addEntry'), entries: $('entries'), totalLots: $('totalLots'),
    avgEntry: $('avgEntry'), pointTotal: $('pointTotal'), stopLoss: $('stopLoss'), riskDollar: $('riskDollar'),
    riskPct: $('riskPct'), riskMessage: $('riskMessage'), simLevel: $('simLevel'), simDirectionBadge: $('simDirectionBadge'),
    simPnl: $('simPnl'), simMove: $('simMove'), simEquity: $('simEquity'), simMargin: $('simMargin'),
    simFreeMargin: $('simFreeMargin'), simMarginLevel: $('simMarginLevel'), simExposure: $('simExposure'),
    currentPnl: $('currentPnl'), currentEquity: $('currentEquity'), currentMargin: $('currentMargin'),
    currentFreeMargin: $('currentFreeMargin'), currentMarginLevel: $('currentMarginLevel'), usdJpy: $('usdJpy'),
    leverage: $('leverage'), contractSize: $('contractSize'), lotStep: $('lotStep'), riskLimitPct: $('riskLimitPct'),
    spreadPts: $('spreadPts'), commissionSide: $('commissionSide'), swapPerLotNight: $('swapPerLotNight'),
    nights: $('nights'), spreadCost: $('spreadCost'), commissionCost: $('commissionCost'), swapCost: $('swapCost'),
    totalCosts: $('totalCosts'), resetApp: $('resetApp'), installHint: $('installHint'), dismissInstall: $('dismissInstall')
  };

  hydrateInputs();
  bindEvents();
  renderEntries();
  updateAll();
  setupInstallHint();
  registerServiceWorker();

  function num(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const cleaned = String(value ?? '')
      .replace(/\s/g, '')
      .replace(/\u202f/g, '')
      .replace(',', '.')
      .replace(/[^0-9.+-]/g, '');
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }

  function positive(value, fallback = 0) {
    const n = num(value, fallback);
    return n >= 0 ? n : fallback;
  }

  function decimalsFromStep(step) {
    const s = String(step);
    if (!s.includes('.')) return 0;
    return Math.min(6, s.split('.')[1].length);
  }

  function floorToStep(value, step) {
    const s = step > 0 ? step : 0.01;
    const d = decimalsFromStep(s);
    const factor = 10 ** d;
    const units = Math.floor((value * factor + 1e-9) / (s * factor));
    return (units * s * factor) / factor;
  }

  function fmt(n, digits = 2) {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  }

  function fmtSmart(n, maxDigits = 2) {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: maxDigits }).format(n);
  }

  function money(n, digits = 2, signed = false) {
    if (!Number.isFinite(n)) return '—';
    const sign = signed && n > 0 ? '+' : '';
    return `${sign}${fmt(n, digits)} $`;
  }

  function pct(n, digits = 2) {
    return Number.isFinite(n) ? `${fmt(n, digits)} %` : '—';
  }

  function pointValuePerLot() {
    const fx = positive(state.usdJpy);
    return fx > 0 ? positive(state.contractSize) / fx : 0;
  }

  function marginPerLot(price = state.currentLevel) {
    const fx = positive(state.usdJpy);
    const lev = positive(state.leverage);
    if (!fx || !lev) return 0;
    return positive(price) * positive(state.contractSize) / fx / lev;
  }

  function exposure(price, lots) {
    const fx = positive(state.usdJpy);
    if (!fx) return 0;
    return positive(price) * positive(state.contractSize) * positive(lots) / fx;
  }

  function totalLots() {
    return state.entries.reduce((sum, e) => sum + positive(e.lots), 0);
  }

  function avgEntry() {
    const lots = totalLots();
    if (!lots) return 0;
    const weighted = state.entries.reduce((sum, e) => sum + positive(e.price) * positive(e.lots), 0);
    return weighted / lots;
  }

  function costBreakdown(lots = totalLots()) {
    const pv = pointValuePerLot();
    const spread = positive(state.spreadPts) * pv * lots;
    const commission = positive(state.commissionSide) * lots * 2;
    const swap = positive(state.swapPerLotNight) * lots * positive(state.nights);
    return { spread, commission, swap, total: spread + commission + swap };
  }

  function pnlAt(level, includeCosts = true) {
    const lots = totalLots();
    const avg = avgEntry();
    if (!lots || !avg) return 0;
    const gross = state.direction * (positive(level) - avg) * pointValuePerLot() * lots;
    return gross - (includeCosts ? costBreakdown(lots).total : 0);
  }

  function requiredMarginAt(level) {
    return marginPerLot(level) * totalLots();
  }

  function colorize(el, value) {
    el.classList.remove('cyan-text', 'danger-text', 'amber-text');
    if (value > 0.005) el.classList.add('cyan-text');
    else if (value < -0.005) el.classList.add('danger-text');
  }

  function hydrateInputs() {
    const keys = ['balance','currentLevel','stopLoss','simLevel','usdJpy','leverage','contractSize','lotStep','riskLimitPct','spreadPts','commissionSide','swapPerLotNight','nights'];
    keys.forEach(k => { if (els[k]) els[k].value = state[k]; });
    els.marginWanted.value = state.converterMargin;
    els.lotsWanted.value = state.converterLots || 0;
    setDirectionUI();
  }

  function bindEvents() {
    bindNumberInput(els.balance, 'balance');
    bindNumberInput(els.currentLevel, 'currentLevel');
    bindNumberInput(els.stopLoss, 'stopLoss');
    bindNumberInput(els.simLevel, 'simLevel');
    bindNumberInput(els.usdJpy, 'usdJpy');
    bindNumberInput(els.leverage, 'leverage');
    bindNumberInput(els.contractSize, 'contractSize');
    bindNumberInput(els.lotStep, 'lotStep');
    bindNumberInput(els.riskLimitPct, 'riskLimitPct');
    bindNumberInput(els.spreadPts, 'spreadPts');
    bindNumberInput(els.commissionSide, 'commissionSide');
    bindNumberInput(els.swapPerLotNight, 'swapPerLotNight');
    bindNumberInput(els.nights, 'nights');

    els.buyBtn.addEventListener('click', () => setDirection(1));
    els.sellBtn.addEventListener('click', () => setDirection(-1));

    els.marginWanted.addEventListener('input', () => {
      state.converterMargin = positive(els.marginWanted.value);
      state.converterMode = 'margin';
      clearActiveMarginChip();
      updateAll();
    });
    els.lotsWanted.addEventListener('input', () => {
      state.converterLots = positive(els.lotsWanted.value);
      state.converterMode = 'lots';
      clearActiveMarginChip();
      updateAll();
    });

    document.querySelectorAll('.margin-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.margin-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.converterMargin = positive(btn.dataset.margin);
        state.converterMode = 'margin';
        els.marginWanted.value = state.converterMargin;
        updateAll();
      });
    });

    document.querySelectorAll('.sim-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = num(btn.dataset.delta);
        state.simLevel = positive(state.currentLevel) + delta;
        els.simLevel.value = state.simLevel;
        updateAll();
      });
    });

    els.addEntry.addEventListener('click', () => addEntry({ price: state.currentLevel, lots: 0 }));
    els.addConverterPosition.addEventListener('click', () => {
      const lots = getConverterLots();
      addEntry({ price: state.currentLevel, lots });
      els.addConverterPosition.textContent = '✓ Ajouté au plan';
      setTimeout(() => { els.addConverterPosition.textContent = '+ Ajouter ce lot au plan'; }, 900);
    });

    els.resetApp.addEventListener('click', () => {
      if (!confirm('Réinitialiser toutes les valeurs de la calculatrice ?')) return;
      state = JSON.parse(JSON.stringify(defaults));
      nextEntryId = 2;
      localStorage.removeItem(STORAGE_KEY);
      hydrateInputs();
      renderEntries();
      updateAll();
    });

    els.dismissInstall.addEventListener('click', () => {
      localStorage.setItem(INSTALL_HINT_KEY, '1');
      els.installHint.classList.add('hidden');
    });
  }

  function bindNumberInput(el, key) {
    el.addEventListener('input', () => {
      state[key] = positive(el.value);
      updateAll();
    });
  }

  function setDirection(dir) {
    state.direction = dir === -1 ? -1 : 1;
    setDirectionUI();
    updateAll();
  }

  function setDirectionUI() {
    els.buyBtn.classList.toggle('active', state.direction === 1);
    els.sellBtn.classList.toggle('active', state.direction === -1);
    els.simDirectionBadge.textContent = state.direction === 1 ? 'Achat' : 'Vente';
    els.simDirectionBadge.style.color = state.direction === 1 ? 'var(--cyan)' : 'var(--red)';
    els.simDirectionBadge.style.borderColor = state.direction === 1 ? 'rgba(43,213,196,.55)' : 'rgba(255,107,115,.55)';
  }

  function clearActiveMarginChip() {
    document.querySelectorAll('.margin-chip').forEach(b => b.classList.remove('active'));
  }

  function getConverterLots() {
    const step = positive(state.lotStep, 0.01) || 0.01;
    if (state.converterMode === 'lots') return floorToStep(positive(state.converterLots), step);
    const mpl = marginPerLot(state.currentLevel);
    if (!mpl) return 0;
    return floorToStep(positive(state.converterMargin) / mpl, step);
  }

  function updateConverter() {
    const mpl = marginPerLot(state.currentLevel);
    const step = positive(state.lotStep, 0.01) || 0.01;
    let lots;
    let margin;

    if (state.converterMode === 'lots') {
      lots = floorToStep(positive(state.converterLots), step);
      margin = lots * mpl;
      state.converterMargin = margin;
      els.marginWanted.value = margin ? fmt(margin, 2).replace(/\s/g, '') : '0';
    } else {
      margin = positive(state.converterMargin);
      lots = mpl > 0 ? floorToStep(margin / mpl, step) : 0;
      state.converterLots = lots;
      els.lotsWanted.value = lots ? fmtSmart(lots, 2).replace(',', '.') : '0';
    }

    els.converterLotsOut.textContent = `${fmtSmart(lots, 2)} lots`;
    els.marginPerLotOut.textContent = money(mpl, 2);
    els.pointPerLotOut.textContent = `${money(pointValuePerLot(), 4)} / pt`;
    els.converterExposureOut.textContent = money(exposure(state.currentLevel, lots), 0);
  }

  function addEntry({ price, lots }) {
    state.entries.push({ id: nextEntryId++, price: positive(price), lots: positive(lots), margin: 0 });
    renderEntries();
    updateAll();
  }

  function renderEntries() {
    els.entries.innerHTML = '';
    state.entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'entry-row';
      row.dataset.id = entry.id;

      row.innerHTML = `
        <label class="entry-field">
          <span>Entrée ${index + 1} · prix</span>
          <input class="mono entry-price" inputmode="decimal" value="${entry.price || ''}" />
        </label>
        <label class="entry-field">
          <span>Lots</span>
          <input class="mono entry-lots" inputmode="decimal" value="${entry.lots || ''}" />
        </label>
        <label class="entry-field">
          <span>$ marge</span>
          <input class="mono entry-margin" inputmode="decimal" value="${fmt(marginPerLot(entry.price || state.currentLevel) * positive(entry.lots), 2).replace(/\s/g,'').replace(',','.')}" />
        </label>
        <button class="entry-remove" aria-label="Supprimer l'entrée" ${state.entries.length === 1 ? 'disabled' : ''}>×</button>
      `;

      const priceInput = row.querySelector('.entry-price');
      const lotsInput = row.querySelector('.entry-lots');
      const marginInput = row.querySelector('.entry-margin');
      const removeBtn = row.querySelector('.entry-remove');

      priceInput.addEventListener('input', () => {
        entry.price = positive(priceInput.value);
        marginInput.value = fmt(marginPerLot(entry.price) * positive(entry.lots), 2).replace(/\s/g,'').replace(',','.');
        updateAll(false);
      });

      lotsInput.addEventListener('input', () => {
        entry.lots = positive(lotsInput.value);
        marginInput.value = fmt(marginPerLot(entry.price || state.currentLevel) * entry.lots, 2).replace(/\s/g,'').replace(',','.');
        updateAll(false);
      });

      marginInput.addEventListener('input', () => {
        const desired = positive(marginInput.value);
        const mpl = marginPerLot(entry.price || state.currentLevel);
        entry.lots = mpl ? floorToStep(desired / mpl, positive(state.lotStep, .01) || .01) : 0;
        lotsInput.value = entry.lots ? fmtSmart(entry.lots, 2).replace(',', '.') : '0';
        updateAll(false);
      });

      removeBtn.addEventListener('click', () => {
        if (state.entries.length <= 1) return;
        state.entries = state.entries.filter(e => e.id !== entry.id);
        renderEntries();
        updateAll();
      });

      els.entries.appendChild(row);
    });
  }

  function syncEntryMargins() {
    document.querySelectorAll('.entry-row').forEach(row => {
      const entry = state.entries.find(e => String(e.id) === row.dataset.id);
      if (!entry) return;
      const marginInput = row.querySelector('.entry-margin');
      if (document.activeElement !== marginInput) {
        marginInput.value = fmt(marginPerLot(entry.price || state.currentLevel) * positive(entry.lots), 2).replace(/\s/g,'').replace(',','.');
      }
    });
  }

  function updatePositionSummary() {
    const lots = totalLots();
    const avg = avgEntry();
    const pvTotal = pointValuePerLot() * lots;
    els.totalLots.textContent = fmtSmart(lots, 2);
    els.avgEntry.textContent = avg ? fmt(avg, 1) : '—';
    els.pointTotal.textContent = lots ? `${money(pvTotal, 4)} / pt` : '—';

    const stop = positive(state.stopLoss);
    const atStop = stop && lots ? pnlAt(stop, true) : 0;
    const risk = Math.max(0, -atStop);
    const riskPct = positive(state.balance) > 0 ? risk / state.balance * 100 : 0;
    els.riskDollar.textContent = lots && stop ? money(-risk, 2) : '—';
    els.riskPct.textContent = lots && stop ? `${pct(riskPct, 3)} du compte` : '—';

    const limit = positive(state.riskLimitPct);
    els.riskMessage.className = 'status-card';

    if (!lots) {
      els.riskMessage.innerHTML = '<strong>Ajoute au moins une entrée.</strong> La calculatrice fera ensuite le prix moyen, le risque et la marge.';
      return;
    }
    if (!stop) {
      els.riskMessage.innerHTML = '<strong>Stop Loss manquant.</strong> Impossible de mesurer le risque réel sans niveau de sortie.';
      els.riskMessage.classList.add('warn');
      return;
    }

    const protective = state.direction === 1 ? stop < avg : stop > avg;
    const profitableStop = state.direction === 1 ? stop > avg : stop < avg;

    if (riskPct > limit && limit > 0) {
      els.riskMessage.classList.add('danger');
      els.riskMessage.innerHTML = `<strong>Risque ${pct(riskPct, 2)}.</strong> Ton plafond perso est ${pct(limit, 2)}. Pour respecter ce plafond, réduis les lots ou rapproche le SL selon ton graphique.`;
    } else if (profitableStop) {
      els.riskMessage.classList.add('ok');
      els.riskMessage.innerHTML = `<strong>Stop en zone de profit.</strong> Au niveau saisi, le P&L net reste positif après les frais estimés.`;
    } else if (protective) {
      els.riskMessage.classList.add('ok');
      els.riskMessage.innerHTML = `<strong>Risque cadré.</strong> Perte estimée au SL : ${money(risk, 2)} (${pct(riskPct, 3)} du compte), frais estimés inclus.`;
    } else {
      els.riskMessage.classList.add('warn');
      els.riskMessage.innerHTML = '<strong>SL au prix moyen.</strong> Le risque directionnel est quasi nul, mais le spread / les frais peuvent laisser une petite perte.';
    }
  }

  function updateSimulator() {
    const lots = totalLots();
    const level = positive(state.simLevel);
    const avg = avgEntry();
    const p = lots && level ? pnlAt(level, true) : 0;
    const eq = positive(state.balance) + p;
    const margin = lots && level ? requiredMarginAt(level) : 0;
    const free = eq - margin;
    const marginLevel = margin > 0 ? eq / margin * 100 : Infinity;
    const exp = lots && level ? exposure(level, lots) : 0;

    els.simPnl.textContent = money(p, 2, true);
    colorize(els.simPnl, p);
    const move = avg ? level - avg : 0;
    els.simMove.textContent = avg ? `${move >= 0 ? '+' : ''}${fmt(move, 1)} pts depuis le prix moyen` : '—';
    els.simEquity.textContent = money(eq, 2);
    els.simMargin.textContent = money(margin, 2);
    els.simFreeMargin.textContent = money(free, 2);
    els.simMarginLevel.textContent = Number.isFinite(marginLevel) ? pct(marginLevel, 1) : '—';
    els.simExposure.textContent = money(exp, 0);
  }

  function updateCurrentPosition() {
    const lots = totalLots();
    const level = positive(state.currentLevel);
    const p = lots && level ? pnlAt(level, true) : 0;
    const eq = positive(state.balance) + p;
    const margin = lots && level ? requiredMarginAt(level) : 0;
    const free = eq - margin;
    const ml = margin > 0 ? eq / margin * 100 : Infinity;

    els.currentPnl.textContent = money(p, 2, true);
    colorize(els.currentPnl, p);
    els.currentEquity.textContent = money(eq, 2);
    els.currentMargin.textContent = money(margin, 2);
    els.currentFreeMargin.textContent = money(free, 2);
    els.currentMarginLevel.textContent = Number.isFinite(ml) ? pct(ml, 1) : '—';
  }

  function updateFees() {
    const costs = costBreakdown();
    els.spreadCost.textContent = money(costs.spread, 2);
    els.commissionCost.textContent = money(costs.commission, 2);
    els.swapCost.textContent = money(costs.swap, 2);
    els.totalCosts.textContent = money(costs.total, 2);
  }

  function updateAll(syncMargins = true) {
    updateConverter();
    if (syncMargins) syncEntryMargins();
    updatePositionSummary();
    updateSimulator();
    updateCurrentPosition();
    updateFees();
    setDirectionUI();
    saveState();
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== 'object') return JSON.parse(JSON.stringify(defaults));
      const merged = { ...defaults, ...saved };
      merged.entries = Array.isArray(saved.entries) && saved.entries.length ? saved.entries : JSON.parse(JSON.stringify(defaults.entries));
      return merged;
    } catch (_) {
      return JSON.parse(JSON.stringify(defaults));
    }
  }

  function setupInstallHint() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const dismissed = localStorage.getItem(INSTALL_HINT_KEY) === '1';
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !standalone && !dismissed) els.installHint.classList.remove('hidden');
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
})();
