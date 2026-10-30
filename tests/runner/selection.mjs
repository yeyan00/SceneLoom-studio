export const suites = [
  "unit",
  "integration",
  "browser",
  "ui",
  "dock",
  "workspace",
  "package",
  "brush",
  "forestry",
  "chm",
  "labels",
  "gaussian",
  "tiles",
  "converter",
];
export function selectTests(files) {
  const selected = new Set();
  const reasons = [];
  for (const original of files) {
    const file = original.replaceAll("\\", "/").replace(/^\.\//, "");
    let targets;
    if (/^(docs\/|README|tests\/README\.md$|\.gitignore)/i.test(file))
      targets = [];
    else if (/^tests\/unit\//.test(file)) targets = ["unit"];
    else if (/^tests\/integration\//.test(file))
      targets = file.includes("converter") ? ["converter"] : ["integration"];
    else if (/^tests\/e2e\//.test(file))
      targets = [
        file.includes("tiles")
          ? "tiles"
          : file.includes("gaussian")
            ? "gaussian"
            : file.includes("labels")
              ? "labels"
              : file.includes("chm")
                ? "chm"
                : file.includes("forestry")
                  ? "forestry"
                  : file.includes("brush")
                    ? "brush"
                    : file.includes("package")
                      ? "package"
                      : file.includes("workspace")
                        ? "workspace"
                        : file.includes("dock")
                          ? "dock"
                          : file.includes("ui-") ||
                              file.includes("ribbon") ||
                              file.includes("data-tree")
                            ? "ui"
                            : "browser",
      ];
    else if (/^src\/locales\//.test(file))
      targets = [
        "unit",
        "ui",
        "brush",
        "forestry",
        "chm",
        "labels",
        "gaussian",
        "tiles",
      ];
    else if (
      /^server\/tiles|^src\/views\/(TilesView|tiles-runtime)|^public\/tiles-decoders/.test(
        file,
      )
    )
      targets = ["integration", "tiles"];
    else if (/^src\/views\/ViewTabs/.test(file))
      targets = ["integration", "gaussian", "tiles"];
    else if (
      /^server\/splats|^src\/views\/|^vendor\/supersplat\/|^public\/gs-editor\//.test(
        file,
      )
    )
      targets = ["integration", "gaussian"];
    else if (/^server\/label-sets|^src\/panels\/LabelSetDialog/.test(file))
      targets = ["unit", "integration", "labels", "chm"];
    else if (/^server\/chm\//.test(file))
      targets = ["unit", "integration", "chm"];
    else if (/^server\/logs|^server\/tools/.test(file))
      targets = ["unit", "integration", "dock"];
    else if (/\.css$/.test(file))
      targets = [
        "ui",
        "dock",
        "workspace",
        "brush",
        "forestry",
        "chm",
        "labels",
        "gaussian",
        "tiles",
      ];
    else if (/^shared\/|^src\/pointcloud\//.test(file))
      targets = [
        "unit",
        "integration",
        "browser",
        "ui",
        "workspace",
        "brush",
        "forestry",
        "chm",
        "labels",
        "gaussian",
        "tiles",
      ];
    else targets = suites;
    targets.forEach((suite) => selected.add(suite));
    reasons.push({ file, suites: targets });
  }
  return { suites: suites.filter((suite) => selected.has(suite)), reasons };
}
