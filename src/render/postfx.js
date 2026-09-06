// 手写后处理管线（vendor 仅含 three 核心，EffectComposer 等 addons 离线不可用）：
// HDR 场景 → 亮度提取 → 可分离高斯模糊 → 合成（Bloom + ACES 色调映射 + 冷暖分级 + 晕影 + 胶片颗粒）
// ?lowfx 时整条链路旁路，直接渲染（弱机/无头截图）

import * as THREE from '../../vendor/three.module.min.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tex;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(0.0, l - threshold) / max(l, 0.0001);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tex;
uniform vec2 dir; // (1/w, 0) 或 (0, 1/h)
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tex, vUv).rgb * 0.227027;
  sum += (texture2D(tex, vUv + dir * 1.3846).rgb + texture2D(tex, vUv - dir * 1.3846).rgb) * 0.3162162;
  sum += (texture2D(tex, vUv + dir * 3.2308).rgb + texture2D(tex, vUv - dir * 3.2308).rgb) * 0.0702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D scene;
uniform sampler2D bloom;
uniform float bloomStrength;
uniform float time;
uniform vec2 resolution;
varying vec2 vUv;

// Narkowicz ACES 近似（线性空间）
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 c = texture2D(scene, vUv).rgb;
  c += texture2D(bloom, vUv).rgb * bloomStrength;

  // 晕影：边缘压暗聚拢视线
  vec2 p = vUv - 0.5;
  float vig = smoothstep(0.92, 0.32, length(p) * 1.3);
  c *= mix(0.72, 1.0, vig);

  // 冷暖分级：暗部偏青、亮部偏暖，军事片质感
  float lum = dot(c, vec3(0.333));
  c = mix(c, c * vec3(0.94, 1.0, 1.08), (1.0 - smoothstep(0.0, 0.55, lum)) * 0.30);
  c = mix(c, c * vec3(1.05, 1.0, 0.94), smoothstep(0.35, 0.9, lum) * 0.18);

  c = aces(c * 1.06);

  // 胶片颗粒
  float g = fract(sin(dot(vUv * resolution + mod(time, 10.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += g * 0.018;

  c = pow(max(c, 0.0), vec3(1.0 / 2.2)); // 手动线性→sRGB
  gl_FragColor = vec4(c, 1.0);
}`;

export class PostFX {
  constructor(threeRenderer, lowfx = false) {
    this.r = threeRenderer;
    this.enabled = !lowfx;
    if (!this.enabled) return;

    this.quadCam = new THREE.Camera();
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quadScene.add(this.quad);
    this.quad.frustumCulled = false;

    const mk = (frag, uniforms = {}) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms,
    });
    this.brightMat = mk(BRIGHT_FRAG, { tex: { value: null }, threshold: { value: 0.82 } });
    this.blurMat = mk(BLUR_FRAG, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
    this.compMat = mk(COMPOSITE_FRAG, {
      scene: { value: null }, bloom: { value: null }, bloomStrength: { value: 0.85 },
      time: { value: 0 }, resolution: { value: new THREE.Vector2(1, 1) },
    });

    this.halfFloat = this.r.capabilities.isWebGL2;
    this.blurDirH = new THREE.Vector2();
    this.blurDirV = new THREE.Vector2();
    this.createTargets(1, 1);
  }

  createTargets(w, h) {
    for (const t of [this.rtScene, this.rtA, this.rtB]) t?.dispose();
    const type = this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const opts = { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...opts, samples: this.r.capabilities.isWebGL2 ? 4 : 0 });
    // bloom 用半分辨率
    this.bw = Math.max(1, w >> 1); this.bh = Math.max(1, h >> 1);
    const bopts = { ...opts, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(this.bw, this.bh, bopts);
    this.rtB = new THREE.WebGLRenderTarget(this.bw, this.bh, bopts);
    this.compMat.uniforms.resolution.value.set(w, h);
  }

  resize(w, h) {
    if (!this.enabled) return;
    this.createTargets(Math.max(2, Math.floor(w)), Math.max(2, Math.floor(h)));
  }

  pass(material, target) {
    this.quad.material = material;
    this.r.setRenderTarget(target);
    this.r.render(this.quadScene, this.quadCam);
  }

  // 返回场景离屏目标；整条链路在 end() 里合成
  begin() {
    return this.enabled ? this.rtScene : null;
  }

  end(timeSec) {
    if (!this.enabled) return;
    // 亮度提取
    this.brightMat.uniforms.tex.value = this.rtScene.texture;
    this.brightMat.uniforms.threshold.value = 0.82;
    this.pass(this.brightMat, this.rtA);
    // 两次迭代的高斯模糊（横向→纵向），ping-pong（方向向量预分配，避免每帧 GC）
    for (let i = 0; i < 2; i++) {
      this.blurMat.uniforms.tex.value = this.rtA.texture;
      this.blurDirH.set(1 / this.bw, 0);
      this.blurMat.uniforms.dir.value = this.blurDirH;
      this.pass(this.blurMat, this.rtB);
      this.blurMat.uniforms.tex.value = this.rtB.texture;
      this.blurDirV.set(0, 1 / this.bh);
      this.blurMat.uniforms.dir.value = this.blurDirV;
      this.pass(this.blurMat, this.rtA);
    }
    // 合成到屏幕
    this.compMat.uniforms.scene.value = this.rtScene.texture;
    this.compMat.uniforms.bloom.value = this.rtA.texture;
    this.compMat.uniforms.bloomStrength.value = 0.85;
    this.compMat.uniforms.time.value = timeSec;
    this.pass(this.compMat, null);
  }
}
