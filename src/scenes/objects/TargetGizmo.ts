import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';

export interface TargetGizmoOptions {
  size?: number;
  color?: string;
  mode?: 'translate' | 'rotate';
}

/**
 * A lightweight 3D gizmo to visualize and drag the target position in the main Three.js scene.
 * Uses three/examples TransformControls (no R3F dependency) and disables OrbitControls while dragging.
 */
export class TargetGizmo {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private group: THREE.Group;
  private axes: THREE.AxesHelper;
  private marker: THREE.Mesh;
  private controls: TransformControls;
  private helper: THREE.Object3D;
  private onTransform?: (pos: THREE.Vector3, quat: THREE.Quaternion) => void;
  private orbitControls?: { enabled: boolean } | null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    domElement: HTMLElement,
    onTransform?: (pos: THREE.Vector3, quat: THREE.Quaternion) => void,
    options: TargetGizmoOptions = {},
    orbitControls?: { enabled: boolean } | null
  ) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.onTransform = onTransform;
    this.orbitControls = orbitControls ?? null;

    const size = options.size ?? 0.75;
    const color = new THREE.Color(options.color ?? '#00ffff');

    // Group holds visual marker + is the object the transform controls manipulate
    this.group = new THREE.Group();

    // Visible marker: small sphere + crosshair ring for visibility
    const sphereGeom = new THREE.SphereGeometry(0.08, 20, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color, depthTest: true });
    this.marker = new THREE.Mesh(sphereGeom, sphereMat);
    this.marker.renderOrder = 1;
    this.group.add(this.marker);

    // Crosshair ring slightly larger than sphere
    const ringGeom = new THREE.RingGeometry(0.12, 0.14, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 1;
    this.group.add(ring);

    // Axes helper for orientation/sense
    this.axes = new THREE.AxesHelper(0.5);
    (this.axes.material as THREE.LineBasicMaterial).opacity = 0.9;
    (this.axes.material as THREE.LineBasicMaterial).transparent = true;
    this.group.add(this.axes);

    // TransformControls for dragging (three r180+)
    this.controls = new TransformControls(this.camera, this.domElement);
    this.controls.setMode(options.mode || 'translate');
    this.controls.setSize(size);
    this.controls.showX = true;
    this.controls.showY = true;
    this.controls.showZ = true;
    this.controls.setSpace('world');

    // The helper (gizmo root) must be added to the scene in r180+
    this.helper = this.controls.getHelper();
    this.scene.add(this.group);
    this.scene.add(this.helper);
    this.controls.attach(this.group);

    // While dragging disable orbit controls to avoid conflicts
    this.controls.addEventListener('dragging-changed', (e: any) => {
      const dragging = !!e?.value;
      if (this.orbitControls && typeof this.orbitControls.enabled === 'boolean') {
        this.orbitControls.enabled = !dragging;
      }
    });

    // Emit position updates only when the object truly changes
    this.controls.addEventListener('objectChange', () => {
      if (this.onTransform) this.onTransform(this.group.position.clone(), this.group.quaternion.clone());
    });
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (visible) {
      try { this.controls.attach(this.group); } catch {}
    } else {
      try { this.controls.detach(); } catch {}
    }
  }

  public setMode(mode: 'translate' | 'rotate'): void {
    // Rotation feels better in local space for orientation tweaking
    if (mode === 'rotate') this.controls.setSpace('local');
    else this.controls.setSpace('world');
    this.controls.setMode(mode);
  }

  public setPosition(pos: THREE.Vector3): void {
    this.group.position.copy(pos);
    // Ensure matrices reflect the change
    this.group.updateMatrixWorld();
  }

  public setOrientation(quat: THREE.Quaternion): void {
    this.group.quaternion.copy(quat);
    this.group.updateMatrixWorld();
  }

  public getOrientation(): THREE.Quaternion {
    return this.group.quaternion.clone();
  }

  public getPosition(): THREE.Vector3 {
    return this.group.position.clone();
  }

  public dispose(): void {
    try { this.controls.detach(); } catch {}
    try { this.scene.remove(this.helper); } catch {}
    try { this.scene.remove(this.group); } catch {}
    try { (this.marker.geometry as THREE.BufferGeometry)?.dispose?.(); } catch {}
    try {
      const m = this.marker.material as THREE.Material;
      m.dispose?.();
    } catch {}
  }
}
