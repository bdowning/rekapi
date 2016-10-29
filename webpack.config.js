module.exports = {
    entry: './src/index.js',
    output: {
        libraryTarget: 'umd',
        library: 'Rekapi',
        path: __dirname + '/dist',
        filename: 'rekapi.js'
    },
    externals: {
        shifty: 'Tweenable',
        underscore: '_'
    },
    module: {
        loaders: [
            {
                test: /\.js$/,
                exclude: /(node_modules|bower_components)/,
                loader: 'babel-loader'
            }
        ]
    }
};
