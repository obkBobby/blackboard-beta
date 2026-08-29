import { createGame, toggleCard, deselectAll, shuffleRemaining, submitSelection, useNote, hydrateGame, resultText, groupForLevel, LEVELS } from './engine.js';
import { track } from './analytics.js';

const root = document.querySelector('[data-game]');
const variant = root.dataset.variant;
const base = new URL('../../', import.meta.url);
const $ = selector => document.querySelector(selector);

function renderLoadError() {
  const panel = document.createElement('section');
  panel.className = 'load-error';
  panel.setAttribute('role', 'alert');
  const title = document.createElement('h2');
  title.textContent = 'We could not load this puzzle.';
  const detail = document.createElement('p');
  detail.textContent = 'Check your connection or puzzle data, then try again.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'pill primary';
  retry.textContent = 'Retry puzzle';
  retry.addEventListener('click', () => location.reload());
  panel.append(title, detail, retry);
  root.replaceChildren(panel);
}

function isPuzzle(value) {
  if (!value || typeof value.id !== 'string' || typeof value.contentVersion !== 'string' ||
      typeof value.title !== 'string' || typeof value.publishDate !== 'string' || !Array.isArray(value.groups) || value.groups.length !== 4) return false;
  const words = value.groups.flatMap(group => Array.isArray(group.words) ? group.words : []);
  return words.length === 16 && new Set(words).size === 16 && value.groups.every(group =>
    LEVELS.includes(group.level) && typeof group.category === 'string' && group.words.length === 4 &&
    group.words.every(word => typeof word === 'string') && group.words.includes(group.hintWord));
}

let catalog;
try {
  const response = await fetch(new URL('data/puzzles.json', base));
  if (!response.ok) throw new Error('request failed');
  catalog = await response.json();
  if (!Array.isArray(catalog.puzzles) || !catalog.puzzles.length || !catalog.puzzles.every(isPuzzle)) throw new Error('invalid catalog');
} catch {
  renderLoadError();
}

