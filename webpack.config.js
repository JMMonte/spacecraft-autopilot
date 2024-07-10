const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: './src/js/main.js',
    resolve: {
        alias: {
            'three': path.resolve(__dirname, 'node_modules/three'),
            'three-latest': path.resolve(__dirname, 'node_modules/three-latest')
        }
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public'),
    },
    devServer: {
        static: ['./public', './src'],
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'src/images/**/*', // Copies all files in 'images' directory
                    to: 'images/[name][ext]', // Output in public/images keeping the original names
                    filter: (resourcePath) => {
                        // Exclude files with 'Screenshot' in the name
                        return !resourcePath.includes('Screenshot');
                    }
                },
                {
                    from: 'src/config.json', // Copy config.json
                    to: 'config.json' // Output in public directory
                }
            ]
        })
    ],
    module: {
        rules: [
            {
                test: /\.(png|jpe?g|gif)$/i,
                use: [
                    {
                        loader: 'file-loader',
                        options: {
                            name: '[name].[ext]',
                            outputPath: 'images/', // Put these files under public/images
                        },
                    },
                ],
            },
            {
                test: /\.(exr)$/i,
                use: [
                    {
                        loader: 'file-loader',
                        options: {
                            name: '[name].[ext]',
                            outputPath: 'images/', // Also put these files under public/images
                        },
                    },
                ],
            },
        ],
    },
};
