/// <reference types="node" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@components': path.resolve(__dirname, './src/components'),
            '@styles': path.resolve(__dirname, './src/styles'),
            '@scenes': path.resolve(__dirname, './src/scenes'),
            '@controllers': path.resolve(__dirname, './src/controllers'),
            '@helpers': path.resolve(__dirname, './src/helpers'),
            '@core': path.resolve(__dirname, './src/core'),
            '@utils': path.resolve(__dirname, './src/utils'),
            '@config': path.resolve(__dirname, './src/config'),
            'three/examples/jsm/objects/Lensflare': 'three/examples/jsm/objects/Lensflare.js'
        },
        extensions: ['.ts', '.tsx', '.js', '.jsx']
    },
    server: {
        port: 3000,
        open: true,
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: true,
        // Increase warning threshold; large WASM/vendor chunks are expected (Rapier/Three)
        chunkSizeWarningLimit: 2500,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor': ['three'],
                    'loaders': ['three/examples/jsm/loaders/TIFFLoader', 'three/examples/jsm/loaders/EXRLoader'],
                    'scenes': [
                        './src/scenes/sceneCamera.ts',
                        './src/scenes/sceneLights.ts',
                        './src/scenes/objects/spacecraftModel.ts',
                        './src/scenes/sceneHelpers.ts',
                        './src/scenes/sceneObjConfig.ts'
                    ],
                    'controllers': [
                        './src/controllers/docking/DockingController.ts',
                        './src/controllers/autopilot/Autopilot.ts',
                        './src/controllers/pidController.ts',
                        './src/controllers/spacecraftController.ts',
                        './src/controllers/trajectory.ts'
                    ]
                }
            }
        }
    },
    assetsInclude: ['**/*.exr', '**/*.tiff', '**/*.tif', '**/*.png', '**/*.jpg', '**/*.jpeg'],
    optimizeDeps: {
        exclude: ['stats.js'],
        include: [
            'three',
            'three/examples/jsm/objects/Lensflare',
            'three/examples/jsm/libs/stats.module.js',
            'three/examples/jsm/loaders/TIFFLoader',
            'three/examples/jsm/loaders/EXRLoader'
        ]
    },
    publicDir: 'public'
}); 
