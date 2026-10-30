// Keep the picker and data tree aligned with the application's importers.
export const dataTypes = [
  {
    id: "pointcloud",
    label: "点云",
    extensions: ["las", "laz", "json"],
    formats: "LAS / LAZ · Potree metadata.json / 目录",
  },
  {
    id: "gaussian",
    label: "3DGS",
    extensions: ["ply", "ssproj"],
    formats: "Gaussian PLY · SSProj",
  },
  {
    id: "tiles",
    label: "3D Tiles",
    extensions: ["json"],
    formats: "tileset.json / 目录",
  },
  {
    id: "project",
    label: "项目文件",
    extensions: ["json"],
    formats: "*.sceneloom.json",
  },
];

export function dataFilters(type = "auto", t = (value) => value) {
  const types =
    type === "auto" ? dataTypes : dataTypes.filter((item) => item.id === type);
  const filters = types.map((item) => ({
    name: `${t(item.label)} (${t(item.formats)})`,
    extensions: item.extensions,
  }));
  return type === "auto"
    ? [
        {
          name: t("所有支持的数据"),
          extensions: [
            ...new Set(dataTypes.flatMap((item) => item.extensions)),
          ],
        },
        ...filters,
      ]
    : filters;
}
