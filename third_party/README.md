# Third-party references

3D Tiles rendering uses NASA-AMMOS/3DTilesRendererJS (`3d-tiles-renderer`
0.5.3, Apache-2.0). License: `public/licenses/3D-TILES-RENDERER-LICENSE.txt`.
Draco and Basis decoder artifacts are copied from Three.js 0.180.0 examples;
their upstream license is Apache-2.0. Three.js (MIT) license is included as
`public/licenses/THREE-LICENSE.txt`. Decoder artifacts are served locally under
`public/tiles-decoders`; model samples are downloaded only into test-results.

Potree: https://github.com/potree/potree, local reference commit
`5636cd471d9eb464969e758be45c44d7613d3859`.

The modular Potree 2 reader follows `src/modules/loader/2.0/OctreeLoader.js`
and `DecoderWorker.js` (22-byte hierarchy records, proxy expansion,
interleaved DEFAULT decoding). `src/pointcloud/edl.js` adapts the EDL
response from `src/materials/shaders/edl.fs` to a Three.js depth texture.
Potree's copyright and BSD license are reproduced in POTREE-LICENSE.txt.
The complete Potree Viewer, its global namespace and bundled Three.js
are not included. Adaptive point sizing and full Potree material parity
remain follow-up work.

PotreeConverter is an external executable configured through
`POTREE_CONVERTER`; the local tools directory is not redistributed by this repo.
Its source reference under refs/ is also excluded from version control.
# PlayCanvas

The embedded GS editor includes SuperSplat 3.7.0, commit
`b89029dd20911fd18905b61de2701094ac390a73` (MIT), PCUI 6.1.4 (MIT),
and splat-transform 3.10.2 (MIT). Source provenance and embedding changes:
`vendor/supersplat/README.md`. License copies are distributed under
`public/licenses/SUPERSPLAT-LICENSE.txt`, `PCUI-LICENSE.txt` and
`SPLAT-TRANSFORM-LICENSE.txt`. The original native editor runs directly in a
shadow tree using WebGPU; no iframe or upstream cloud integration is enabled.

3DGS 视图使用 npm 依赖 PlayCanvas 2.23.3（MIT）。许可原文位于 `public/licenses/PLAYCANVAS-LICENSE.txt`，Vite 构建时自动复制至 `dist/licenses/`，随产品分发。
# Legacy CRN textures

`public/tiles-decoders/crunch/crunch.js` is copied unchanged from the decoder
distributed in `@loaders.gl/textures` 4.5.4. It runs in a dedicated worker to
transcode old CesiumLab `image/crn` images to GPU DXT textures. Distribution
notices: `public/licenses/loaders-gl-textures-LICENSE.txt` and
`public/licenses/crunch-LICENSE.txt` (upstream BinomialLLC/crunch).