if (catalog) {
  const requested = new URLSearchParams(location.search).get('issue');
  const puzzle = catalog.puzzles.find(item => item.id === requested) || catalog.puzzles.at(-1);
  const storageKey = `obk:blackboard:${puzzle.id}:${variant}`;
  let memorySave = null;
  let storageWarning = false;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = memorySave;
    storageWarning = true;
  }
  let state = hydrateGame(saved, puzzle, variant) || createGame(puzzle, variant);
  const isNew = !saved;

  const els = {
    issue: $('[data-issue]'), date: $('[data-date]'), difficulty: $('[data-difficulty]'),
    deck: $('[data-deck]'), solved: $('[data-solved]'), message: $('[data-message]'),
    mistakes: $('[data-mistakes]'), submit: $('[data-submit]'), deselect: $('[data-deselect]'),
    shuffle: $('[data-shuffle]'), reset: $('[data-reset]'), note: $('[data-note]'),
    noteDialog: $('#note-dialog'), noteChoices: $('[data-note-choices]'),
    resultDialog: $('#result-dialog'), resultText: $('[data-result-text]'),
    copy: $('[data-copy]'), share: $('[data-share]'), resultTitle: $('[data-result-title]'),
    actions: $('.actions'),
    shareStatus: $('[data-share-status]')
  };

  function announce(text) { els.message.textContent = text; }
  function titleCase(word) { return word[0].toUpperCase() + word.slice(1); }
  function groupFor(level) { return groupForLevel(puzzle, state, level); }
  function persist() {
    memorySave = JSON.parse(JSON.stringify(state));
    try { localStorage.setItem(storageKey, JSON.stringify(state)); }
    catch { storageWarning = true; }
  }
  function storageNotice() {
    if (storageWarning) announce('Progress is saved for this visit only.');
  }

  function render() {
    els.issue.textContent = puzzle.title;
    els.date.textContent = new Date(`${puzzle.publishDate}T12:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    els.difficulty.textContent = `Difficulty ${puzzle.difficulty}`;
    const visibleWords = state.status === 'failed' ? [] : state.remaining;
    els.deck.replaceChildren(...visibleWords.map(word => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tile${state.selected.includes(word) ? ' selected' : ''}`;
      button.textContent = word;
      button.dataset.word = word;
      button.setAttribute('aria-pressed', String(state.selected.includes(word)));
      button.disabled = state.status !== 'playing';
      button.addEventListener('click', () => {
        const atLimit = state.selected.length === 4 && !state.selected.includes(word);
        state = toggleCard(state, word);
        persist();
        render();
        if (atLimit) announce('Four-card limit reached. Deselect a card before choosing another.');
      });
      return button;
    }));

    const shownLevels = state.status === 'failed' ? LEVELS : state.solved;
    els.solved.replaceChildren(...shownLevels.map(level => {
      const group = groupFor(level);
      const card = document.createElement('section');
      card.className = `solved-card level-${level}`;
      const label = document.createElement('span');
      label.className = 'level-label';
      label.textContent = titleCase(level);
      const category = document.createElement('strong');
      category.textContent = group.category;
      const words = document.createElement('span');
      words.textContent = group.words.join(' · ');
      card.append(label, category, words);
      return card;
    }));
    els.mistakes.replaceChildren(...Array.from({ length: 4 }, (_, index) => {
      const dot = document.createElement('span');
      dot.className = `mistake-dot${index < state.mistakes ? ' used' : ''}`;
      dot.setAttribute('aria-hidden', 'true');
      return dot;
    }));
    els.mistakes.setAttribute('aria-label', `${4-state.mistakes} mistakes remaining`);
    els.submit.disabled = state.selected.length !== 4 || state.status !== 'playing';
    els.deselect.disabled = state.selected.length === 0 || state.status !== 'playing';
    els.shuffle.disabled = state.status !== 'playing';
    els.note.disabled = state.status !== 'playing' || state.notesUsed.length === 4;
    els.actions.hidden = state.status === 'failed';
    if (state.status === 'failed') announce('Class dismissed — the board has been revealed.');
    if (state.status === 'complete') openResult('Extra credit earned!');
    if (state.status === 'failed') openResult('Class dismissed — review the board.');
  }

  function openResult(title) {
    els.resultTitle.textContent = title;
    els.resultText.value = resultText(state, puzzle);
    els.resultText.setSelectionRange(0, 0);
    els.resultText.scrollTop = 0;
    els.share.hidden = typeof navigator.share !== 'function';
    if (!els.resultDialog.open) {
      els.copy.textContent = 'Copy Result';
      els.shareStatus.textContent = '';
      els.resultDialog.showModal();
    }
    els.resultText.setSelectionRange(0, 0);
    els.resultText.scrollTop = 0;
  }

  function manualCopyFallback() {
    els.shareStatus.textContent = 'Select the spoiler-free result above and copy manually.';
    els.resultText.focus();
    els.resultText.select();
  }

  function renderNoteChoices(focusAfterLevel = null) {
    els.noteChoices.replaceChildren(...LEVELS.map(level => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-choice';
      button.dataset.level = level;
      const used = state.notesUsed.includes(level);
      button.textContent = used ? `${titleCase(level)} Note — ${groupFor(level).hintWord}` : `${titleCase(level)} Note`;
      button.disabled = used;
      button.addEventListener('click', () => {
        const result = useNote(state, level, puzzle);
        state = result.state;
        persist();
        announce(`${titleCase(level)} note opened: ${result.word}`);
        track('note_opened', { issue:puzzle.id, variant, level });
        render();
        renderNoteChoices(level);
      });
      return button;
    }));
    if (focusAfterLevel) {
      const index = LEVELS.indexOf(focusAfterLevel);
      const candidates = [...els.noteChoices.querySelectorAll('button:not(:disabled)')];
      const next = candidates.find(button => LEVELS.indexOf(button.dataset.level) > index) || candidates[0] || els.noteDialog.querySelector('[data-close-dialog]');
      next.focus();
    }
  }

  els.submit.addEventListener('click', () => {
    const outcome = submitSelection(state, puzzle);
    state = outcome.state;
    if (outcome.event === 'incomplete') return announce('Choose exactly four cards.');
    if (outcome.event === 'correct') {
      announce(`${titleCase(outcome.group.level)} group solved.`);
      track('submission_correct', { issue:puzzle.id, variant });
      track('group_solved', { issue:puzzle.id, variant, level:outcome.group.level });
    } else {
      announce(outcome.event === 'failed' ? 'Class dismissed — the board has been revealed.' : outcome.oneAway ? 'One away — three belong together.' : 'That set does not make the grade.');
      track('submission_wrong', { issue:puzzle.id, variant, mistakes:state.mistakes });
      if (outcome.oneAway) track('one_away_triggered', { issue:puzzle.id, variant });
    }
    if (state.status === 'complete') track('puzzle_completed', { issue:puzzle.id, variant, mistakes:state.mistakes, notes:state.notesUsed.length });
    if (state.status === 'failed') track('puzzle_failed', { issue:puzzle.id, variant });
    persist(); render();
  });
  els.deselect.addEventListener('click', () => { state = deselectAll(state); persist(); render(); announce('Selection cleared.'); });
  els.shuffle.addEventListener('click', () => { state = shuffleRemaining(state); persist(); render(); announce('Cards shuffled.'); });
  els.reset?.addEventListener('click', () => {
    if (!confirm('Start this issue over? Your saved progress will be erased.')) return;
    try { localStorage.removeItem(storageKey); } catch { storageWarning = true; }
    memorySave = null;
    state = createGame(puzzle, variant);
    els.copy.textContent = 'Copy Result';
    els.shareStatus.textContent = '';
    persist(); render(); announce('Fresh board ready.');
  });
  els.note.addEventListener('click', () => {
    renderNoteChoices();
    els.noteDialog.showModal();
    (els.noteChoices.querySelector('button:not(:disabled)') || els.noteDialog.querySelector('[data-close-dialog]')).focus();
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  els.copy.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(resultText(state, puzzle));
      els.copy.textContent = 'Copied!';
      els.shareStatus.textContent = '';
      track('result_copied', { issue:puzzle.id, variant });
    } catch { manualCopyFallback(); }
  });
  els.share.addEventListener('click', async () => {
    els.shareStatus.textContent = '';
    try {
      await navigator.share({ title:puzzle.title, text:resultText(state,puzzle) });
      track('result_shared', { issue:puzzle.id, variant });
    } catch (error) {
      if (error?.name !== 'AbortError') manualCopyFallback();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.selected.length && !document.querySelector('dialog[open]')) {
      state = deselectAll(state); persist(); render(); announce('Selection cleared.');
    }
  });
  track('blackboard_page_view', { issue:puzzle.id, variant });
  if (isNew) track('extra_credit_started', { issue:puzzle.id, variant });
  render();
  persist();
  storageNotice();
}
