# Local PotreeConverter build

Source: `refs/PotreeConverter`, base commit `c2cb61843bf2b901e8e257874b1a6dcf67792fb2`.

The Windows executable embeds an UTF-8 active-code-page manifest so command-line
arguments, filesystem paths and LASzip agree on Chinese filenames. Rebuild and
deploy `laszip.dll` together with `PotreeConverter.exe`; do not mix old and new binaries.

Source curation scans every point to calculate actual bounds instead of trusting
LAS header bounds. Bounds include one source scale step of padding to accommodate
coordinate rescaling. This adds one sequential read of each input and never edits
the source LAS/LAZ. Open failures and point read failures are checked during scanning.
The existing out-of-bounds guard remains enabled.

Install Visual Studio C++ desktop tools, a Windows SDK and CMake. With the patched
source present, run `powershell -ExecutionPolicy Bypass -File scripts/build-potree.ps1`.
For a fresh checkout at the base commit, apply `docs/potree-converter.patch` with
`git -C refs/PotreeConverter apply ../../docs/potree-converter.patch` first.
The patch includes `utf8.manifest`.


Public validation uses generated fixtures only. Private dataset measurements are omitted.
