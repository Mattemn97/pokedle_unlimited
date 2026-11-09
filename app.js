/* 
  Pokedle Offline — tutto in locale dopo la prima attivazione.
  Ora usa lo stadio evolutivo invece della natura.
*/

const STORAGE_KEY = 'pokemonDataV1';
let DATASET = [];
let SECRET = null;
let GUESSES = [];
let DOWNLOADING = false;

// logger condiviso (mf-log.js); se manca, i log vengono ignorati
const noop = () => {};
const log = window.MFLog || { debug: noop, info: noop, warn: noop, error: noop, time: () => noop };

// Lista stadi evolutivi (da singolo a finale)
const EVOLUTION_STAGES = [
  'Singolo',     // Pokémon senza evoluzioni
  'Base',        // Prima evoluzione
  'Intermedio',  // Evoluzione intermedia
  'Finale'       // Ultima evoluzione
];

// Mappa generation name -> numero
function generationNumber(apiName) {
  const map = {
    'generation-i': 1, 'generation-ii': 2, 'generation-iii': 3, 'generation-iv': 4,
    'generation-v': 5, 'generation-vi': 6, 'generation-vii': 7, 'generation-viii': 8,
    'generation-ix': 9
  };
  return map[apiName] || null;
}

// Hash semplice per determinare lo stadio evolutivo (coerente)
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
function evolutionStageFor(name) {
  return EVOLUTION_STAGES[simpleHash(name) % EVOLUTION_STAGES.length];
}

// Utility UI
const $ = sel => document.querySelector(sel);
function setStatus(text) { $('#status').textContent = text; }
function setCount(n) { $('#count').textContent = String(n); }
function toast(msg, ok=true) {
  const el = $('#result');
  el.className = 'mf-alert ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
}
function setProgress(done, total) {
  $('#progressBar').style.width = total ? Math.round(done / total * 100) + '%' : '0';
}
function setAttempts() { $('#attempts').textContent = String(GUESSES.length); }

// Generazioni: un clic imposta l'intervallo da scaricare
const GENERATIONS = [
  ['I', 'Kanto', 1, 151], ['II', 'Johto', 152, 251], ['III', 'Hoenn', 252, 386], ['IV', 'Sinnoh', 387, 493],
  ['V', 'Unima', 494, 649], ['VI', 'Kalos', 650, 721], ['VII', 'Alola', 722, 809], ['VIII', 'Galar', 810, 905],
  ['IX', 'Paldea', 906, 1025]
];
function buildGenerations() {
  const box = $('#gens');
  box.innerHTML = GENERATIONS.map(([n, r, a, b]) =>
    `<button type="button" class="mf-chip" data-range="${a}-${b}" title="${r} · ${a}-${b}">Gen ${n} · ${r}</button>`).join('') +
    `<button type="button" class="mf-chip" data-range="1-1025" title="Tutti i Pokémon (lento)">Tutte</button>`;
  box.addEventListener('click', e => {
    const c = e.target.closest('[data-range]');
    if (!c) return;
    $('#downloadCount').value = c.dataset.range;
    box.querySelectorAll('.mf-chip').forEach(x => x.classList.toggle('active', x === c));
  });
}

function showWin(p) {
  const card = $('#winCard');
  const name = p.italianName || p.name;
  card.innerHTML = `<img alt="${name}" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png" onerror="this.remove()">
    <div><h3>🎉 Era ${name}!</h3><p>Indovinato in ${GUESSES.length} ${GUESSES.length === 1 ? 'tentativo' : 'tentativi'}. Premi «Nuova partita» per rigiocare.</p></div>`;
  card.classList.remove('hidden');
}

// Carica dataset da localStorage
function loadDatasetFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { log.info('dati', 'Nessun dataset salvato nel browser'); return []; }
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) { log.warn('dati', 'Dataset salvato in formato non valido, lo ignoro'); return []; }
    log.info('dati', 'Dataset letto dal browser: ' + data.length + ' Pokémon (' + Math.round(raw.length / 1024) + ' KB)');
    return data;
  } catch (e) {
    log.error('dati', 'Errore lettura dal localStorage: ' + e.message, e.stack);
    return [];
  }
}

