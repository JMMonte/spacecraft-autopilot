declare module 'three/examples/jsm/loaders/TIFFLoader.js' {
    import { Loader, LoadingManager, DataTexture } from 'three';

    export class TIFFLoader extends Loader {
        constructor(manager?: LoadingManager);
        load(url: string, onLoad?: (texture: DataTexture) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): DataTexture;
    }
}

declare module 'three/examples/jsm/loaders/EXRLoader.js' {
    import { Loader, LoadingManager, DataTexture } from 'three';

    export class EXRLoader extends Loader {
        constructor(manager?: LoadingManager);
        load(url: string, onLoad?: (texture: DataTexture) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): DataTexture;
    }
} 