/* 
  Pokedle Offline — tutto in locale dopo la prima attivazione.
  Ora usa lo stadio evolutivo invece della natura.
*/

const STORAGE_KEY = 'pokemonDataV1';
let DATASET = [];
let SECRET = null;
let GUESSES = [];

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
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Errore lettura storage', e);
    return [];
  }
}

// Salva dataset
function saveDataset(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
  if (!DATASET.length) return;
  SECRET = DATASET[(Math.random() * DATASET.length) | 0];
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
  if (!SECRET) return;
  const name = $('#guessInput').value.trim().toLowerCase();
  if (!name) return;

  const found = DATASET.find(p => (p.italianName || p.name).toLowerCase() === name);
  if (!found) {
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

  if (found.id === SECRET.id) {
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
    toast("Input non valido. Usa un numero (es. 151) o un range (es. 120-160).", false);
    return [];
  }

  const { start, end } = parsed;
  setStatus(`Preparazione download ${start}-${end}…`);
  const out = [];

  for (let id = start; id <= end; id++) {
    try {
      setStatus(`Scarico #${id}/${end}…`);
      setProgress(id - start, end - start + 1);

      // Pokémon
      const pResp = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
      if (!pResp.ok) throw new Error('pokemon fetch failed');
      const p = await pResp.json();

      // Specie
      const sResp = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
      if (!sResp.ok) throw new Error('species fetch failed');
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

    } catch (e) {
      console.error('Errore su id', id, e);
    }
  }

  setStatus('Salvataggio locale…');
  saveDataset(out);
  setStatus('Completato.');
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
      saveDataset(DATASET);
      setCount(DATASET.length);
      buildNameList();
      $('#btnNew').disabled = false;
      toast('Dataset importato con successo.');
    } catch (err) {
      console.error(err);
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
    const input = $('#downloadCount').value;
    setStatus('Avvio download…');
    DATASET = await downloadData(input);
    setCount(DATASET.length);
    buildNameList();
    $('#btnNew').disabled = false;
    if (DATASET.length) toast('Dati scaricati e salvati offline!');
  });


  $('#btnExport').addEventListener('click', exportDataset);
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
