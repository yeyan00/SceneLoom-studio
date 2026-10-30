import * as THREE from "three";

// EDL response adapted from Potree edl.fs (BSD-2-Clause).
// Copyright (c) 2011-2020, Markus Schütz. See third_party/POTREE-LICENSE.txt.
// This pass reads Three.js hardware depth instead of Potree's log-depth alpha.
export class EyeDomeLighting {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.target.depthTexture = new THREE.DepthTexture(
      1,
      1,
      THREE.UnsignedIntType,
    );
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        color: { value: this.target.texture },
        depth: { value: this.target.depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        near: { value: 0.1 },
        far: { value: 10000 },
        strength: { value: 0.65 },
        orthographic: { value: false },
      },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `
      varying vec2 vUv;uniform sampler2D color;uniform sampler2D depth;uniform vec2 resolution;uniform float near;uniform float far;uniform float strength;uniform bool orthographic;
      float logDepth(vec2 uv){float d=texture2D(depth,uv).x;if(d>=1.)return 0.;float z=orthographic?mix(near,far,d):(2.*near*far)/(far+near-(2.*d-1.)*(far-near));return log2(max(z,.00001));}
      void main(){vec4 source=texture2D(color,vUv);float center=logDepth(vUv);float response=0.;if(center!=0.){for(int i=0;i<8;i++){float angle=float(i)*.785398163;float sampleDepth=logDepth(vUv+vec2(cos(angle),sin(angle))*1.5/resolution);if(sampleDepth!=0.)response+=max(0.,center-sampleDepth);}}float shade=exp(-response/8.*300.*strength);gl_FragColor=vec4(source.rgb*shade,1.);
      #include <colorspace_fragment>
      }`,
    });
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
    this.size = new THREE.Vector2();
  }
  render(renderer, scene, camera, viewport) {
    if (viewport)
      this.size.set(
        Math.max(1, Math.round(viewport.width * renderer.getPixelRatio())),
        Math.max(1, Math.round(viewport.height * renderer.getPixelRatio())),
      );
    else renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y)
      this.target.setSize(this.size.x, this.size.y);
    this.material.uniforms.resolution.value.copy(this.size);
    this.material.uniforms.near.value = camera.near;
    this.material.uniforms.far.value = camera.far;
    this.material.uniforms.orthographic.value = !!camera.isOrthographicCamera;
    renderer.setScissorTest(false);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    if (viewport) {
      renderer.setViewport(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
      );
      renderer.setScissor(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
      );
      renderer.setScissorTest(true);
    }
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