// Salva dataset (può fallire se il browser ha lo spazio pieno o in navigazione privata)
function saveDataset(data) {
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(STORAGE_KEY, json);
    log.info('dati', 'Dataset salvato: ' + data.length + ' Pokémon (' + Math.round(json.length / 1024) + ' KB)');
    return true;
  } catch (e) {
    log.error('dati', 'Salvataggio nel localStorage fallito (' + e.name + '): i dati restano solo finché la pagina è aperta', e.message);
    toast('Non riesco a salvare i dati nel browser (spazio pieno?). Usa «Esporta» per non perderli.', false);
    return false;
  }
}

// Costruisci datalist dei nomi
function buildNameList() {
  const dl = $('#pokemonList');
  dl.innerHTML = '';
  DATASET.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.italianName || p.name;
    dl.appendChild(opt);
  });
}

// Scegli segreto
function newSecret() {
  if (!DATASET.length) { log.warn('gioco', 'Nuova partita richiesta ma il dataset è vuoto'); return; }
  SECRET = DATASET[(Math.random() * DATASET.length) | 0];
  // il nome del segreto si vede solo con il debug attivo, per non rovinare il gioco
  log.info('gioco', 'Nuova partita su ' + DATASET.length + ' Pokémon');
  log.debug('gioco', 'Segreto: #' + SECRET.id + ' ' + (SECRET.italianName || SECRET.name));
  GUESSES = [];
  setAttempts();
  $('#winCard').classList.add('hidden');
  $('#guessesBody').innerHTML = '';
  $('#secretHint').textContent = `Ho scelto un Pokémon fra ${DATASET.length} disponibili.`;
  $('#btnNew').disabled = false;
}

// Confronto altezze/pesi con frecce
function compareNumber(guess, target) {
  if (Math.abs(guess - target) < 1e-6) return 'eq';
  return guess < target ? 'up' : 'down'; // up = serve più alto/pesante
}

// Aggiunge una riga nella tabella
function pushGuessRow(p) {
  const tr = document.createElement('tr');
  const labels = ['#', 'Nome', 'Gen', 'Tipo 1', 'Tipo 2', 'Stadio', 'Colore', 'Altezza (m)', 'Peso (kg)'];
  function td(val, cls='') {
    const el = document.createElement('td');
    el.textContent = val;
    el.dataset.label = labels[tr.children.length];
    if (cls) el.className = cls;
    tr.appendChild(el);
  }

  const s = SECRET;

  const genCls = p.generation === s.generation ? 'ok' : 'ko';
  const t1Cls  = p.type1 === s.type1 ? 'ok' : 'ko';
  const t2Cls  = (p.type2 || '-') === (s.type2 || '-') ? 'ok' : 'ko';
  const evoCls = p.evolutionStage === s.evolutionStage ? 'ok' : 'ko';
  const colCls = p.color === s.color ? 'ok' : 'ko';

  const hCmp = compareNumber(p.height_m, s.height_m);
  const wCmp = compareNumber(p.weight_kg, s.weight_kg);

  td(String(GUESSES.length));
  td(p.italianName || p.name);
  td(p.generation, genCls);
  td(p.type1, t1Cls);
  td(p.type2 || '-', t2Cls);
  td(p.evolutionStage, evoCls);
  td(p.color, colCls);
  td(p.height_m.toFixed(2) + (hCmp==='eq' ? ' ✓' : hCmp==='up' ? ' ↑' : ' ↓'), hCmp==='eq' ? 'ok' : 'hint');
  td(p.weight_kg.toFixed(1) + (wCmp==='eq' ? ' ✓' : wCmp==='up' ? ' ↑' : ' ↓'), wCmp==='eq' ? 'ok' : 'hint');

  $('#guessesBody').prepend(tr);
}

