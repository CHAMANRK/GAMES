// storage.js - small wrapper around localStorage for app data
(function(){
  const PREFIX = 'qgame_';
  function fullKey(k){ return PREFIX + k; }

  function set(key, value) {
    try { localStorage.setItem(fullKey(key), JSON.stringify(value)); return true; }
    catch (e) { console.warn('Storage set failed', e); return false; }
  }
  function get(key, defaultVal = null) {
    try {
      const v = localStorage.getItem(fullKey(key));
      return v === null ? defaultVal : JSON.parse(v);
    } catch (e) { console.warn('Storage get failed', e); return defaultVal; }
  }
  function remove(key) {
    try { localStorage.removeItem(fullKey(key)); return true; }
    catch (e) { console.warn('Storage remove failed', e); return false; }
  }

  // Convenience APIs
  function setUserProfile(profile) { return set('profile', profile); }
  function getUserProfile() { return get('profile', { name: '', coins: 0 }); }

  function setLastScreen(id) { return set('lastScreen', id); }
  function getLastScreen() { return get('lastScreen', null); }

  function saveProgress(obj) { return set('progress', obj); }
  function loadProgress() { return get('progress', {}); }

  window.StorageManager = {
    set, get, remove,
    setUserProfile, getUserProfile,
    setLastScreen, getLastScreen,
    saveProgress, loadProgress
  };
})();