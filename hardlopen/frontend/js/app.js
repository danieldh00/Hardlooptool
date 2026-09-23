// Router + alle schermen. Hash-routes (#/...) zodat de app onder elk
// basispad werkt: onder Ingress, via de tunnel en als geïnstalleerde PWA.
(() => {
  const { KINDS, PRESETS, flatten, totalDuration, formatDuration, formatSpoken, sanitizeTraining } = Workout;
  const app = document.getElementById('app');
  const READY = { label: 'Klaar voor de start', color: '#475569' };

  let online = true;
  let loginRequired = false;
  let cleanupView = null;

  // ---------- hulpjes ----------

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function kindInfo(kind) {
    return kind === 'ready' ? READY : KINDS[kind] || KINDS.run;
  }

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (el.hidden = true), 3000);
  }

  function setStatus() {
    const bar = document.getElementById('status');
    const pending = Store.trainings.dirty().length + Store.history.dirty().length;
    if (!online) {
      bar.textContent = pending ? `Offline — ${pending} wijziging(en) worden later bewaard` : 'Offline — alles werkt gewoon door';
      bar.hidden = false;
    } else if (loginRequired) {
      bar.innerHTML = 'Niet ingelogd — wijzigingen blijven op dit toestel. <a href="#/login">Inloggen</a>';
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }

  async function syncNow() {
    try {
      await Api.sync();
      online = true;
      loginRequired = false;
    } catch (err) {
      if (err instanceof Api.ApiError && err.status === 401) loginRequired = true;
      else if (!(err instanceof Api.ApiError)) online = false;
    }
    setStatus();
  }

  // Timeline-strookje: elke stap een gekleurd blokje naar rato van de duur.
  function strip(steps) {
    const total = steps.reduce((s, x) => s + x.duration, 0) || 1;
    return `<div class="strip">${steps
      .map((s) => `<span style="flex:${s.duration / total};background:${kindInfo(s.kind).color}"></span>`)
      .join('')}</div>`;
  }

  function summary(training) {
    const byKind = Workout.durationByKind(training);
    return Object.keys(KINDS)
      .filter((k) => byKind[k])
      .map((k) => `<span class="chip"><i style="background:${KINDS[k].color}"></i>${esc(KINDS[k].label)} ${formatDuration(byKind[k])}</span>`)
      .join('');
  }

  function formatDate(ms) {
    return new Date(ms).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatTime(ms) {
    return new Date(ms).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }

  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  // ---------- router ----------

  function render() {
    if (cleanupView) {
      cleanupView();
      cleanupView = null;
    }
    const [, route, id] = (location.hash || '#/').split('/');
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === (route || '')));
    document.body.classList.toggle('running', route === 'run');
    window.scrollTo(0, 0);
    if (loginRequired && route !== 'run' && Store.trainings.all().length === 0 && route !== 'settings') return renderLogin();
    switch (route) {
      case 'edit':
        return renderEditor(id);
      case 'run':
        return renderRun(id);
      case 'history':
        return renderHistory();
      case 'settings':
        return renderSettings();
      case 'login':
        return renderLogin();
      default:
        return renderHome();
    }
  }

  // ---------- overzicht ----------

  function renderHome() {
    const trainings = Store.trainings.all().sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    const active = Store.activeRun();
    app.innerHTML = `
      ${active && !active.finished ? `
        <a class="resume card" href="#/run/active">
          <strong>▶ Training bezig: ${esc(active.name)}</strong>
          <span>Tik om verder te gaan</span>
        </a>` : ''}
      <section>
        <div class="section-head">
          <h2>Mijn trainingen</h2>
          <a class="btn primary small" href="#/edit/new">+ Nieuw</a>
        </div>
        ${trainings.length === 0 ? '<p class="muted">Nog geen eigen trainingen. Maak er een of begin met een voorbeeld hieronder.</p>' : ''}
        ${trainings.map((t) => trainingCard(t, false)).join('')}
      </section>
      <section>
        <h2>Voorbeelden</h2>
        ${PRESETS.map((p) => trainingCard(p, true)).join('')}
      </section>`;

    app.onclick = (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      const preset = PRESETS.find((p) => p.presetId === btn.dataset.copy);
      const { presetId, ...rest } = preset; // eslint-disable-line no-unused-vars
      const saved = Store.trainings.put(JSON.parse(JSON.stringify(rest)));
      syncNow();
      navigate(`#/edit/${saved.id}`);
    };
  }

  function trainingCard(t, isPreset) {
    const steps = flatten(t);
    const id = isPreset ? `preset:${t.presetId}` : t.id;
    return `
      <article class="card training">
        <div class="training-head">
          <h3>${esc(t.name)}</h3>
          <span class="total">${formatDuration(totalDuration(t))}</span>
        </div>
        ${strip(steps)}
        <div class="chips">${summary(t)}</div>
        ${t.notes ? `<p class="notes">${esc(t.notes)}</p>` : ''}
        <div class="actions">
          <a class="btn primary" href="#/run/${encodeURIComponent(id)}">▶ Start</a>
          ${isPreset
            ? `<button class="btn" data-copy="${esc(t.presetId)}">Kopiëren en aanpassen</button>`
            : `<a class="btn" href="#/edit/${esc(t.id)}">Bewerken</a>`}
        </div>
      </article>`;
  }

  // ---------- editor ----------

  function blankStep(kind = 'run', duration = 60) {
    return { type: 'step', kind, duration };
  }

  function renderEditor(id) {
    const existing = id && id !== 'new' ? Store.trainings.get(id) : null;
    if (id && id !== 'new' && !existing) {
      app.innerHTML = '<p class="muted">Deze training bestaat niet (meer).</p><a class="btn" href="#/">Terug</a>';
      return;
    }
    const draft = existing
      ? JSON.parse(JSON.stringify({ id: existing.id, name: existing.name, notes: existing.notes || '', items: existing.items }))
      : { name: '', notes: '', items: [blankStep('warmup', 300), { type: 'repeat', times: 5, steps: [blankStep('run', 60), blankStep('walk', 90)] }, blankStep('cooldown', 300)] };

    const kindOptions = (selected) =>
      Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(v.label)}</option>`).join('');

    function stepRow(step, path, canUp, canDown) {
      const m = Math.floor(step.duration / 60);
      const s = step.duration % 60;
      return `
        <div class="step" data-path="${path}" style="--kind:${KINDS[step.kind].color}">
          <div class="step-main">
            <select data-field="kind" aria-label="Soort">${kindOptions(step.kind)}</select>
            <div class="duration">
              <input data-field="min" type="number" inputmode="numeric" min="0" max="240" value="${m}" aria-label="Minuten"><span>min</span>
              <input data-field="sec" type="number" inputmode="numeric" min="0" max="59" value="${s}" aria-label="Seconden"><span>s</span>
            </div>
          </div>
          <div class="step-extra">
            <input data-field="label" type="text" maxlength="40" placeholder="Eigen omschrijving (optioneel)" value="${esc(step.label || '')}">
            <div class="row-actions">
              <button data-act="up" ${canUp ? '' : 'disabled'} aria-label="Omhoog">↑</button>
              <button data-act="down" ${canDown ? '' : 'disabled'} aria-label="Omlaag">↓</button>
              <button data-act="dup" aria-label="Dupliceren">⧉</button>
              <button data-act="del" aria-label="Verwijderen">✕</button>
            </div>
          </div>
        </div>`;
    }

    function draw() {
      let valid = true;
      let total = 0;
      try {
        total = totalDuration(draft);
      } catch {
        valid = false;
      }
      const items = draft.items
        .map((item, i) => {
          const up = i > 0;
          const down = i < draft.items.length - 1;
          if (item.type !== 'repeat') return stepRow(item, String(i), up, down);
          return `
            <div class="repeat" data-path="${i}">
              <div class="repeat-head">
                <label>Herhaal <input data-field="times" type="number" inputmode="numeric" min="1" max="99" value="${item.times}"> ×</label>
                <div class="row-actions">
                  <button data-act="up" ${up ? '' : 'disabled'} aria-label="Blok omhoog">↑</button>
                  <button data-act="down" ${down ? '' : 'disabled'} aria-label="Blok omlaag">↓</button>
                  <button data-act="dup" aria-label="Blok dupliceren">⧉</button>
                  <button data-act="del" aria-label="Blok verwijderen">✕</button>
                </div>
              </div>
              ${item.steps.map((s, j) => stepRow(s, `${i}.${j}`, j > 0, j < item.steps.length - 1)).join('')}
              <button class="btn small ghost" data-act="add-inner">+ Stap in dit blok</button>
            </div>`;
        })
        .join('');

      app.innerHTML = `
        <form class="editor" novalidate>
          <input class="name" data-field="name" type="text" maxlength="80" placeholder="Naam van de training" value="${esc(draft.name)}" required>
          <textarea data-field="notes" rows="2" maxlength="1000" placeholder="Notities (optioneel)">${esc(draft.notes)}</textarea>
          <div class="total-line"><span>Totaal</span><strong>${valid ? formatDuration(total) : '–'}</strong></div>
          ${valid && draft.items.length ? strip(flatten(draft)) : ''}
          <div class="items">${items}</div>
          <div class="add-row">
            <button class="btn" data-act="add-step" type="button">+ Stap</button>
            <button class="btn" data-act="add-repeat" type="button">+ Herhaalblok</button>
          </div>
          <div class="save-row">
            <button class="btn primary" type="submit">Opslaan</button>
            <a class="btn" href="#/">Annuleren</a>
            ${existing ? '<button class="btn danger" data-act="delete-training" type="button">Verwijderen</button>' : ''}
          </div>
        </form>`;
    }

    function target(path) {
      const [i, j] = path.split('.').map(Number);
      return j == null ? { list: draft.items, index: i } : { list: draft.items[i].steps, index: j };
    }

    function readStep(stepEl) {
      const { list, index } = target(stepEl.dataset.path);
      const step = list[index];
      const min = Math.max(0, Number(stepEl.querySelector('[data-field=min]').value) || 0);
      const sec = Math.max(0, Math.min(59, Number(stepEl.querySelector('[data-field=sec]').value) || 0));
      step.kind = stepEl.querySelector('[data-field=kind]').value;
      step.duration = min * 60 + sec;
      const label = stepEl.querySelector('[data-field=label]').value.trim();
      if (label) step.label = label;
      else delete step.label;
    }

    app.oninput = app.onchange = (e) => {
      const field = e.target.dataset.field;
      if (!field) return;
      if (field === 'name') draft.name = e.target.value;
      else if (field === 'notes') draft.notes = e.target.value;
      else if (field === 'times') {
        const rep = e.target.closest('.repeat');
        draft.items[Number(rep.dataset.path)].times = Math.max(1, Math.min(99, Number(e.target.value) || 1));
      } else readStep(e.target.closest('.step'));
      // Alleen bij 'change' hertekenen (anders verspringt de cursor tijdens typen).
      if (e.type === 'change') {
        const scroll = window.scrollY;
        draw();
        window.scrollTo(0, scroll);
      } else {
        const totalEl = app.querySelector('.total-line strong');
        try {
          totalEl.textContent = formatDuration(totalDuration(draft));
        } catch {
          /* tijdelijk ongeldig tijdens typen */
        }
      }
    };

    app.onclick = (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      e.preventDefault();
      const act = btn.dataset.act;
      const holder = btn.closest('[data-path]');
      if (act === 'add-step') draft.items.push(blankStep());
      else if (act === 'add-repeat') draft.items.push({ type: 'repeat', times: 4, steps: [blankStep('run', 60), blankStep('walk', 60)] });
      else if (act === 'add-inner') draft.items[Number(holder.dataset.path)].steps.push(blankStep('walk', 60));
      else if (act === 'delete-training') {
        if (!confirm(`Training "${draft.name}" verwijderen?`)) return;
        Store.trainings.remove(existing.id);
        syncNow();
        return navigate('#/');
      } else if (holder) {
        const { list, index } = target(holder.dataset.path);
        if (act === 'del') {
          list.splice(index, 1);
          // Een leeg herhaalblok heeft geen zin: dan het hele blok weg.
          const [i, j] = holder.dataset.path.split('.').map(Number);
          if (j != null && draft.items[i].steps.length === 0) draft.items.splice(i, 1);
        } else if (act === 'dup') list.splice(index + 1, 0, JSON.parse(JSON.stringify(list[index])));
        else if (act === 'up' && index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
        else if (act === 'down' && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
      }
      const scroll = window.scrollY;
      draw();
      window.scrollTo(0, scroll);
    };

    app.onsubmit = (e) => {
      e.preventDefault();
      let clean;
      try {
        clean = sanitizeTraining(draft);
      } catch (err) {
        return toast(err.message);
      }
      Store.trainings.put({ ...clean, id: draft.id });
      syncNow();
      toast('Opgeslagen');
      navigate('#/');
    };

    draw();
  }

  // ---------- lopen ----------

  function resolveTraining(id) {
    if (!id) return null;
    const decoded = decodeURIComponent(id);
    if (decoded.startsWith('preset:')) {
      const p = PRESETS.find((x) => x.presetId === decoded.slice(7));
      return p ? { id: null, ...p } : null;
    }
    return Store.trainings.get(decoded);
  }

  function renderRun(id) {
    let state = Store.activeRun();
    const settings = Store.settings();

    if (id !== 'active' || !state) {
      const training = resolveTraining(id);
      if (!training) {
        app.innerHTML = '<p class="muted">Training niet gevonden.</p><a class="btn" href="#/">Terug</a>';
        return;
      }
      if (state && !state.finished && !confirm(`Er loopt nog een training (${state.name}). Die stoppen en deze starten?`)) {
        return navigate('#/run/active');
      }
      state = null;
      app.innerHTML = `
        <div class="prestart">
          <h2>${esc(training.name)}</h2>
          <p class="big-total">${formatDuration(totalDuration(training))}</p>
          ${strip(flatten(training))}
          <div class="chips">${summary(training)}</div>
          <button class="btn primary huge" data-act="go">▶ Start</button>
          <p class="muted small">Tip: zet het volume omhoog. ${settings.audioMode === 'background'
            ? 'De piepjes gaan door met het scherm uit; muziek van een andere app wordt op iPhone daarbij gepauzeerd.'
            : 'Houd het scherm aan (de app voorkomt vergrendelen waar dat kan); de piepjes spelen over je muziek heen.'}</p>
          <a class="btn" href="#/">Terug</a>
        </div>`;
      app.onclick = (e) => {
        if (!e.target.closest('[data-act=go]')) return;
        Cues.unlock(settings);
        const steps = flatten(training);
        if (settings.leadIn > 0) steps.unshift({ kind: 'ready', label: READY.label, duration: settings.leadIn });
        Store.saveActiveRun(Runner.create({ steps, trainingId: training.id, name: training.name }));
        navigate('#/run/active');
      };
      return;
    }

    // Actieve training
    let lastIndex = -1;
    let lastSecond = -1;
    let wakeLock = null;
    let finishedHandled = state.finished;

    app.innerHTML = `
      <div class="runner">
        <div class="run-top">
          <span class="run-name">${esc(state.name)}</span>
          <span class="run-count"></span>
        </div>
        <div class="now">
          <div class="now-label"></div>
          <div class="now-rep"></div>
          <div class="now-time"></div>
          <div class="step-progress"><span></span></div>
        </div>
        <div class="next"></div>
        <div class="total-progress"><span></span></div>
        <div class="run-times"><span class="t-elapsed"></span><span class="t-remaining"></span></div>
        <div class="controls">
          <button data-act="prev" aria-label="Vorige stap">⏮</button>
          <button data-act="toggle" class="toggle" aria-label="Pauze/verder"></button>
          <button data-act="skip" aria-label="Volgende stap">⏭</button>
        </div>
        <button class="btn danger stop" data-act="stop">■ Stoppen</button>
        <p class="unlock-hint" hidden>Tik op ▶ om het geluid weer aan te zetten</p>
      </div>`;

    const $ = (sel) => app.querySelector(sel);
    const els = {
      now: $('.now'), label: $('.now-label'), rep: $('.now-rep'), time: $('.now-time'), stepBar: $('.step-progress span'),
      next: $('.next'), totalBar: $('.total-progress span'), elapsed: $('.t-elapsed'), remaining: $('.t-remaining'),
      count: $('.run-count'), toggle: $('.toggle'),
    };
    const realSteps = state.steps.filter((s) => s.kind !== 'ready').length;

    function persist(next) {
      state = next;
      Store.saveActiveRun(state);
      Cues.schedule(Runner.cues(state));
      updateMediaSession();
      tick(true);
    }

    function announce(pos) {
      const s = pos.step;
      if (!s) return;
      if (s.kind === 'ready') return Cues.speak(`Klaar voor de start. ${state.name}.`);
      const rep = s.rep ? `, ronde ${s.rep} van ${s.reps}` : '';
      // Alleen de resterende tijd noemen als we niet precies aan het begin zitten.
      const secs = Math.round(pos.stepRemainingMs / 1000);
      Cues.speak(`${s.label}, ${formatSpoken(secs)}${rep}`);
    }

    function tick(force) {
      const pos = Runner.position(state);
      if (pos.index >= state.steps.length) return finish(true);
      const s = pos.step;
      const info = kindInfo(s.kind);
      const sec = Math.ceil(pos.stepRemainingMs / 1000);
      if (pos.index !== lastIndex) {
        if (lastIndex !== -1 && Runner.isRunning(state)) {
          announce(pos);
          Cues.vibrate([300, 100, 300]);
        } else if (lastIndex === -1 && Runner.isRunning(state) && pos.stepElapsedMs < 1500) {
          announce(pos);
        }
        lastIndex = pos.index;
        els.now.style.setProperty('--kind', info.color);
        document.querySelector('meta[name=theme-color]').setAttribute('content', info.color);
        els.label.textContent = s.label;
        els.rep.textContent = s.rep ? `Ronde ${s.rep} van ${s.reps}` : '';
        const next = state.steps[pos.index + 1];
        els.next.innerHTML = next
          ? `Straks: <i style="background:${kindInfo(next.kind).color}"></i><strong>${esc(next.label)}</strong> ${formatDuration(next.duration)}`
          : 'Laatste stap!';
        const realIndex = state.steps.slice(0, pos.index + 1).filter((x) => x.kind !== 'ready').length;
        els.count.textContent = s.kind === 'ready' ? '' : `Stap ${realIndex}/${realSteps}`;
        updateMediaSession();
      }
      if (sec !== lastSecond || force) {
        lastSecond = sec;
        els.time.textContent = formatDuration(sec);
        const total = Runner.totalMs(state);
        els.elapsed.textContent = `${formatDuration(pos.elapsedMs / 1000)} gelopen`;
        els.remaining.textContent = `nog ${formatDuration((total - pos.elapsedMs) / 1000)}`;
        els.totalBar.style.width = `${(pos.elapsedMs / total) * 100}%`;
        els.stepBar.style.width = `${(pos.stepElapsedMs / (s.duration * 1000)) * 100}%`;
        const running = Runner.isRunning(state);
        els.toggle.textContent = running ? '⏸' : '▶';
        els.now.classList.toggle('paused', !running);
      }
    }

    function finish(completed) {
      if (finishedHandled) return;
      finishedHandled = true;
      const final = Runner.pause(state);
      // De aanloop ('Klaar voor de start') telt niet mee als looptijd.
      const raw = Math.round(Runner.elapsedMs(final) / 1000);
      const lead = state.steps[0].kind === 'ready' ? state.steps[0].duration : 0;
      const elapsed = Math.max(0, raw - lead);
      const planned = state.steps.filter((s) => s.kind !== 'ready').reduce((sum, s) => sum + s.duration, 0);
      if (elapsed >= 30) {
        Store.history.put({ trainingId: state.trainingId, name: state.name, startedAt: state.startedAt, elapsed, planned, completed });
        syncNow();
      }
      Store.saveActiveRun(null);
      stopLoop();
      if (completed) {
        Cues.speak(`Training voltooid. Goed gedaan!`);
        Cues.vibrate([500, 200, 500, 200, 800]);
      }
      setTimeout(() => Cues.release(), completed ? 4000 : 0);
      app.innerHTML = `
        <div class="done">
          <div class="done-icon">${completed ? '🏁' : '■'}</div>
          <h2>${completed ? 'Training voltooid!' : 'Training gestopt'}</h2>
          <p class="big-total">${formatDuration(elapsed)}</p>
          <p class="muted">${esc(state.name)}${completed ? '' : ` — ${Math.round((elapsed / planned) * 100)}% van het schema`}</p>
          ${elapsed < 30 ? '<p class="muted small">Korter dan 30 seconden: niet in de geschiedenis gezet.</p>' : ''}
          <a class="btn primary" href="#/">Naar overzicht</a>
          <a class="btn" href="#/history">Geschiedenis</a>
        </div>`;
      document.querySelector('meta[name=theme-color]').setAttribute('content', '#0f172a');
    }

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => (wakeLock = null));
        }
      } catch {
        wakeLock = null;
      }
    }

    function updateMediaSession() {
      if (!('mediaSession' in navigator)) return;
      const pos = Runner.position(state);
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: pos.step ? `${pos.step.label}${pos.step.rep ? ` (${pos.step.rep}/${pos.step.reps})` : ''}` : 'Klaar',
          artist: state.name,
          album: 'Hardlopen',
        });
        navigator.mediaSession.playbackState = Runner.isRunning(state) ? 'playing' : 'paused';
      } catch {
        /* niet ondersteund */
      }
    }

    function setupMediaSession() {
      if (!('mediaSession' in navigator)) return;
      const handlers = {
        play: () => persist(Runner.resume(state)),
        pause: () => persist(Runner.pause(state)),
        nexttrack: () => persist(Runner.skip(state)),
        previoustrack: () => persist(Runner.previous(state)),
      };
      for (const [action, fn] of Object.entries(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action, fn);
        } catch {
          /* actie niet ondersteund */
        }
      }
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      // Terug uit de achtergrond: klok opnieuw uitlijnen en alles herplannen.
      Cues.resumeIfNeeded();
      Cues.schedule(Runner.cues(state));
      requestWakeLock();
      tick(true);
    }

    app.onclick = (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      // Elke tik is een kans om audio (opnieuw) te ontgrendelen, bijv. na
      // het herladen van de pagina midden in een training.
      Cues.unlock(Store.settings());
      app.querySelector('.unlock-hint').hidden = true;
      if (act === 'toggle') persist(Runner.isRunning(state) ? Runner.pause(state) : Runner.resume(state));
      else if (act === 'skip') persist(Runner.skip(state));
      else if (act === 'prev') persist(Runner.previous(state));
      else if (act === 'stop') {
        if (confirm('Training stoppen?')) finish(false);
      }
    };

    const interval = setInterval(() => tick(false), 250);
    function stopLoop() {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
      Cues.cancelAll();
    }
    cleanupView = () => {
      stopLoop();
      document.querySelector('meta[name=theme-color]').setAttribute('content', '#0f172a');
    };
    document.addEventListener('visibilitychange', onVisible);

    setupMediaSession();
    requestWakeLock();
    // Na een herlaad staat de audio nog niet ontgrendeld: dan is een tik nodig.
    Cues.resumeIfNeeded();
    Cues.schedule(Runner.cues(state));
    if (Runner.isRunning(state) && Runner.elapsedMs(state) > 2000) app.querySelector('.unlock-hint').hidden = false;
    tick(true);
  }

  // ---------- geschiedenis ----------

  function renderHistory() {
    const items = Store.history.all().sort((a, b) => b.startedAt - a.startedAt);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const thisWeek = items.filter((h) => h.startedAt >= weekAgo);
    const weekTime = thisWeek.reduce((s, h) => s + h.elapsed, 0);
    app.innerHTML = `
      <section>
        <h2>Geschiedenis</h2>
        <div class="stats">
          <div><strong>${thisWeek.length}</strong><span>trainingen afgelopen 7 dagen</span></div>
          <div><strong>${formatDuration(weekTime)}</strong><span>getraind afgelopen 7 dagen</span></div>
          <div><strong>${items.length}</strong><span>trainingen totaal</span></div>
        </div>
        ${items.length === 0 ? '<p class="muted">Nog geen trainingen gelopen.</p>' : ''}
        <ul class="history">
          ${items.map((h) => `
            <li>
              <div>
                <strong>${h.completed ? '✅' : '⏹'} ${esc(h.name)}</strong>
                <span class="muted">${formatDate(h.startedAt)}, ${formatTime(h.startedAt)}</span>
              </div>
              <div class="h-right">
                <span>${formatDuration(h.elapsed)}${h.completed ? '' : ` / ${formatDuration(h.planned)}`}</span>
                <button class="icon" data-del="${esc(h.id)}" aria-label="Verwijderen">✕</button>
              </div>
            </li>`).join('')}
        </ul>
      </section>`;
    app.onclick = (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn || !confirm('Deze training uit de geschiedenis verwijderen?')) return;
      Store.history.remove(btn.dataset.del);
      syncNow();
      renderHistory();
    };
  }

  // ---------- instellingen ----------

  function renderSettings() {
    const s = Store.settings();
    const voices = Cues.voices();
    const check = (key, label, hint) => `
      <label class="toggle-row"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}>
        <span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    app.innerHTML = `
      <section class="settings">
        <h2>Instellingen</h2>
        <p class="muted small">Deze instellingen gelden voor dit toestel.</p>
        <h3>Signalen</h3>
        ${check('beeps', 'Piepjes bij elke nieuwe stap')}
        ${check('countdown', 'Aftellen (3-2-1) voor elke wissel')}
        ${check('halfway', 'Dubbel piepje halverwege een stap', 'Alleen bij stappen van een minuut of langer')}
        ${check('speech', 'Gesproken aankondiging', 'Bijv. "Wandelen, 1 minuut en 30 seconden, ronde 3 van 8"')}
        ${check('vibrate', 'Trillen', 'Werkt op Android; iPhone ondersteunt dit niet in de browser')}
        <label class="field">Stem
          <select data-key="voiceURI">
            <option value="">Standaard Nederlandse stem</option>
            ${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
          </select>
        </label>
        <label class="field">Volume signalen
          <input type="range" min="0.1" max="1" step="0.1" data-key="volume" value="${s.volume}">
        </label>
        <label class="field">Aftellen voor de start
          <select data-key="leadIn">
            ${[0, 3, 5, 10, 15].map((n) => `<option value="${n}" ${n === Number(s.leadIn) ? 'selected' : ''}>${n ? `${n} seconden` : 'Direct beginnen'}</option>`).join('')}
          </select>
        </label>
        <h3>Scherm uit / muziek</h3>
        <label class="radio-row"><input type="radio" name="audioMode" value="background" ${s.audioMode === 'background' ? 'checked' : ''}>
          <span>Blijft werken met scherm uit<small>Aanbevolen. Op iPhone pauzeert dit wel muziek uit een andere app.</small></span></label>
        <label class="radio-row"><input type="radio" name="audioMode" value="mix" ${s.audioMode === 'mix' ? 'checked' : ''}>
          <span>Over mijn muziek heen<small>Scherm moet aan blijven; de app houdt het scherm wakker waar de browser dat toestaat.</small></span></label>
        <button class="btn" data-act="test">🔊 Geluid testen</button>
        <h3>Account</h3>
        <p class="muted small">${loginRequired ? 'Niet ingelogd.' : online ? 'Verbonden met Home Assistant.' : 'Offline.'}
          ${Store.lastSync() ? `Laatst gesynchroniseerd: ${formatDate(Store.lastSync())} ${formatTime(Store.lastSync())}.` : ''}</p>
        <div class="actions">
          <button class="btn" data-act="sync">Nu synchroniseren</button>
          ${loginRequired ? '<a class="btn primary" href="#/login">Inloggen</a>' : '<button class="btn" data-act="logout">Uitloggen</button>'}
        </div>
        <p class="muted small version"></p>
      </section>`;

    if (window.speechSynthesis && voices.length === 0) {
      // Stemmen laden asynchroon (vooral in Chrome).
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        if (location.hash.startsWith('#/settings')) renderSettings();
      };
    }

    app.onchange = (e) => {
      const el = e.target;
      if (el.name === 'audioMode') return Store.saveSettings({ audioMode: el.value });
      const key = el.dataset.key;
      if (!key) return;
      const value = el.type === 'checkbox' ? el.checked : key === 'leadIn' || key === 'volume' ? Number(el.value) : el.value;
      Store.saveSettings({ [key]: value });
    };
    app.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'test') Cues.test(Store.settings());
      else if (act === 'sync') {
        await syncNow();
        toast(online && !loginRequired ? 'Gesynchroniseerd' : 'Synchroniseren lukte niet');
        renderSettings();
      } else if (act === 'logout') {
        if (!confirm('Uitloggen op dit toestel? Je trainingen blijven hier bewaard.')) return;
        try {
          await Api.logout();
        } catch {
          /* offline: cookie blijft, niets aan te doen */
        }
        loginRequired = true;
        renderSettings();
      }
    };
    Api.status()
      .then((st) => {
        const v = app.querySelector('.version');
        if (v) v.textContent = `Versie ${st.version}`;
      })
      .catch(() => {});
  }

  // ---------- inloggen ----------

  function renderLogin() {
    app.innerHTML = `
      <form class="login card">
        <h2>Inloggen</h2>
        <p class="muted">Vul de toegangscode in die in de add-on-configuratie in Home Assistant staat. Dit toestel onthoudt de inlog een jaar.</p>
        <input type="password" name="code" autocomplete="current-password" placeholder="Toegangscode" required>
        <button class="btn primary" type="submit">Inloggen</button>
        <p class="error" hidden></p>
      </form>`;
    app.onsubmit = async (e) => {
      e.preventDefault();
      const err = app.querySelector('.error');
      try {
        await Api.login(app.querySelector('[name=code]').value);
        loginRequired = false;
        await syncNow();
        navigate('#/');
      } catch (ex) {
        err.textContent = ex instanceof Api.ApiError ? ex.message : 'Geen verbinding met de server.';
        err.hidden = false;
      }
    };
  }

  // ---------- opstarten ----------

  async function boot() {
    // Service worker alleen buiten Ingress: daar wisselt het pad per sessie,
    // dus een installatie zou daar nooit bruikbaar zijn.
    if ('serviceWorker' in navigator && !location.pathname.includes('/hassio_ingress/')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.addEventListener('hashchange', render);
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !location.hash.startsWith('#/run')) syncNow();
    });

    try {
      const status = await Api.status();
      loginRequired = !status.authenticated;
      if (!status.authenticated && !status.configured) {
        document.getElementById('status').textContent = 'Geen toegangscode ingesteld: open de app via het Home Assistant-zijpaneel of stel access_code in.';
        document.getElementById('status').hidden = false;
      }
    } catch {
      online = false;
    }
    if (online && !loginRequired) await syncNow();
    setStatus();
    // Een lopende training heeft voorrang (bijv. na herladen van de pagina).
    const active = Store.activeRun();
    if (active && !active.finished && !location.hash.startsWith('#/run')) location.hash = '#/run/active';
    else render();
    setInterval(() => {
      if (!location.hash.startsWith('#/run') && document.visibilityState === 'visible') syncNow();
    }, 60 * 1000);
  }

  boot();
})();