// Gestione tentativo
function doGuess() {
  if (!SECRET) {
    // prima causa del "non succede niente": partita mai iniziata
    log.warn('gioco', 'Tentativo ignorato: nessuna partita in corso');
    toast(DATASET.length ? 'Premi «Nuova partita» per iniziare.' : 'Prima scarica o importa i dati dei Pokémon.', false);
    return;
  }
  const name = $('#guessInput').value.trim().toLowerCase();
  if (!name) return;

  const found = DATASET.find(p => (p.italianName || p.name).toLowerCase() === name);
  if (!found) {
    log.debug('gioco', 'Nome non trovato nel dataset: "' + name + '"');
    toast('Pokémon non trovato nel dataset. Controlla l’ortografia.', false);
    return;
  }
  if (GUESSES.some(g => g.id === found.id)) {
    toast('Hai già provato questo Pokémon.', false);
    return;
  }
  GUESSES.push(found);
  setAttempts();
  pushGuessRow(found);
  log.debug('gioco', 'Tentativo ' + GUESSES.length + ': ' + (found.italianName || found.name));

  if (found.id === SECRET.id) {
    log.info('gioco', 'Indovinato in ' + GUESSES.length + ' tentativi');
    showWin(found);
    $('#secretHint').textContent = 'Hai indovinato! Premi "Nuova partita" per rigiocare.';
  } else {
    $('#guessInput').value = '';
    $('#guessInput').focus();
  }
}

// Scarica dati da PokeAPI (solo prima attivazione o aggiornamento)
async function downloadData(rangeInput) {
  const parsed = parseRangeInput(rangeInput);
  if (!parsed) {
    log.warn('download', 'Intervallo non valido: "' + rangeInput + '"');
    toast("Input non valido. Usa un numero (es. 151) o un range (es. 120-160).", false);
    return [];
  }

  const { start, end } = parsed;
  const total = end - start + 1;
  // 3 richieste per Pokémon, una dopo l'altra: con tanti Pokémon ci vogliono minuti
  log.info('download', `Avvio download #${start}-${end}: ${total} Pokémon, circa ${total * 3} richieste a PokeAPI`);
  const endAll = log.time('download', `Download #${start}-${end}`);
  const failed = [];
  setStatus(`Preparazione download ${start}-${end}…`);
  const out = [];

  for (let id = start; id <= end; id++) {
    try {
      setStatus(`Scarico #${id}/${end}…`);
      setProgress(id - start, total);
      const t0 = performance.now();

      // Pokémon
      const pResp = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
      if (!pResp.ok) throw new Error(`pokemon/${id} ha risposto ${pResp.status}`);
      const p = await pResp.json();

      // Specie
      const sResp = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
      if (!sResp.ok) throw new Error(`pokemon-species/${id} ha risposto ${sResp.status}`);
      const s = await sResp.json();

      // Nome italiano
      let italianName = null;
      if (Array.isArray(s.names)) {
        const it = s.names.find(n => n.language?.name === 'it');
        italianName = it?.name || null;
      }

      const genNum = generationNumber(s.generation?.name);
      const type1 = p.types?.[0]?.type?.name || null;
      const type2 = p.types?.[1]?.type?.name || null;
      const height_m = (p.height || 0) / 10.0;
      const weight_kg = (p.weight || 0) / 10.0;
      const color = s.color?.name || null;
      const name = p.name;

      // Evoluzione
      let evoStage = 'Singolo';
      if (s.evolution_chain?.url) {
        const evoResp = await fetch(s.evolution_chain.url);
        if (!evoResp.ok) log.warn('download', `#${id}: catena evolutiva non disponibile (${evoResp.status}), uso "Singolo"`);
        if (evoResp.ok) {
          const evoData = await evoResp.json();
          const findStage = (chain, targetName, level = 1) => {
            if (chain.species.name === targetName) return level;
            for (const evo of chain.evolves_to) {
              const res = findStage(evo, targetName, level + 1);
              if (res) return res;
            }
            return null;
          };
          const stageNum = findStage(evoData.chain, name);
          if (stageNum === 1 && evoData.chain.evolves_to.length === 0) evoStage = 'Singolo';
          else if (stageNum === 1) evoStage = 'Base';
          else if (stageNum === 2) evoStage = 'Intermedio';
          else if (stageNum >= 3) evoStage = 'Finale';
        }
      }

      const habitats = s.habitat?.name || 'Sconosciuto';

      out.push({
        id,
        name,
        italianName,
        generation: genNum,
        type1,
        type2,
        evolutionStage: evoStage,
        color,
        height_m,
        weight_kg,
        habitat: habitats
      });

      setCount(out.length);
      log.debug('download', `#${id} ${italianName || name} in ${Math.round(performance.now() - t0)} ms (${out.length}/${total})`);
      if (out.length % 25 === 0) log.info('download', `Avanzamento: ${out.length}/${total}`);

    } catch (e) {
      failed.push(id);
      log.error('download', `#${id} saltato: ${e.message}`);
    }
  }

  endAll({ scaricati: out.length, falliti: failed.length });
  if (failed.length) log.warn('download', `${failed.length} Pokémon non scaricati`, failed);
  if (!out.length) {
    // non sovrascrivere i dati buoni con un download andato a vuoto
    log.error('download', 'Nessun Pokémon scaricato: tengo il dataset precedente');
    setStatus('Download fallito: controlla la connessione.');
    toast('Download fallito: nessun Pokémon scaricato.', false);
    return DATASET;
  }
  setStatus('Salvataggio locale…');
  saveDataset(out);
  setStatus(failed.length ? `Completato, ${failed.length} non scaricati.` : 'Completato.');
  setProgress(1, 1);
  return out;
}



