export function historyReducer(state, action) {
  switch (action.type) {
    case "reset":
      return {
        operations: action.operations || [],
        cursor: action.cursor || 0,
      };
    case "commit":
      return {
        operations: [
          ...state.operations.slice(0, state.cursor),
          structuredClone(action.command),
        ],
        cursor: state.cursor + 1,
      };
    case "undo":
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case "redo":
      return {
        ...state,
        cursor: Math.min(state.operations.length, state.cursor + 1),
      };
    default:
      return state;
  }
}
export function editSignature({
  operations,
  cursor,
  classes,
  labelSet,
  workspace,
}) {
  return JSON.stringify({
    operations: operations.slice(0, cursor),
    classes,
    ...(labelSet ? { labelSet } : {}),
    region: workspace?.region || null,
  });
}
