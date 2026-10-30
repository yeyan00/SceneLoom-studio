import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BoxGeometry } from "three";

export async function createWideTilesFixture(directory, count = 340) {
  await createTilesFixture(directory);
  const children = [];
  for (let i = 0; i < count; i++) {
    const uri = `nested/branch-${i}.json`;
    await writeFile(path.join(directory, uri), JSON.stringify({
      asset: { version: '1.0' }, geometricError: 0,
      root: { boundingVolume: { sphere: [0, 0, 0, 12] }, geometricError: 0, content: { uri: 'model.b3dm' } },
    }));
    children.push({ boundingVolume: { sphere: [0, 0, 0, 12] }, geometricError: 0, content: { uri } });
  }
  await writeFile(path.join(directory, 'tileset.json'), JSON.stringify({
    asset: { version: '1.0' }, geometricError: 100,
    root: { boundingVolume: { sphere: [0, 0, 0, 12] }, geometricError: 100,
      transform: [1,0,0,0,0,1,0,0,0,0,1,0,6378137,0,0,1], children },
  }));
  return path.join(directory, 'tileset.json');
}

export async function createTilesFixture(
  directory,
  { b3dm = true, missing = false, implicit = false } = {},
) {
  await mkdir(path.join(directory, "nested"), { recursive: true });
  const geometry = new BoxGeometry(10, 10, 10),
    positions = geometry.attributes.position.array,
    normals = geometry.attributes.normal.array,
    indices = geometry.index.array;
  const chunks = [positions, normals, indices].map((a) =>
    Buffer.from(a.buffer, a.byteOffset, a.byteLength),
  );
  const offsets = [0, chunks[0].length, chunks[0].length + chunks[1].length];
  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.15, 0.75, 0.35, 1] },
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: chunks.map((b, i) => ({
      buffer: 0,
      byteOffset: offsets[i],
      byteLength: b.length,
    })),
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min: [-5, -5, -5],
        max: [5, 5, 5],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: normals.length / 3,
        type: "VEC3",
      },
      {
        bufferView: 2,
        componentType: 5123,
        count: indices.length,
        type: "SCALAR",
      },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  let model = Buffer.concat([header, json, binHeader, bin]);
  if (b3dm) {
    let features = Buffer.from('{"BATCH_LENGTH":0}');
    features = Buffer.concat([
      features,
      Buffer.alloc((8 - ((28 + features.length) % 8)) % 8, 32),
    ]);
    const h = Buffer.alloc(28);
    h.write("b3dm");
    h.writeUInt32LE(1, 4);
    h.writeUInt32LE(28 + features.length + model.length, 8);
    h.writeUInt32LE(features.length, 12);
    model = Buffer.concat([h, features, model]);
  }
  const filename = b3dm ? "model.b3dm" : "model.glb";
  await writeFile(path.join(directory, "nested", filename), model);
  const tile = {
    boundingVolume: { sphere: [0, 0, 0, 10] },
    geometricError: 0,
    content: { uri: missing ? "missing.glb" : filename },
  };
  await writeFile(
    path.join(directory, "nested", "child.json"),
    JSON.stringify({
      asset: { version: b3dm ? "1.0" : "1.1" },
      geometricError: 0,
      root: tile,
    }),
  );
  await writeFile(
    path.join(directory, "tileset.json"),
    JSON.stringify({
      asset: { version: b3dm ? "1.0" : "1.1" },
      geometricError: 100,
      root: {
        boundingVolume: { sphere: [0, 0, 0, 12] },
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6378137, 0, 0, 1],
        geometricError: 100,
        refine: "REPLACE",
        children: [
          {
            boundingVolume: { sphere: [0, 0, 0, 12] },
            geometricError: 0,
            content: { uri: "nested/child.json" },
          },
        ],
      },
    }),
  );
  geometry.dispose();
  if (implicit) {
    await writeFile(path.join(directory, "nested", "0.0.0.glb"), model);
    let subtree = Buffer.from(
      JSON.stringify({
        tileAvailability: { constant: 1 },
        contentAvailability: [{ constant: 1 }],
        childSubtreeAvailability: { constant: 0 },
      }),
    );
    subtree = Buffer.concat([
      subtree,
      Buffer.alloc((8 - (subtree.length % 8)) % 8, 32),
    ]);
    const h = Buffer.alloc(24);
    h.write("subt");
    h.writeUInt32LE(1, 4);
    h.writeBigUInt64LE(BigInt(subtree.length), 8);
    await writeFile(
      path.join(directory, "root.subtree"),
      Buffer.concat([h, subtree]),
    );
    await writeFile(
      path.join(directory, "tileset.json"),
      JSON.stringify({
        asset: { version: "1.1" },
        geometricError: 100,
        root: {
          boundingVolume: { box: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10] },
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6378137, 0, 0, 1],
          geometricError: 100,
          refine: "REPLACE",
          content: { uri: "nested/{level}.{x}.{y}.glb" },
          implicitTiling: {
            subdivisionScheme: "QUADTREE",
            subtreeLevels: 1,
            availableLevels: 1,
            subtrees: { uri: "root.subtree" },
          },
        },
      }),
    );
  }
  return path.join(directory, "tileset.json");
}
