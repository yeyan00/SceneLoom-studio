import * as THREE from 'three';

export class CrunchTextures {
  constructor() { this.pending = new Map(); this.nextId = 0; }
  decode(buffer) {
    if (this.disposed) return Promise.reject(new Error('3D Tiles view closed'));
    if (!this.worker) {
      this.worker = new Worker('/tiles-decoders/crunch/worker.js');
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (!pending) return;
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
      };
      this.worker.onerror = (event) => this.rejectAll(new Error(event.message || 'CRN decoder failed'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, buffer }, [buffer]);
    });
  }
  plugin = (parser) => ({
    name: 'SCENELOOM_legacy_crn',
    loadTexture: (index) => {
      const definition = parser.json.textures[index];
      const image = parser.json.images?.[definition.source];
      if (!/^image\/(x-)?crn$/.test(image?.mimeType || '')) return null;
      return parser.loadTextureImage(index, definition.source, {
        load: (url, onLoad, onProgress, onError) => {
          fetch(url).then(r => { if (!r.ok) throw new Error('CRN texture fetch failed'); return r.arrayBuffer(); })
            .then(buffer => this.decode(buffer)).then(({ bytes, mipmaps, width, height, format }) => {
              const texture = new THREE.CompressedTexture(mipmaps.map(m => ({ width: m.width, height: m.height, data: new Uint8Array(bytes, m.offset, m.length) })), width, height,
                [THREE.RGB_S3TC_DXT1_Format, THREE.RGBA_S3TC_DXT3_Format, THREE.RGBA_S3TC_DXT5_Format][format]);
              texture.needsUpdate = true;
              onLoad(texture);
            }).catch(error => {
              if (!this.disposed) console.error('CRN texture decoding failed:', error);
              onError?.(error);
            });
        },
      });
    },
  });
  rejectAll(error) { for (const p of this.pending.values()) p.reject(error); this.pending.clear(); }
  dispose() { this.disposed = true; this.worker?.terminate(); this.rejectAll(new Error('3D Tiles view closed')); }
}
