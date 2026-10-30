# Embedded SuperSplat

Upstream: https://github.com/playcanvas/supersplat

Version: 3.7.0. Snapshot commit: `b89029dd20911fd18905b61de2701094ac390a73`.
License: MIT; see LICENSE. The source snapshot is self-contained and does not
read the adjacent development checkout. Runtime assets are copied under
`public/gs-editor/static`; dependency versions are pinned in the root package.

SceneLoom adaptations:

- `main(root, locale)` returns a per-view editor context instead of mounting a
  standalone page. No iframe bridge, global editor, WebMCP or cloud publishing.
- Shadow-root DOM lookup and styles, root-scoped keyboard/pointer listeners,
  disposable listeners and ResizeObserver; inactive scenes skip rendering.
- Native menu omitted in favor of host open/save/export controls. Native scene,
  panels, toolbar, command queue, edit history, loading and serialization remain.
- Static locale and WebP WASM URLs point to bundled assets.
- Type-only imports/exports explicitly marked for Vite development modules.
- Embedded tooltip/context menu coordinates are relative to the view host;
  focus returns to the editor container instead of document.body.
- Controller listener cleanup captures the previous destroy callback instead
  of recursively invoking itself. Tooltips cancel timers on destruction.

The standalone entry and upstream iframe source are reference files only and
are not imported by the embedded bootstrap. Upgrade by comparing this snapshot
against upstream and reapplying the adaptations; run the GS browser regression
and full release regression after engine or editor upgrades.
