// ═══════════════════════════════════════════
//  appState.js — Single source of truth for
//  all mutable global state
//  Fix: getters/setters instead of bare globals
// ═══════════════════════════════════════════

import { ListenerManager, TimerManager, RateLimiter } from '../modules/managers.js';
import { TABLES } from '../config.js';

// ── Shared manager singletons ──
export const timerManager    = new TimerManager();
export const listenerManager = new ListenerManager();
export const coinRateLimiter = new RateLimiter();

// ── Auth / user ──
let _curUser = null;
let _curData = null;
let _connected = false;

export const getCurUser   = ()    => _curUser;
export const getCurData   = ()    => _curData;
export const isConnected  = ()    => _connected;
export const setCurUser   = user  => { _curUser = user; };
export const setCurData   = data  => { _curData = data; };
export const setConnected = val   => { _connected = val; };

// For legacy compat — modules that need both at once can destructure:
export const getState = () => ({ curUser: _curUser, curData: _curData });

// ── Guest ──
let _guestAnswered = 0;
export const getGuestAnswered    = ()  => _guestAnswered;
export const incGuestAnswered    = ()  => { _guestAnswered++; };
export const resetGuestCounters  = ()  => { _guestAnswered = 0; };

// ── Quiz state ──
export const quizState = {
  quranData:      [],
  quranLoading:   false,
  selAyats:       [],
  curAyat:        null,
  qIdx:           0,
  score:          0,
  totalQ:         10,
  mode:           'practice',
  usedI:          [],
  surahC:         {},
  startT:         0,
  timeArr:        [],
  survOn:         true,
  hints:          0,
  sessionCorrect: 0,
  sessionTotal:   0,
};

export function resetQuizState() {
  quizState.qIdx           = 0;
  quizState.score          = 0;
  quizState.usedI          = [];
  quizState.surahC         = {};
  quizState.timeArr        = [];
  quizState.hints          = 0;
  quizState.survOn         = true;
  quizState.sessionCorrect = 0;
  quizState.sessionTotal   = 0;
}

// ── Match state ──
export function freshMatchState() {
  return {
    tableKey:          null,
    matchId:           null,
    myRole:            null,
    opponentName:      null,
    myScore:           0,
    oppScore:          0,
    myQIdx:            0,
    currentAyatIndex: -1,
    answered:          false,
    feeDeducted:       false,
    inSuddenDeath:     false,
    _ended:            false,
    _refunding:        false,
    listeners:         new ListenerManager(),
    timers:            new TimerManager(),
    disconnectGraceTimer: null,
  };
}

export let MS       = freshMatchState();
export const getMS  = ()    => MS;
export const resetMS = ()   => { MS = freshMatchState(); };
export let _joining = false;
export const setJoining = v => { _joining = v; };

// ── Submit cooldown ──
let _lastSubmit = 0;
export const getLastSubmit  = ()  => _lastSubmit;
export const setLastSubmit  = ()  => { _lastSubmit = Date.now(); };
export const resetSubmit    = ()  => { _lastSubmit = 0; };

// ── Language (persisted) ──
export let currentLang = localStorage.getItem('nqg_lang') || 'hinglish';
export const setLang = lang => { currentLang = lang; localStorage.setItem('nqg_lang', lang); };
