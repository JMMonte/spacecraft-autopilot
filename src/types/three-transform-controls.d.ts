declare module 'three/examples/jsm/controls/TransformControls' {
  import { Camera, Object3D } from 'three';

  export class TransformControls {
    constructor(camera: Camera, domElement?: HTMLElement | null);
    enabled: boolean;
    showX: boolean;
    showY: boolean;
    showZ: boolean;
    dragging: boolean;
    setMode(mode: 'translate' | 'rotate' | 'scale' | string): void;
    setSize(size: number): void;
    setSpace(space: 'world' | 'local' | string): void;
    attach(object: Object3D): this;
    detach(): this;
    getHelper(): Object3D;
    dispose(): void;
    addEventListener(event: string, handler: (event: any) => void): void;
    removeEventListener(event: string, handler: (event: any) => void): void;
  }
}
