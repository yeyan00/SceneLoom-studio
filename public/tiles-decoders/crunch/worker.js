/* CRN -> DXT decoding stays off the UI thread. Decoder: loaders.gl 4.5.4. */
importScripts('./crunch.js');
const decoder = LoadCrunchDecoder();
self.onmessage = ({ data: { id, buffer } }) => {
  let src = 0, dst = 0;
  try {
    if (buffer.byteLength < 20 || new Uint8Array(buffer)[0] !== 0x48 || new Uint8Array(buffer)[1] !== 0x78) throw new Error('Invalid CRN texture');
    src = decoder._malloc(buffer.byteLength);
    decoder.HEAPU8.set(new Uint8Array(buffer), src);
    const format = decoder._crn_get_dxt_format(src, buffer.byteLength);
    const width = decoder._crn_get_width(src, buffer.byteLength);
    const height = decoder._crn_get_height(src, buffer.byteLength);
    const levels = decoder._crn_get_levels(src, buffer.byteLength);
    if (![0,1,2].includes(format) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || levels < 1 || levels > 15) throw new Error('Unsupported CRN texture');
    const mipmaps = [];
    let size = 0;
    for (let i = 0; i < levels; i++) {
      const w = Math.max(1, width >> i), h = Math.max(1, height >> i);
      const length = Math.ceil(w / 4) * Math.ceil(h / 4) * (format === 0 ? 8 : 16);
      mipmaps.push({ width: w, height: h, offset: size, length }); size += length;
    }
    if (size > 256 * 1024 * 1024) throw new Error('CRN texture too large');
    dst = decoder._malloc(size);
    decoder._crn_decompress(src, buffer.byteLength, dst, size, 0, levels);
    const bytes = decoder.HEAPU8.slice(dst, dst + size).buffer;
    self.postMessage({ id, format, width, height, mipmaps, bytes }, [bytes]);
  } catch (error) { self.postMessage({ id, error: error.message }); }
  finally { if (src) decoder._free(src); if (dst) decoder._free(dst); }
};
