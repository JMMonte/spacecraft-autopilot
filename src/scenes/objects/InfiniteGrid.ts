import * as THREE from 'three';

export interface InfiniteGridOptions {
  // Minor cells (default 1 unit)
  cellSize?: number;
  // How many minor cells per major section line
  sectionSize?: number;
  // Line colors
  color1?: THREE.ColorRepresentation; // minor lines
  color2?: THREE.ColorRepresentation; // major lines
  // Thickness multipliers (visual)
  thickness1?: number; // minor line thickness
  thickness2?: number; // major line thickness
  // Fade control (world units and strength exponent)
  fadeDistance?: number; // distance where lines fade out
  fadeStrength?: number; // exponent shaping fade curve
  // Keep the grid centered under the camera on XZ
  followCamera?: boolean;
}

/**
 * A shader-based infinite-looking grid for plain Three.js scenes.
 * Inspired by @react-three/drei's Grid component, but implemented without R3F.
 */
export class InfiniteGrid {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly material: THREE.ShaderMaterial;
  private readonly options: Required<InfiniteGridOptions>;

  constructor(opts: InfiniteGridOptions = {}) {
    this.options = {
      cellSize: opts.cellSize ?? 1,
      sectionSize: opts.sectionSize ?? 5,
      color1: opts.color1 ?? '#404040',
      color2: opts.color2 ?? '#808080',
      thickness1: opts.thickness1 ?? 1.0,
      thickness2: opts.thickness2 ?? 2.0,
      fadeDistance: opts.fadeDistance ?? 200,
      fadeStrength: opts.fadeStrength ?? 1.5,
      followCamera: opts.followCamera ?? true,
    };

    const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);

    const uniforms = {
      uColor1: { value: new THREE.Color(this.options.color1) },
      uColor2: { value: new THREE.Color(this.options.color2) },
      uSize1: { value: this.options.cellSize },
      uSize2: { value: this.options.cellSize * this.options.sectionSize },
      uThickness1: { value: this.options.thickness1 },
      uThickness2: { value: this.options.thickness2 },
      uFadeDistance: { value: this.options.fadeDistance },
      uFadeStrength: { value: this.options.fadeStrength },
      uCamPos: { value: new THREE.Vector3() },
    };

    const vertexShader = /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <logdepthbuf_vertex>
      }
    `;

    const fragmentShader = /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      precision highp float;
      varying vec3 vWorldPos;

      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform float uSize1;
      uniform float uSize2;
      uniform float uThickness1;
      uniform float uThickness2;
      uniform float uFadeDistance;
      uniform float uFadeStrength;
      uniform vec3 uCamPos;

      // Anti-aliased line intensity based on derivatives
      float gridLine(vec2 pos, float size) {
        // Map world XZ to grid coordinates
        vec2 coord = pos / size;
        // Derivative-based smoothing for consistent line thickness in screen space
        vec2 w = fwidth(coord);
        vec2 frac = abs(fract(coord - 0.5) - 0.5) / max(w, vec2(1e-6));
        float line = 1.0 - min(min(frac.x, frac.y), 1.0);
        return line;
      }

      void main() {
        #include <logdepthbuf_fragment>
        vec2 pos = vWorldPos.xz;

        // Minor / major line masks
        float minorLine = gridLine(pos, uSize1);
        float majorLine = gridLine(pos, uSize2);

        // Sharpen using thickness multipliers
        minorLine = smoothstep(1.0 - clamp(uThickness1, 0.0, 4.0), 1.0, minorLine);
        majorLine = smoothstep(1.0 - clamp(uThickness2, 0.0, 8.0), 1.0, majorLine);

        // Combine with major lines taking precedence
        float intensity = max(minorLine, majorLine);

        // World-space radial fade from camera XZ position
        float dist = distance(uCamPos.xz, pos);
        float fade = 1.0;
        if (uFadeDistance > 0.0) {
          float t = clamp(1.0 - dist / uFadeDistance, 0.0, 1.0);
          fade = pow(t, max(uFadeStrength, 0.0001));
        }

        // Color blend: additive contribution from minor and major lines
        vec3 color = uColor1 * minorLine + uColor2 * majorLine;
        float alpha = clamp(intensity, 0.0, 1.0) * fade;

        // Premultiply for nicer blending
        gl_FragColor = vec4(color * alpha, alpha);
        if (gl_FragColor.a <= 0.0001) discard;
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      name: 'InfiniteGridMaterial',
    });
    // Ensure derivative functions (fwidth) work across WebGL1/2
    this.material.extensions = { ...this.material.extensions, derivatives: true };

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2; // lay on XZ plane
    // Make the plane very large to cover the view frustum
    const SCALE = Math.max(1000, this.options.fadeDistance * 4);
    this.mesh.scale.setScalar(SCALE);
    this.mesh.renderOrder = -1; // draw early; keep behind other geometry
    this.mesh.frustumCulled = false; // avoid precision/culling edge cases
    // Do not occlude lens flare / visual effects
    (this.mesh as any).userData = { ...(this.mesh as any).userData, lensflare: 'no-occlusion' };
    // Helpers: do not cast/receive shadows
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.mesh);
  }

  update(camera: THREE.Camera) {
    // Update camera uniform and optionally keep grid centered under camera
    if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
      this.material.uniforms.uCamPos.value.copy(camera.position);
    }
    if (this.options.followCamera) {
      // Snap grid plane to world cell boundaries to keep pattern world-anchored
      const size = this.material.uniforms.uSize1.value as number;
      const snap = (v: number, s: number) => Math.floor(v / s) * s;
      this.mesh.position.x = snap(camera.position.x, size);
      this.mesh.position.z = snap(camera.position.z, size);
      // Keep at Y=0
      this.mesh.position.y = 0;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
