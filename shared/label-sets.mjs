// Names and aliases are user data, never algorithm inputs. Semantics are explicit.
export const LAS_LABEL_SET_ID = "asprs-las-1.4-r15";
export const semanticLabels = {
  none: "无指定语义",
  unclassified: "未分类",
  ground: "地面",
  vegetation: "植被",
  "vegetation-low": "低矮植被",
  "vegetation-medium": "中等植被",
  "vegetation-high": "高大植被",
  building: "建筑物",
  noise: "噪声",
  water: "水面",
  rail: "铁路",
  road: "道路",
  wire: "电线",
  tower: "杆塔",
  bridge: "桥面",
};
const rows = [
  [0, "Created, never classified", "从未分类", "unclassified", "#b7c6d6"],
  [1, "Unclassified", "未分类", "unclassified", "#b7c6d6"],
  [2, "Ground", "地面", "ground", "#cbb08b"],
  [3, "Low Vegetation", "低矮植被", "vegetation-low", "#a5cd68"],
  [4, "Medium Vegetation", "中等植被", "vegetation-medium", "#53ad79"],
  [5, "High Vegetation", "高大植被", "vegetation-high", "#24764c"],
  [6, "Building", "建筑物", "building", "#dfb6a1"],
  [7, "Low Point (noise)", "低位噪声", "noise", "#eb7274"],
  [8, "Reserved", "保留：模型关键点使用标志位", "none", "#a5adb5", true],
  [9, "Water", "水面", "water", "#529ad4"],
  [10, "Rail", "铁路", "rail", "#ac91c8"],
  [11, "Road Surface", "道路表面", "road", "#b8b8b8"],
  [12, "Reserved", "保留：重叠使用标志位", "none", "#a5adb5", true],
  [13, "Wire - Guard (Shield)", "保护线", "wire", "#efbc63"],
  [14, "Wire - Conductor (Phase)", "导线", "wire", "#e19760"],
  [15, "Transmission Tower", "输电塔", "tower", "#c486bb"],
  [16, "Wire-structure Connector (Insulator)", "绝缘连接件", "wire", "#d5acdf"],
  [17, "Bridge Deck", "桥面", "bridge", "#8da3bc"],
  [18, "High Noise", "高位噪声", "noise", "#f86682"],
];
const standard = {
  id: LAS_LABEL_SET_ID,
  name: "ASPRS LAS 1.4 R15",
  version: 1,
  standard:
    "ASPRS LAS 1.4 R15 (2019), classification table; 19–63 reserved, 64–255 user definable",
  classes: rows.map(([id, name, alias, semantic, color, reserved]) => ({
    id,
    name,
    aliases: [alias],
    semantic,
    color,
    ...(reserved ? { reserved: true } : {}),
  })),
};
export const lasLabelSet = () => structuredClone(standard);
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export function validateClasses(classes) {
  if (!Array.isArray(classes) || classes.length > 256)
    throw new Error("类别定义无效");
  const ids = new Set();
  for (const c of classes) {
    if (
      !c ||
      !Number.isInteger(c.id) ||
      c.id < 0 ||
      c.id > 255 ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 120 ||
      !/^#[\da-f]{6}$/i.test(c.color) ||
      (c.aliases !== undefined &&
        (!Array.isArray(c.aliases) ||
          c.aliases.length > 16 ||
          new Set(c.aliases).size !== c.aliases.length ||
          c.aliases.some(
            (a) => typeof a !== "string" || !a.trim() || a.length > 120,
          ))) ||
      (c.semantic !== undefined &&
        !Object.hasOwn(semanticLabels, c.semantic)) ||
      (c.reserved !== undefined && typeof c.reserved !== "boolean")
    )
      throw new Error("类别定义无效");
    ids.add(c.id);
  }
}
export function validateLabelSet(value) {
  if (
    !value ||
    typeof value.id !== "string" ||
    !/^[-\w.]{1,100}$/.test(value.id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 120 ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    !Array.isArray(value.classes) ||
    !value.classes.length ||
    (value.standard !== undefined &&
      (typeof value.standard !== "string" || value.standard.length > 500))
  )
    throw new Error("标签集定义无效");
  validateClasses(value.classes);
  if (value.id === LAS_LABEL_SET_ID && canonical(value) !== canonical(standard))
    throw new Error("内置标签集只读，请先复制");
  return value;
}
const legacyNames = [
  "未分类",
  "未指定",
  "地面",
  "低矮植被",
  "中等植被",
  "高大植被",
  "建筑物",
  "噪声",
];
export function labelSetForSession(session = {}) {
  if (session.labelSet) {
    validateLabelSet(session.labelSet);
    return structuredClone(session.labelSet);
  }
  if (
    !session.classes?.length ||
    (session.classes.length === 8 &&
      session.classes.every(
        (c, i) =>
          c.id === i && c.name === legacyNames[i] && c.color === rows[i][4] &&
          Object.keys(c).every((key) => ["id", "name", "color"].includes(key)),
      ))
  )
    return lasLabelSet();
  validateClasses(session.classes);
  // Unknown legacy standards must not inherit LAS meanings from numeric IDs.
  return {
    id: "legacy-project",
    name: "Legacy project labels",
    version: 1,
    classes: session.classes.map((c) => ({
      ...c,
      aliases: c.aliases || [],
      semantic: c.semantic || "none",
    })),
  };
}
export function validateLabelSession(value) {
  if (value.classes !== undefined) validateClasses(value.classes);
  if (value.labelSet !== undefined) {
    validateLabelSet(value.labelSet);
    if (
      value.classes !== undefined &&
      canonical(value.classes) !== canonical(value.labelSet.classes)
    )
      throw new Error("标签集与类别定义不一致");
  }
}
export function chmSemantics(labelSet) {
  if (labelSet) validateLabelSet(labelSet);
  const classes = labelSet?.classes || [];
  const ids = (roles) =>
    classes
      .filter((c) => !c.reserved && roles.includes(c.semantic))
      .map((c) => c.id)
      .sort((a, b) => a - b);
  return {
    groundIds: ids(["ground"]),
    ignoreIds: ids(["building", "noise", "water"]),
    excludeCategories: ids(["ground", "building", "noise", "water"]),
    labelSet: labelSet ? { id: labelSet.id, version: labelSet.version } : null,
  };
}
export function matchesClass(c, query) {
  const text = query.trim().toLocaleLowerCase();
  return (
    !text ||
    [String(c.id), c.name, ...(c.aliases || [])].some((s) =>
      s.toLocaleLowerCase().includes(text),
    )
  );
}
