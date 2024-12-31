declare module '@andersonmancini/lens-flare' {
    import { Object3D, Vector3, Color } from 'three';

    interface LensFlareProps {
        position?: Vector3;
        colorGain?: Color;
        starPoints?: number;
        glareSize?: number;
        flareSize?: number;
        flareSpeed?: number;
        animated?: boolean;
        followMouse?: boolean;
    }

    export class LensFlare extends Object3D {
        constructor(props: LensFlareProps);
    }
} 