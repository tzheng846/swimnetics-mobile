import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({ session: null, loading: true, teamId: null, coachId: null, signOut: () => {} });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teamId, setTeamId] = useState(null);
  const [coachId, setCoachId] = useState(null);

  const fetchCoachProfile = async (sess) => {
    if (!sess) { setTeamId(null); setCoachId(null); return; }
    const { data } = await supabase
      .from('coaches')
      .select('id, team_id')
      .eq('user_id', sess.user.id)
      .single();
    setTeamId(data?.team_id ?? null);
    setCoachId(data?.id ?? null);
  };

  useEffect(() => {
    // Pause/resume token auto-refresh with app foreground state.
    // Without this, the JWT can expire while the app is backgrounded and the
    // next upload will 401. Recommended by Supabase RN docs.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      await fetchCoachProfile(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) { setTeamId(null); setCoachId(null); }
    });

    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, teamId, coachId, signOut: () => supabase.auth.signOut() }}>
      {children}
    </AuthContext.Provider>
  );
}
