import { useEffect, useRef, useState } from "react";
import { MAX_BRUSH_SAMPLES } from "../../shared/brush.mjs";
export function useBrush({
  tool,
  setTool,
  runtime,
  category,
  color,
  region,
  onCommit,
  onStart,
  onError,
  action,
}) {
  const stroke = useRef(null),
    cursor = useRef(null),
    hover = useRef(false),
    latest = useRef(),
    radiusRef = useRef(24);
  const [radius, setRadius] = useState(24),
    [navigating, setNavigating] = useState(false);
  latest.current = {
    onCommit,
    onStart,
    onError,
    category,
    region,
    tool,
    action,
  };
  function cancel() {
    if (stroke.current) {
      stroke.current = null;
      runtime.current?.setBrush(null);
    }
  }
  function finish() {
    const value = stroke.current;
    if (!value) return null;
    stroke.current = null;
    runtime.current?.finishBrush(value.op);
    latest.current.onCommit(value.op);
    return value.op;
  }
  useEffect(() => {
    const ignored = (e) =>
      e.target.closest?.("input,textarea,select,[contenteditable=true]") ||
      document.querySelector("[role=dialog]");
    const key = (e) => {
      if (ignored(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "KeyB") {
        e.preventDefault();
        setTool("brush");
        return;
      }
      if (latest.current.tool !== "brush") return;
      if (e.code === "Escape") {
        e.preventDefault();
        if (stroke.current) cancel();
        else setTool("navigate");
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        if (!stroke.current) {
          setNavigating(true);
          runtime.current?.setTool("navigate");
        }
        return;
      }
      if (!hover.current) return;
      const increase = ["Equal", "NumpadAdd", "BracketRight"].includes(e.code),
        decrease = ["Minus", "NumpadSubtract", "BracketLeft"].includes(e.code);
      if (increase || decrease) {
        e.preventDefault();
        resize(radiusRef.current * (increase ? 1.1 : 1 / 1.1));
      }
    };
    const release = (e) => {
      if (e.code === "Space") {
        setNavigating(false);
        if (latest.current.tool === "brush") runtime.current?.setTool("brush");
      }
    };
    const blur = () => {
      cancel();
      setNavigating(false);
      if (latest.current.tool === "brush") runtime.current?.setTool("brush");
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", cancel);
    const hidden = () => {
      if (document.hidden) blur();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", hidden);
      cancel();
    };
  }, []);
  useEffect(() => {
    cancel();
    setNavigating(false);
  }, [tool, region, JSON.stringify(action)]);
  useEffect(() => {
    if (tool === "brush" && cursor.current) {
      cursor.current.style.width = radius * 2 + "px";
      cursor.current.style.height = radius * 2 + "px";
    }
  }, [radius, tool]);
  function resize(value) {
    const next = Math.max(2, Math.min(256, value));
    radiusRef.current = next;
    setRadius(next);
  }
  function sample(e) {
    const box = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(-512, Math.min(box.width + 512, e.clientX - box.left)),
      Math.max(-512, Math.min(box.height + 512, e.clientY - box.top)),
      radiusRef.current,
    ];
  }
  function append(e) {
    const active = stroke.current;
    if (!active) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (
      box.width !== active.op.selection.viewport[0] ||
      box.height !== active.op.selection.viewport[1]
    ) {
      cancel();
      return;
    }
    const point = sample(e),
      prev = active.op.selection.samples.at(-1);
    if (point.every((v, i) => v === prev[i])) return;
    if (active.op.selection.samples.length >= MAX_BRUSH_SAMPLES) {
      finish();
      latest.current.onError(new Error("单笔画刷过长，请松开后继续涂刷"));
      return;
    }
    active.op = {
      ...active.op,
      selection: {
        ...active.op.selection,
        samples: [...active.op.selection.samples, point],
      },
    };
    runtime.current.setBrush(active.op, performance.now());
  }
  return {
    radius,
    resize,
    navigating,
    cursor,
    color,
    handlers: {
      onPointerEnter: () => {
        hover.current = true;
        if (cursor.current) cursor.current.style.display = "block";
      },
      onPointerLeave: () => {
        hover.current = false;
        if (cursor.current) cursor.current.style.display = "none";
      },
      onPointerDown: (e) => {
        if (e.button !== 0 || navigating) return;
        if (latest.current.action === null) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        const engine = runtime.current;
        engine.setTool("brush");
        latest.current.onStart();
        const box = e.currentTarget.getBoundingClientRect();
        const op = {
          id: crypto.randomUUID(),
          type: "classify",
          category: latest.current.category,
          ...latest.current.action,
          invert: false,
          scope: latest.current.region || null,
          selection: {
            kind: "brush",
            version: 1,
            matrix: engine.selection([], false, "main").matrix,
            viewport: [box.width, box.height],
            samples: [sample(e)],
          },
        };
        stroke.current = { op };
        engine.cancelActiveBrush = cancel;
        engine.commitActiveBrush = finish;
        e.currentTarget.setPointerCapture(e.pointerId);
        engine.setBrush(op, performance.now());
      },
      onPointerMove: (e) => {
        const p = sample(e);
        if (cursor.current) {
          cursor.current.style.left = p[0] + "px";
          cursor.current.style.top = p[1] + "px";
        }
        if (stroke.current) append(e);
      },
      onPointerUp: (e) => {
        if (e.button === 0 && stroke.current) {
          append(e);
          finish();
        }
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onContextMenu: (e) => e.preventDefault(),
      onWheel: (e) => {
        if (stroke.current) e.stopPropagation();
      },
    },
  };
}
