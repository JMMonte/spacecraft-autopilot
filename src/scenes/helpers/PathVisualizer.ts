import * as THREE from 'three';

/**
 * Manages the planned path line visualization and carrot (lookahead) sphere.
 */
export class PathVisualizer {
    public pathLine: THREE.Line | null = null;
    public pathCarrot: THREE.Mesh | null = null;
    private pathGeometry: THREE.BufferGeometry | null = null;
    private pathMaterial: THREE.LineBasicMaterial | null = null;

    constructor(private scene: THREE.Scene) {
        this.init();
    }

    private init(): void {
        this.pathGeometry = new THREE.BufferGeometry();
        this.pathMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
        this.pathLine = new THREE.Line(this.pathGeometry, this.pathMaterial);
        (this.pathLine as any).renderOrder = 998;
        (this.pathLine as any).userData = { ...(this.pathLine as any).userData, lensflare: 'no-occlusion' };
        this.pathLine.visible = false;
        this.scene.add(this.pathLine);

        const carrotGeom = new THREE.SphereGeometry(0.15, 16, 16);
        const carrotMat = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
        this.pathCarrot = new THREE.Mesh(carrotGeom, carrotMat);
        (this.pathCarrot as any).renderOrder = 999;
        (this.pathCarrot as any).userData = { ...(this.pathCarrot as any).userData, lensflare: 'no-occlusion' };
        this.pathCarrot.visible = false;
        this.scene.add(this.pathCarrot);
    }

    setPathVisible(visible: boolean): void {
        if (this.pathLine) this.pathLine.visible = visible;
        if (this.pathCarrot) this.pathCarrot.visible = visible;
    }

    updatePath(points: THREE.Vector3[], carrot?: THREE.Vector3): void {
        if (!this.pathGeometry || !this.pathLine || !points || points.length < 2) {
            if (this.pathLine) this.pathLine.visible = false;
            if (this.pathCarrot) this.pathCarrot.visible = false;
            return;
        }
        const attr = this.pathGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!attr || attr.count !== points.length) {
            if (attr) {
                try { (attr as any).dispose?.(); } catch {}
                try { this.pathGeometry.deleteAttribute('position'); } catch {}
            }
            const arr = new Float32Array(points.length * 3);
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                arr[i * 3 + 0] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
            }
            this.pathGeometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            this.pathGeometry.computeBoundingSphere();
        } else {
            const arr = (attr.array as Float32Array);
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                const j = i * 3;
                arr[j] = p.x; arr[j + 1] = p.y; arr[j + 2] = p.z;
            }
            attr.needsUpdate = true;
        }
        if (this.pathCarrot && carrot) {
            this.pathCarrot.position.copy(carrot);
        }
    }

    cleanup(): void {
        if (this.pathLine) { this.scene.remove(this.pathLine); this.pathLine = null; }
        if (this.pathGeometry) { this.pathGeometry.dispose(); this.pathGeometry = null; }
        if (this.pathMaterial) { this.pathMaterial.dispose(); this.pathMaterial = null; }
        if (this.pathCarrot) {
            this.scene.remove(this.pathCarrot);
            (this.pathCarrot.geometry as any)?.dispose?.();
            const mat = this.pathCarrot.material as any; if (mat?.dispose) mat.dispose();
            this.pathCarrot = null;
        }
    }
}
