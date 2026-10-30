import { useReducer } from "react";
import { historyReducer } from "../../shared/history.mjs";
export function useEditHistory() {
  const [state, dispatch] = useReducer(historyReducer, {
    operations: [],
    cursor: 0,
  });
  return {
    ...state,
    commit: (command) => dispatch({ type: "commit", command }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    reset: (operations, cursor) =>
      dispatch({ type: "reset", operations, cursor }),
  };
}
