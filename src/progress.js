// Achievements and per-player stats. Progress is kept in localStorage so it works
// offline, and synced to Supabase (one row per anonymously signed-in player) when
// the database is configured. Merging always keeps the best of both copies.
import { supabase } from './supabase.js';

export const ACHIEVEMENTS = [
  { id: 'first_trip', icon: '🏁', name: 'First commute', desc: 'Finish any drive', stat: 'trips', goal: 1 },
  { id: 'juiced', icon: '⚡', name: 'Juiced up', desc: 'Collect 10 nitro cans', stat: 'cans', goal: 10 },
  { id: 'mystery', icon: '🎁', name: 'Mystery box', desc: 'Open a ? box', stat: 'boxes', goal: 1 },
  { id: 'bumper', icon: '💥', name: 'Bumper cars', desc: 'Smash 5 cars', stat: 'smashed', goal: 5 },
  { id: 'foodie', icon: '🍜', name: 'Foodie', desc: 'Drive to Odd Burger or Noodle Feast', stat: 'food', goal: 1 },
];
// Every achievement unlocks the Rocket.
export const ROCKET_NEEDS = ACHIEVEMENTS.length;

const LOCAL_KEY = 'driveHome.progress';

const empty = () => ({ stats: { trips: 0, cans: 0, boxes: 0, smashed: 0, food: 0, maps: [] }, achievements: [] });

function merge(a, b) {
  const out = empty();
  for (const k of Object.keys(out.stats)) {
    if (k === 'maps') out.stats.maps = [...new Set([...(a.stats.maps || []), ...(b.stats.maps || [])])];
    else out.stats[k] = Math.max(a.stats[k] || 0, b.stats[k] || 0);
  }
  out.achievements = [...new Set([...a.achievements, ...b.achievements])];
  return out;
}

class Progress {
  constructor() {
    this.data = empty();
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_KEY));
      if (saved?.stats) this.data = merge(empty(), saved);
    } catch { /* storage unavailable */ }
    this.listeners = [];
    this.online = false;
    this.name = null; // fixed player name, set once (stored in the database)
  }

  get unlocked() {
    return new Set(this.data.achievements);
  }

  get rocketUnlocked() {
    return ACHIEVEMENTS.every((a) => this.data.achievements.includes(a.id));
  }

  value(a) {
    return Math.min(a.goal, this.data.stats[a.stat] || 0);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  // Sign in (anonymously, once per browser) and pull this player's saved progress.
  async connect() {
    if (!supabase) return;
    try {
      let { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        session = data.session;
      }
      this.userId = session.user.id;
      const { data: row, error } = await supabase.from('player_progress').select('stats, achievements, name').eq('user_id', this.userId).maybeSingle();
      if (error) throw error;
      if (row) this.data = merge(this.data, { stats: row.stats || {}, achievements: row.achievements || [] });
      this.name = row?.name ?? null;
      this.online = true;
      this.check();
      this.saveLocal();
      await this.push();
      this.listeners.forEach((fn) => fn([]));
    } catch (e) {
      console.warn('Progress is saved on this device only:', e.message ?? e);
    }
  }

  // Pick the player's name. It can only be set once. Returns null, 'taken' or 'error'.
  async setName(name) {
    if (!this.online || this.name) return 'error';
    const clean = name.trim().slice(0, 16);
    const { error } = await supabase.from('player_progress').update({ name: clean }).eq('user_id', this.userId);
    if (error) return error.code === '23505' ? 'taken' : 'error';
    this.name = clean;
    return null;
  }

  saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }

  async push() {
    if (!this.online) return;
    const { error } = await supabase.from('player_progress').upsert({
      user_id: this.userId, stats: this.data.stats, achievements: this.data.achievements, updated_at: new Date().toISOString(),
    });
    if (error) console.warn('Could not save progress online:', error.message);
  }

  // Unlock anything newly earned. Returns the achievements that just unlocked.
  check() {
    const fresh = ACHIEVEMENTS.filter((a) => !this.data.achievements.includes(a.id) && this.value(a) >= a.goal);
    this.data.achievements.push(...fresh.map((a) => a.id));
    return fresh;
  }

  // Count something (cans, boxes, smashed…). Saves and reports new achievements.
  add(stat, n = 1) {
    if (!n) return [];
    this.data.stats[stat] = (this.data.stats[stat] || 0) + n;
    return this.commit();
  }

  finishTrip(map) {
    this.data.stats.trips += 1;
    if (!this.data.stats.maps.includes(map)) this.data.stats.maps.push(map);
    if (map === 'burger' || map === 'noodle') this.data.stats.food += 1;
    return this.commit(true);
  }

  commit(sync = false) {
    const fresh = this.check();
    this.saveLocal();
    if (sync || fresh.length) this.push();
    if (fresh.length) this.listeners.forEach((fn) => fn(fresh));
    return fresh;
  }
}

export const progress = new Progress();
// Resolves once the player is signed in (or it's clear we're offline).
export const progressReady = progress.connect();
