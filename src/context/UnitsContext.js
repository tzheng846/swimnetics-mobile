import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// Distance-unit preference (m | yd), persisted in SecureStore (already a dependency).
// Phase 38-02 persists + exposes the pref; chart/readout consumption is wired in a later plan.
const KEY = 'pref_unit';
const UnitsContext = createContext({ unit: 'm', setUnit: () => {} });

export const useUnits = () => useContext(UnitsContext);

export function UnitsProvider({ children }) {
  const [unit, setUnitState] = useState('m');

  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((v) => {
      if (v === 'm' || v === 'yd') setUnitState(v);
    }).catch(() => {});
  }, []);

  const setUnit = (u) => {
    setUnitState(u);
    SecureStore.setItemAsync(KEY, u).catch(() => {});
  };

  return <UnitsContext.Provider value={{ unit, setUnit }}>{children}</UnitsContext.Provider>;
}
