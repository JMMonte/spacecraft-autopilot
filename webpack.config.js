const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: './src/js/main.js',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public'),
    },
    resolve: {
        alias: {
            'three': path.resolve(__dirname, 'node_modules/three'),
            'three-latest': path.resolve(__dirname, 'node_modules/three-latest')
        }
    },
    devServer: {
        static: ['./public', './src'],
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'src/images/**/*',
                    to: 'images/[name][ext]',
                    filter: (resourcePath) => {
                        return !resourcePath.includes('Screenshot');
                    }
                },
                {
                    from: 'src/config/config.json',
                    to: 'config.json'
                },
                {
                    from: 'src/templates',
                    to: 'templates'
                },
                {
                    from: 'src/index.html',
                    to: 'index.html'
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
                            outputPath: 'images/',
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
                            outputPath: 'images/',
                        },
                    },
                ],
            },
        ],
    },
};