// Esporta dataset su file
function exportDataset() {
  const dataStr = JSON.stringify(DATASET, null, 2);
  const blob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pokemon_offline.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Importa dataset da file
function importDataset(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data) || !data.length) throw new Error('Formato non valido');
      DATASET = data;
      log.info('dati', 'Importati ' + data.length + ' Pokémon da ' + file.name);
      saveDataset(DATASET);
      setCount(DATASET.length);
      buildNameList();
      $('#btnNew').disabled = false;
      toast('Dataset importato con successo.');
    } catch (err) {
      log.error('dati', 'Importazione di ' + file.name + ' fallita: ' + err.message);
      toast('Errore durante l’importazione.', false);
    }
  };
  reader.readAsText(file);
}

// Inizializza app
function init() {
  buildGenerations();
  // Bottoni
  $('#btnDownload').addEventListener('click', async () => {
    // due download in parallelo si accavallano e sembrano bloccare la pagina
    if (DOWNLOADING) { log.warn('download', 'Download già in corso, clic ignorato'); return; }
    DOWNLOADING = true;
    $('#btnDownload').disabled = true;
    try {
      const input = $('#downloadCount').value;
      setStatus('Avvio download…');
      DATASET = await downloadData(input);
      setCount(DATASET.length);
      buildNameList();
      $('#btnNew').disabled = !DATASET.length;
      if (DATASET.length) toast('Dati scaricati e salvati offline!');
    } catch (e) {
      log.error('download', 'Errore inatteso durante il download: ' + e.message, e.stack);
      setStatus('Errore durante il download.');
    } finally {
      DOWNLOADING = false;
      $('#btnDownload').disabled = false;
    }
  });


  $('#btnExport').addEventListener('click', () => {
    log.info('dati', 'Esporto ' + DATASET.length + ' Pokémon');
    exportDataset();
  });
  $('#fileImport').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      importDataset(e.target.files[0]);
      e.target.value = '';
    }
  });

  $('#btnNew').addEventListener('click', () => {
    newSecret();
    $('#result').classList.add('hidden');
    $('#guessInput').value = '';
    $('#guessInput').focus();
  });

  $('#btnGuess').addEventListener('click', doGuess);
  $('#guessInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doGuess();
  });

  // Caricamento da storage se già presente
  DATASET = loadDatasetFromStorage();
  setCount(DATASET.length);
  if (DATASET.length) {
    buildNameList();
    $('#btnNew').disabled = false;
    $('#secretHint').textContent = `Database caricato con (${DATASET.length}) Pokémon.`;
  } else {
    setStatus('Nessun dataset in locale. Scaricalo o importalo.');
  }
}

function parseRangeInput(input) {
  const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(input);
  if (rangeMatch) {
    let start = parseInt(rangeMatch[1], 10);
    let end = parseInt(rangeMatch[2], 10);
    if (start > end) [start, end] = [end, start]; // inverti se l’utente scrive 200-150
    return { start, end };
  }
  const n = parseInt(input, 10);
  if (!isNaN(n) && n > 0) {
    return { start: 1, end: n };
  }
  return null;
}


document.addEventListener('DOMContentLoaded', init);
