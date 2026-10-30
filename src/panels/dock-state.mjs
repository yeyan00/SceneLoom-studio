export const emptyDock = { open: [], active: null, collapsed: false };

export function dockReducer(state, action) {
  switch (action.type) {
    case "open":
      return {
        open: state.open.includes(action.id)
          ? state.open
          : [...state.open, action.id],
        active: action.id,
        collapsed: false,
      };
    case "select":
      return state.open.includes(action.id)
        ? { ...state, active: action.id, collapsed: false }
        : state;
    case "close": {
      const open = state.open.filter((id) => id !== action.id);
      return {
        ...state,
        open,
        active: state.active === action.id ? open.at(-1) || null : state.active,
      };
    }
    case "collapse":
      return { ...state, collapsed: true };
    default:
      return state;
  }
}
