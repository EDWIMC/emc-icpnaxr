import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const collaborationConfigured = Boolean(supabaseUrl && supabaseKey);
const supabase = collaborationConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      realtime: { params: { eventsPerSecond: 12 } }
    })
  : null;

let activeChannel = null;
let activeRoom = null;
let activeUser = null;
const listeners = new Map();

function emit(event, payload) {
  (listeners.get(event) || []).forEach((listener) => {
    try { listener(payload); } catch (error) { console.error(`Room listener (${event}) failed`, error); }
  });
}

export function onRoomEvent(event, listener) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(listener);
  return () => listeners.get(event)?.delete(listener);
}

function assertConfigured() {
  if (!supabase) {
    throw new Error('Classroom sync is not configured. Add the Supabase environment variables and run the SQL migration.');
  }
}

async function ensureGuestSession(displayName) {
  assertConfigured();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously({
    options: { data: { display_name: displayName } }
  });
  if (error) throw new Error(`Anonymous sign-in failed: ${error.message}. Enable Anonymous Sign-Ins in Supabase Auth.`);
  if (!data.user) throw new Error('Supabase did not return a user session.');
  return data.user;
}

async function connectRoom(room, user, displayName, role) {
  if (activeChannel) await leaveRoom();
  activeRoom = room;
  activeUser = user;

  const topic = `fvx-room:${room.code}`;
  activeChannel = supabase.channel(topic, {
    config: {
      private: true,
      broadcast: { self: false, ack: true },
      presence: { key: user.id }
    }
  });

  activeChannel
    .on('broadcast', { event: 'object-state' }, ({ payload }) => emit('state', payload))
    .on('presence', { event: 'sync' }, () => {
      const state = activeChannel?.presenceState() || {};
      const participants = Object.values(state).flat().map((entry) => ({
        userId: entry.user_id,
        name: entry.display_name || 'Student',
        role: entry.role || 'student'
      }));
      emit('participants', participants);
    });

  await new Promise((resolve, reject) => {
    let settled = false;
    activeChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && !settled) {
        settled = true;
        try {
          await activeChannel.track({
            user_id: user.id,
            display_name: displayName,
            role,
            joined_at: new Date().toISOString()
          });
          resolve();
        } catch (error) { reject(error); }
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && !settled) {
        settled = true;
        reject(new Error(`Could not connect to the classroom channel (${status}). Check the Realtime policies.`));
      }
    });
  });

  emit('connected', { room, user, role });
  return { room, user, role };
}

export async function createRoom(title, displayName) {
  const user = await ensureGuestSession(displayName);
  const { data, error } = await supabase.rpc('create_xr_room', {
    p_title: title || 'Future Vision XR classroom',
    p_display_name: displayName || 'Teacher'
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.room_id || !row?.room_code) throw new Error('Supabase did not return the created room. Check the SQL migration.');
  return connectRoom({ id: row.room_id, code: row.room_code, title: row.room_title }, user, displayName, 'host');
}

export async function joinRoom(code, displayName) {
  const normalizedCode = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (normalizedCode.length !== 8) throw new Error('Enter the 8-character classroom code.');
  const user = await ensureGuestSession(displayName);
  const { data, error } = await supabase.rpc('join_xr_room', {
    p_code: normalizedCode,
    p_display_name: displayName || 'Student'
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.room_id) throw new Error('Classroom not found or no longer active.');
  return connectRoom({ id: row.room_id, code: row.room_code, title: row.room_title }, user, displayName, row.member_role || 'student');
}

export async function loadRoomState() {
  if (!supabase || !activeRoom) return null;
  const { data, error } = await supabase
    .from('xr_room_state')
    .select('object_state, updated_at')
    .eq('room_id', activeRoom.id)
    .maybeSingle();
  if (error) throw error;
  return data?.object_state || null;
}

export async function publishRoomState(objectState) {
  if (!supabase || !activeRoom || !activeChannel) return;
  const payload = {
    ...objectState,
    updatedBy: activeUser?.id,
    updatedAt: new Date().toISOString()
  };

  const { error } = await supabase.from('xr_room_state').upsert({
    room_id: activeRoom.id,
    object_state: payload,
    updated_by: activeUser?.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'room_id' });
  if (error) throw error;

  const result = await activeChannel.send({ type: 'broadcast', event: 'object-state', payload });
  if (result !== 'ok') throw new Error(`Room update was saved but live broadcast returned ${result}.`);
}

export async function leaveRoom() {
  if (activeChannel) {
    try { await activeChannel.untrack(); } catch { /* channel may already be closed */ }
    try { await supabase?.removeChannel(activeChannel); } catch { /* best-effort cleanup */ }
  }
  activeChannel = null;
  activeRoom = null;
  activeUser = null;
  emit('participants', []);
  emit('disconnected', null);
}

export function getActiveRoom() {
  return activeRoom ? { ...activeRoom } : null;
}
