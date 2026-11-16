import { useCallback, useEffect, useReducer } from "react";
import { parsePreferences, readPreferences, type Preferences } from "./preferences";

type State = { preferences: Preferences; previous: Preferences | null };
type Action = { type: "update"; update: (previous: Preferences) => Preferences }
  | { type: "adopt"; preferences: Preferences } | { type: "undo" };
function layout(preferences: Preferences) {
  const { period, collapsed, smartExpanded, ...rest } = preferences;
  return JSON.stringify(rest);
}
function reduce(state: State, action: Action): State {
  if (action.type === "adopt") return { preferences: action.preferences, previous: null };
  if (action.type === "undo") return state.previous ? { preferences: { ...state.previous,
    period: state.preferences.period, collapsed: state.preferences.collapsed, smartExpanded: state.preferences.smartExpanded,
  }, previous: null } : state;
  const preferences = action.update(state.preferences);
  return { preferences, previous: layout(preferences) === layout(state.preferences) ? state.previous : state.preferences };
}
export function useLayoutPreferences(storageKey: string) {
  const [state, dispatch] = useReducer(reduce, storageKey, key => ({ preferences: readPreferences(key), previous: null }));
  useEffect(() => {
    try {
      // Compare meaning rather than raw JSON: adopting an older layout must not echo defaults to other windows.
      const stored = localStorage.getItem(storageKey);
      if (stored === null || JSON.stringify(readPreferences(storageKey)) !== JSON.stringify(state.preferences)) {
        localStorage.setItem(storageKey, JSON.stringify(state.preferences));
      }
    } catch { /* Storage is optional. */ }
  }, [storageKey, state.preferences]);
  useEffect(() => {
    function adopt(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      try { dispatch({ type: "adopt", preferences: parsePreferences(JSON.parse(event.newValue ?? "null")) }); }
      catch { /* Keep the last readable layout. */ }
    }
    window.addEventListener("storage", adopt);
    return () => window.removeEventListener("storage", adopt);
  }, [storageKey]);
  const setPreferences = useCallback((update: (previous: Preferences) => Preferences) => dispatch({ type: "update", update }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  return { preferences: state.preferences, setPreferences, undo, canUndo: state.previous !== null };
}
