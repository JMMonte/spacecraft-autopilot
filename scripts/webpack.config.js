const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: './src/js/main.js',
    resolve: {
        alias: {
            'three': path.resolve(__dirname, 'node_modules/three'),
            'three-latest': path.resolve(__dirname, 'node_modules/three-latest')
        },
        extensions: ['.js', '.json']
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public'),
    },
    devServer: {
        static: path.resolve(__dirname, 'public'),
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'src/images',
                    to: 'images',
                    globOptions: {
                        ignore: ['**/Screenshot*']
                    }
                },
                {
                    from: 'src/config/config.json',
                    to: 'config.json'
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
