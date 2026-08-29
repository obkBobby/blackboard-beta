const LEVELS = ['freshman', 'sophomore', 'junior', 'senior'];
const SYMBOLS = { freshman: '🟨', sophomore: '🟩', junior: '🟦', senior: '🟪' };

function solutionPaths(puzzle) {
  return puzzle.solutionPaths?.length ? puzzle.solutionPaths : [{ id: 'reference' }];
}

function groupsForPath(puzzle, path) {
  return puzzle.groups.map(group => ({
    ...group,
    words: path.overrides?.[group.level] || group.words
  }));
}

function sameWords(left, right) {
  return left.length === right.length && left.every(word => right.includes(word));
}

export function groupForLevel(puzzle, state, level) {
  const paths = solutionPaths(puzzle);
  const path = paths.find(item => item.id === state.solutionPath) || paths[0];
  return groupsForPath(puzzle, path).find(group => group.level === level);
}

function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createGame(puzzle, variant = 'misdirection', random = Math.random) {
  return {
    version: 1,
    contentVersion: puzzle.contentVersion,
    puzzleId: puzzle.id,
    variant,
    remaining: shuffled(puzzle.groups.flatMap(group => group.words), random),
    selected: [],
    solved: [],
    solutionPath: null,
    mistakes: 0,
    notesUsed: [],
    status: 'playing',
    startedAt: Date.now()
  };
}

export function toggleCard(state, word) {
  if (state.status !== 'playing' || !state.remaining.includes(word)) return state;
  const selected = state.selected.includes(word)
    ? state.selected.filter(item => item !== word)
    : state.selected.length < 4 ? [...state.selected, word] : state.selected;
  return { ...state, selected };
}

export function deselectAll(state) {
  return { ...state, selected: [] };
}

export function shuffleRemaining(state, random = Math.random) {
  return { ...state, remaining: shuffled(state.remaining, random) };
}

export function submitSelection(state, puzzle) {
  if (state.status !== 'playing') return { state, event: 'inactive' };
  if (state.selected.length !== 4) return { state, event: 'incomplete' };
  const chosen = new Set(state.selected);
  const availablePaths = solutionPaths(puzzle).filter(path => !state.solutionPath || path.id === state.solutionPath);
  const matches = availablePaths.flatMap(path => groupsForPath(puzzle, path)
    .filter(group => !state.solved.includes(group.level) && group.words.every(word => chosen.has(word)))
    .map(group => ({ path, group })));
  const match = matches[0];
  const group = match?.group;
  if (group) {
    const matchingPathIds = new Set(matches
      .filter(item => item.group.level === group.level && sameWords(item.group.words, group.words))
      .map(item => item.path.id));
    const solutionPath = state.solutionPath || (matchingPathIds.size === 1 ? match.path.id : null);
    const solved = [...state.solved, group.level];
    const complete = solved.length === puzzle.groups.length;
    return {
      event: 'correct', group,
      state: {
        ...state,
        selected: [],
        solved,
        solutionPath,
        remaining: state.remaining.filter(word => !chosen.has(word)),
        status: complete ? 'complete' : 'playing',
        ...(complete ? { completedAt: Date.now() } : {})
      }
    };
  }
  const oneAway = availablePaths.some(path => groupsForPath(puzzle, path)
    .some(item => !state.solved.includes(item.level) && item.words.filter(word => chosen.has(word)).length === 3));
  const mistakes = state.mistakes + 1;
  const failed = mistakes >= 4;
  return {
    event: failed ? 'failed' : oneAway ? 'one-away' : 'wrong',
    oneAway,
    state: { ...state, selected: [], mistakes, status: failed ? 'failed' : 'playing' }
  };
}

export function useNote(state, level, puzzle) {
  if (!LEVELS.includes(level) || !puzzle.groups.some(group => group.level === level)) return { state, event: 'invalid-level' };
  if (state.notesUsed.includes(level)) return { state, event: 'already-used' };
  const group = puzzle.groups.find(item => item.level === level);
  return {
    event: 'note-opened', level, word: group.hintWord,
    state: { ...state, notesUsed: [...state.notesUsed, level] }
  };
}

export function resetGame(puzzle, variant = 'misdirection', random = Math.random) {
  return createGame(puzzle, variant, random);
}

export function hydrateGame(value, puzzle, variant) {
  if (!value || value.version !== 1 || value.contentVersion !== puzzle.contentVersion || value.puzzleId !== puzzle.id || value.variant !== variant) return null;
  const allWords = puzzle.groups.flatMap(group => group.words);
  const paths = solutionPaths(puzzle);
  const requestedPath = value.solutionPath == null ? null : paths.find(path => path.id === value.solutionPath);
  if (value.solutionPath != null && !requestedPath) return null;
  const candidatePaths = requestedPath ? [requestedPath] : paths;
  const compatiblePaths = candidatePaths.filter(path => {
    const solvedWords = groupsForPath(puzzle, path)
      .filter(group => value.solved?.includes(group.level)).flatMap(group => group.words);
    const expected = allWords.filter(word => !solvedWords.includes(word));
    return Array.isArray(value.remaining) && sameWords(value.remaining, expected);
  });
  const valid = Array.isArray(value.remaining) && Array.isArray(value.selected) && Array.isArray(value.solved) &&
    Array.isArray(value.notesUsed) && Number.isInteger(value.mistakes) && value.mistakes >= 0 && value.mistakes <= 4 &&
    value.remaining.every(word => allWords.includes(word)) && new Set(value.remaining).size === value.remaining.length &&
    value.selected.every(word => value.remaining.includes(word)) && new Set(value.selected).size === value.selected.length && value.selected.length <= 4 &&
    value.solved.every(level => LEVELS.includes(level)) && new Set(value.solved).size === value.solved.length &&
    value.notesUsed.every(level => LEVELS.includes(level)) && new Set(value.notesUsed).size === value.notesUsed.length &&
    ['playing','complete','failed'].includes(value.status) && compatiblePaths.length > 0 &&
    (value.status !== 'complete' || (value.solved.length === puzzle.groups.length && value.remaining.length === 0)) &&
    (value.status !== 'playing' || value.solved.length < puzzle.groups.length);
  if (!valid) return null;
  const inferredPath = value.solutionPath ?? (compatiblePaths.length === 1 && paths.length > 1 ? compatiblePaths[0].id : null);
  return Object.hasOwn(value, 'solutionPath') && value.solutionPath === inferredPath ? value : { ...value, solutionPath: inferredPath };
}

export function resultText(state, puzzle) {
  const rows = state.solved.map(level => SYMBOLS[level]).join('\n');
  if (state.status === 'failed') {
    return `BlackBoard\n${puzzle.title}\nOutcome: Not solved\nMistakes: ${state.mistakes}\nNotes Used: ${state.notesUsed.length}`;
  }
  return `BlackBoard\n${puzzle.title}\n\n${rows}\n\nMistakes: ${state.mistakes}\nNotes Used: ${state.notesUsed.length}`;
}

export { LEVELS };
