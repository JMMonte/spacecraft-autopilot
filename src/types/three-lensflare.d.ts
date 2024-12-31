declare module 'three/examples/jsm/objects/Lensflare.js' {
    import { Object3D, Color, Texture } from 'three';

    export class Lensflare extends Object3D {
        constructor();
        addElement(element: LensflareElement): void;
        dispose(): void;
    }

    export class LensflareElement {
        constructor(texture: Texture, size?: number, distance?: number, color?: Color);
        texture: Texture;
        size: number;
        distance: number;
        color: Color;
    }
} 